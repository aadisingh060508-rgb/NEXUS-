package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/fsnotify/fsnotify"
	"golang.org/x/sys/windows"
)

// ANSI color codes for enhanced terminal visibility
const (
	colorReset   = "\033[0m"
	colorRed     = "\033[31;1m"
	colorGreen   = "\033[32;1m"
	colorYellow  = "\033[33;1m"
	colorBlue    = "\033[34;1m"
	colorMagenta = "\033[35;1m"
	colorCyan    = "\033[36;1m"
	colorGray    = "\033[90m"
	colorBold    = "\033[1m"
)

var jsonMode bool

// JSONEvent is the structured payload for --json mode
type JSONEvent struct {
	Type        string `json:"type"`
	Timestamp   string `json:"timestamp"`
	File        string `json:"file,omitempty"`
	Source      string `json:"source,omitempty"`
	Destination string `json:"destination,omitempty"`
	Size        string `json:"size,omitempty"`
	FileType    string `json:"fileType,omitempty"`
	Message     string `json:"message,omitempty"`
	IsExternal  bool   `json:"isExternal,omitempty"`
}

func emitJSON(event JSONEvent) {
	data, err := json.Marshal(event)
	if err != nil {
		return
	}
	fmt.Println(string(data))
	_ = os.Stdout.Sync()
}

// FileMetadata tracks the known state of a file
type FileMetadata struct {
	Path        string
	Size        int64
	ModTime     time.Time
	Hash        string
	LastUpdated time.Time
	Logged      bool
}

// PendingEvent tracks recent filesystem operations for correlation
type PendingEvent struct {
	Op       fsnotify.Op
	Path     string
	Size     int64
	Hash     string
	Time     time.Time
	Detected bool
}

// FileMonitor manages directory watching and event correlation
type FileMonitor struct {
	watcher         *fsnotify.Watcher
	mu              sync.RWMutex
	fileCache       map[string]*FileMetadata
	recentRemovals  map[string]*PendingEvent
	recentRenames   map[string]*PendingEvent
	recentCreates   map[string]*PendingEvent
	newlyCreated    map[string]time.Time
	activeDebounces map[string]*time.Timer
	recentEmitted   map[string]time.Time // Deduplication cache: "OP:PATH" -> timestamp
	watchedRoots   map[string]string    // normalized key -> display path
	availableRoots map[string]DirectoryRoot
	systemDrive    string
	policyEngine   *LocalPolicyEngine
}

func initConsole() {
	_ = windows.SetConsoleCP(65001)
	_ = windows.SetConsoleOutputCP(65001)

	stdout := windows.Handle(os.Stdout.Fd())
	var mode uint32
	if err := windows.GetConsoleMode(stdout, &mode); err == nil {
		mode |= windows.ENABLE_VIRTUAL_TERMINAL_PROCESSING
		_ = windows.SetConsoleMode(stdout, mode)
	}
}

func logMessage(format string, a ...interface{}) {
	if jsonMode {
		return // In JSON mode, only emitJSON is used
	}
	fmt.Printf(format, a...)
	_ = os.Stdout.Sync()
}

func formatBytes(bytes int64) string {
	if bytes <= 0 {
		return "0 B"
	}
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	units := []string{"KB", "MB", "GB", "TB"}
	if exp >= len(units) {
		exp = len(units) - 1
	}
	return fmt.Sprintf("%.1f %s", float64(bytes)/float64(div), units[exp])
}

func getTimestamp() string {
	return time.Now().Format("2006-01-02 15:04:05")
}

// isNoiseFile filters out temporary system, lock, browser-cache and log files
func isNoiseFile(path string) bool {
	name := strings.ToLower(filepath.Base(path))
	ext := strings.ToLower(filepath.Ext(name))
	return strings.HasPrefix(name, "~$") ||
		strings.HasPrefix(name, ".~") ||
		strings.HasPrefix(name, "tmp") ||
		strings.HasSuffix(name, ".tmp") ||
		strings.HasSuffix(name, ".log") ||
		strings.HasSuffix(name, ".crdownload") ||
		strings.HasSuffix(name, ".part") ||
		strings.HasSuffix(name, ".db-wal") ||
		strings.HasSuffix(name, ".db-shm") ||
		ext == ".ldb" ||
		ext == ".sst" ||
		name == "desktop.ini" ||
		name == "thumbs.db" ||
		name == ".ds_store" ||
		name == "lock" ||
		name == "lockfile"
}

// browserNoiseDirs is the set of directory names (lowercased) that are internal
// to browsers or system applications and should never be watched.
var browserNoiseDirs = map[string]bool{
	// Chromium / Edge / Chrome internals
	"cache": true, "cache2": true, "code cache": true, "gpucache": true,
	"shorlisted apps": true, "shaderdata": true, "networkeventlog": true,
	"segmentation platform": true, "optimization guide hints store": true,
	"graphitedawg": true, "pnacltest": true, "pepper data": true,
	"zxcvbn-data": true, "shared workers": true, "service worker": true,
	// Firefox
	"startupCache": true, "thumbnails": true, "safebrowsing": true,
	// Generic browser / app data noise
	"crashreports": true, "crashpad": true, "crashlogs": true,
	"logs": true, "log": true,
}

// isBrowserCachePath returns true when the path is inside a known browser/app-data cache subtree.
func isBrowserCachePath(path string) bool {
	lower := strings.ToLower(filepath.ToSlash(path))
	// Generic catch-all: anything under AppData is application-internal noise
	// (browser caches, app configs, temp files, etc.) — not user file activity.
	if strings.Contains(lower, "/appdata/") {
		return true
	}
	// Windows temp directories
	if strings.Contains(lower, "/windows/temp/") || strings.Contains(lower, "/windows/prefetch/") {
		return true
	}
	return false
}

// shouldSkipDir skips system/noise directories during recursive watching
func shouldSkipDir(name string) bool {
	lower := strings.ToLower(name)
	switch lower {
	case "node_modules", "vendor", "$recycle.bin", "system volume information",
		"recovery", "windows", "program files", "program files (x86)",
		"programdata", "perflogs", "msocache", "config.msi",
		"boot", "mingw", "go", ".git",
		// AppData entirely — contains only app-internal files, not user files
		"appdata",
		// Browser / app cache subdirectories
		"cache", "cache2", "code cache", "gpucache", "crashpad", "crashreports",
		"crashlogs", "logs", "safebrowsing", "thumbnails", "temp",
		// Windows system noise
		"prefetch", "softwaredistribution", "winsxs", "assembly":
		return true
	}
	if strings.HasPrefix(name, ".") && len(name) > 1 {
		return true
	}
	// Skip known browser-noise directory names
	if browserNoiseDirs[lower] {
		return true
	}
	return false
}

// computeFastHash computes a SHA-256 hash of the first 1MB of the file
func computeFastHash(path string) (string, int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()

	fi, err := f.Stat()
	if err != nil {
		return "", 0, err
	}

	if fi.Size() == 0 {
		return "empty", 0, nil
	}

	h := sha256.New()
	_, err = io.CopyN(h, f, 1024*1024)
	if err != nil && err != io.EOF {
		return "", fi.Size(), err
	}

	return hex.EncodeToString(h.Sum(nil)), fi.Size(), nil
}

// isExternalDevice checks if the path resides on an external or non-system drive
func (m *FileMonitor) isExternalDevice(path string) bool {
	vol := filepath.VolumeName(path)
	if vol == "" {
		return false
	}
	rootPath := strings.TrimRight(vol, `\/`) + `\`
	rootPtr, err := syscall.UTF16PtrFromString(rootPath)
	if err != nil {
		return false
	}

	driveType := windows.GetDriveType(rootPtr)
	if driveType == windows.DRIVE_REMOVABLE || driveType == windows.DRIVE_REMOTE {
		return true
	}
	if m.systemDrive != "" && !strings.EqualFold(vol, m.systemDrive) {
		return true
	}
	return false
}

// isDuplicateEvent checks if an identical event was emitted within the last 1.5s
func (m *FileMonitor) isDuplicateEvent(op string, path string) bool {
	key := fmt.Sprintf("%s:%s", op, strings.ToLower(path))
	now := time.Now()
	if lastTime, exists := m.recentEmitted[key]; exists {
		if now.Sub(lastTime) < 1500*time.Millisecond {
			return true
		}
	}
	m.recentEmitted[key] = now
	return false
}

func NewFileMonitor() (*FileMonitor, error) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	systemDrive := os.Getenv("SystemDrive")
	if systemDrive == "" {
		systemDrive = "C:"
	}

	store := &JSONPolicyStore{FilePath: "data/policy-config.json"}
	enforcement := &MockEnforcementClient{}
	engine := NewLocalPolicyEngine(store, enforcement)

	return &FileMonitor{
		watcher:         watcher,
		fileCache:       make(map[string]*FileMetadata),
		recentRemovals:  make(map[string]*PendingEvent),
		recentRenames:   make(map[string]*PendingEvent),
		recentCreates:   make(map[string]*PendingEvent),
		newlyCreated:    make(map[string]time.Time),
		activeDebounces: make(map[string]*time.Timer),
		recentEmitted:   make(map[string]time.Time),
		watchedRoots:    make(map[string]string),
		availableRoots:  make(map[string]DirectoryRoot),
		systemDrive:     systemDrive,
		policyEngine:    engine,
	}, nil
}

// StartEventLoop processes events from fsnotify
func (m *FileMonitor) StartEventLoop() {
	// Cleanup routine for expired pending events
	go func() {
		ticker := time.NewTicker(3 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			m.mu.Lock()
			now := time.Now()
			for k, v := range m.recentRemovals {
				if now.Sub(v.Time) > 5*time.Second {
					delete(m.recentRemovals, k)
				}
			}
			for k, v := range m.recentRenames {
				if now.Sub(v.Time) > 5*time.Second {
					delete(m.recentRenames, k)
				}
			}
			for k, v := range m.recentCreates {
				if now.Sub(v.Time) > 5*time.Second {
					delete(m.recentCreates, k)
				}
			}
			for k, t := range m.newlyCreated {
				if now.Sub(t) > 10*time.Second {
					delete(m.newlyCreated, k)
				}
			}
			for k, t := range m.recentEmitted {
				if now.Sub(t) > 5*time.Second {
					delete(m.recentEmitted, k)
				}
			}
			m.mu.Unlock()
		}
	}()

	for {
		select {
		case event, ok := <-m.watcher.Events:
			if !ok {
				return
			}
			m.handleEvent(event)
		case err, ok := <-m.watcher.Errors:
			if !ok {
				return
			}
			if err != nil {
				logMessage("%s[Error]%s %v\n", colorRed, colorReset, err)
			}
		}
	}
}

func (m *FileMonitor) handleEvent(event fsnotify.Event) {
	path := event.Name
	if isNoiseFile(path) {
		return
	}

	// Skip events from browser/app cache and temp directories
	if isBrowserCachePath(path) {
		return
	}

	if !m.isWatchedPath(path) {
		return
	}

	// Handle new directory creation: start watching it immediately
	if event.Has(fsnotify.Create) {
		if fi, err := os.Stat(path); err == nil && fi.IsDir() {
			if !shouldSkipDir(fi.Name()) && !isReparsePoint(fi) {
				_ = m.watcher.Add(path)
			}
			return
		}
		// Record that this file was created brand new
		m.mu.Lock()
		m.newlyCreated[path] = time.Now()
		m.mu.Unlock()
	}

	switch {
	case event.Has(fsnotify.Rename):
		m.handleRenameOp(path)
	case event.Has(fsnotify.Remove):
		m.handleRemoveOp(path)
	case event.Has(fsnotify.Create) || event.Has(fsnotify.Write):
		m.handleWriteOrCreateOp(path)
	}
}

func (m *FileMonitor) handleRenameOp(oldPath string) {
	m.mu.Lock()
	meta, exists := m.fileCache[oldPath]
	var size int64
	var hash string
	if exists {
		size = meta.Size
		hash = meta.Hash
		delete(m.fileCache, oldPath)
	}
	m.recentRenames[oldPath] = &PendingEvent{
		Op:   fsnotify.Rename,
		Path: oldPath,
		Size: size,
		Hash: hash,
		Time: time.Now(),
	}
	m.mu.Unlock()
}

func (m *FileMonitor) handleRemoveOp(removedPath string) {
	m.mu.Lock()
	meta, exists := m.fileCache[removedPath]
	var size int64
	var hash string
	if exists {
		size = meta.Size
		hash = meta.Hash
		delete(m.fileCache, removedPath)
	}
	removalEv := &PendingEvent{
		Op:   fsnotify.Remove,
		Path: removedPath,
		Size: size,
		Hash: hash,
		Time: time.Now(),
	}
	m.recentRemovals[removedPath] = removalEv

	// Immediately check if a recent CREATE on a DIFFERENT path matches this removal (cross-drive move)
	now := time.Now()
	for createPath, createEv := range m.recentCreates {
		if strings.EqualFold(removedPath, createPath) || createEv.Detected {
			continue
		}
		if now.Sub(createEv.Time) > 3*time.Second {
			continue
		}
		isSameName := strings.EqualFold(filepath.Base(removedPath), filepath.Base(createPath))
		isSameHash := hash != "" && createEv.Hash != "" && hash == createEv.Hash
		isSameContent := isSameHash || (size > 0 && size == createEv.Size && isSameName)

		if isSameName || isSameContent {
			removalEv.Detected = true
			createEv.Detected = true
			ts := getTimestamp()
			isExt := m.isExternalDevice(createPath)
			statusLine := ""
			if isExt {
				statusLine = "  Status: ✓ External Device (USB)\n"
			}
			if !m.isDuplicateEvent("MOVE", removedPath+":"+createPath) {
				logMessage("\n[%s] %sMOVE DETECTED%s\n  Source: %s\n  Destination: %s\n  File Size: %s\n%s",
					ts, colorYellow, colorReset, removedPath, createPath, formatBytes(createEv.Size), statusLine)
				if jsonMode {
					emitJSON(JSONEvent{Type: "MOVE", Timestamp: ts, Source: removedPath, Destination: createPath, Size: formatBytes(createEv.Size), IsExternal: isExt})
				}
			}
			m.mu.Unlock()
			return
		}
	}
	m.mu.Unlock()

	// Wait briefly to see if this removal is part of a MOVE or RENAME operation
	time.AfterFunc(600*time.Millisecond, func() {
		m.mu.Lock()
		defer m.mu.Unlock()
		if removalEv.Detected {
			return
		}
		removalEv.Detected = true
		ts := getTimestamp()
		if !m.isDuplicateEvent("DELETE", removedPath) {
			logMessage("\n[%s] %sDELETE DETECTED%s\n  File: %s\n  File Size: %s\n",
				ts, colorRed, colorReset, removedPath, formatBytes(size))
			if jsonMode {
				emitJSON(JSONEvent{Type: "DELETE", Timestamp: ts, File: removedPath, Size: formatBytes(size)})
			}
		}
	})
}

// handleWriteOrCreateOp debounces rapid write events and processes once writing settles
func (m *FileMonitor) handleWriteOrCreateOp(path string) {
	m.mu.Lock()
	if timer, exists := m.activeDebounces[path]; exists && timer != nil {
		timer.Stop()
	}
	m.activeDebounces[path] = time.AfterFunc(500*time.Millisecond, func() {
		m.mu.Lock()
		delete(m.activeDebounces, path)
		m.mu.Unlock()
		m.processSettledFile(path)
	})
	m.mu.Unlock()
}

func (m *FileMonitor) processSettledFile(path string) {
	fi, err := os.Stat(path)
	if err != nil || fi.IsDir() {
		return
	}

	size := fi.Size()

	m.mu.RLock()
	createdTime, wasJustCreated := m.newlyCreated[path]
	m.mu.RUnlock()

	if size == 0 && wasJustCreated && time.Since(createdTime) < 1500*time.Millisecond {
		m.mu.Lock()
		m.activeDebounces[path] = time.AfterFunc(500*time.Millisecond, func() {
			m.mu.Lock()
			delete(m.activeDebounces, path)
			m.mu.Unlock()
			m.processSettledFile(path)
		})
		m.mu.Unlock()
		return
	}

	hash, _, err := computeFastHash(path)
	if err != nil {
		hash = ""
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now()
	cached, wasCached := m.fileCache[path]
	isNewFile := wasJustCreated || !wasCached || (cached != nil && !cached.Logged)

	// --- Check 1: Match a recent RENAME event ---
	for oldPath, renameEv := range m.recentRenames {
		if strings.EqualFold(oldPath, path) || renameEv.Detected {
			continue
		}
		if now.Sub(renameEv.Time) > 3*time.Second {
			continue
		}

		oldDir := filepath.Dir(oldPath)
		newDir := filepath.Dir(path)
		isSameDir := strings.EqualFold(oldDir, newDir)
		isSameName := strings.EqualFold(filepath.Base(oldPath), filepath.Base(path))
		isSameSize := renameEv.Size > 0 && renameEv.Size == size
		isSameHash := renameEv.Hash != "" && hash != "" && renameEv.Hash == hash

		if !isSameDir && !isSameName && !isSameSize && !isSameHash {
			continue
		}

		renameEv.Detected = true
		delete(m.newlyCreated, path)
		m.fileCache[path] = &FileMetadata{Path: path, Size: size, ModTime: fi.ModTime(), Hash: hash, LastUpdated: now, Logged: true}
		ts := getTimestamp()

		if isSameDir {
			if !m.isDuplicateEvent("RENAME", path) {
				logMessage("\n[%s] %sRENAME DETECTED%s\n  Old Name: %s\n  New Name: %s\n  Path: %s%c\n",
					ts, colorCyan, colorReset, filepath.Base(oldPath), filepath.Base(path), newDir, filepath.Separator)
				if jsonMode {
					emitJSON(JSONEvent{Type: "RENAME", Timestamp: ts, File: filepath.Base(path), Message: filepath.Base(oldPath) + " → " + filepath.Base(path) + " in " + newDir})
				}
			}
		} else {
			isExt := m.isExternalDevice(path)
			statusLine := ""
			if isExt {
				statusLine = "  Status: ✓ External Device (USB)\n"
			}
			if !m.isDuplicateEvent("MOVE", oldPath+":"+path) {
				logMessage("\n[%s] %sMOVE DETECTED%s\n  Source: %s\n  Destination: %s\n  File Size: %s\n%s",
					ts, colorYellow, colorReset, oldPath, path, formatBytes(size), statusLine)
				if jsonMode {
					emitJSON(JSONEvent{Type: "MOVE", Timestamp: ts, Source: oldPath, Destination: path, Size: formatBytes(size), IsExternal: isExt})
				}
			}
		}
		return
	}

	// --- Check 2: Match a recent REMOVAL (cross-drive/folder move) ---
	for oldPath, remEv := range m.recentRemovals {
		if strings.EqualFold(oldPath, path) || remEv.Detected {
			continue
		}
		if now.Sub(remEv.Time) > 3*time.Second {
			continue
		}
		isSameName := strings.EqualFold(filepath.Base(oldPath), filepath.Base(path))
		isSameHash := hash != "" && remEv.Hash != "" && hash == remEv.Hash
		isSameSize := size > 0 && remEv.Size > 0 && size == remEv.Size

		if isSameName || isSameHash || (isSameSize && isSameName) {
			remEv.Detected = true
			delete(m.newlyCreated, path)
			m.fileCache[path] = &FileMetadata{Path: path, Size: size, ModTime: fi.ModTime(), Hash: hash, LastUpdated: now, Logged: true}
			ts := getTimestamp()

			if strings.EqualFold(filepath.Dir(oldPath), filepath.Dir(path)) && !isSameName {
				if !m.isDuplicateEvent("RENAME", path) {
					logMessage("\n[%s] %sRENAME DETECTED%s\n  Old Name: %s\n  New Name: %s\n  Path: %s%c\n",
						ts, colorCyan, colorReset, filepath.Base(oldPath), filepath.Base(path), filepath.Dir(path), filepath.Separator)
					if jsonMode {
						emitJSON(JSONEvent{Type: "RENAME", Timestamp: ts, File: filepath.Base(path), Message: filepath.Base(oldPath) + " → " + filepath.Base(path) + " in " + filepath.Dir(path)})
					}
				}
			} else {
				isExt := m.isExternalDevice(path)
				statusLine := ""
				if isExt {
					statusLine = "  Status: ✓ External Device (USB)\n"
				}
				if !m.isDuplicateEvent("MOVE", oldPath+":"+path) {
					logMessage("\n[%s] %sMOVE DETECTED%s\n  Source: %s\n  Destination: %s\n  File Size: %s\n%s",
						ts, colorYellow, colorReset, oldPath, path, formatBytes(size), statusLine)
					if jsonMode {
						emitJSON(JSONEvent{Type: "MOVE", Timestamp: ts, Source: oldPath, Destination: path, Size: formatBytes(size), IsExternal: isExt})
					}
				}
			}
			return
		}
	}

	// Register in recentCreates for potential reverse-removal correlation
	m.recentCreates[path] = &PendingEvent{Op: fsnotify.Create, Path: path, Size: size, Hash: hash, Time: now}

	// --- If this is NOT a newly created file, but an established existing file that was edited ---
	if !isNewFile && wasCached && cached != nil && cached.Logged {
		if cached.Size != size || (hash != "" && cached.Hash != "" && cached.Hash != hash) {
			m.fileCache[path] = &FileMetadata{Path: path, Size: size, ModTime: fi.ModTime(), Hash: hash, LastUpdated: now, Logged: true}
			ts := getTimestamp()
			if !m.isDuplicateEvent("MODIFY", path) {
				logMessage("\n[%s] %sMODIFY DETECTED%s\n  File: %s\n  File Size: %s\n",
					ts, colorMagenta, colorReset, path, formatBytes(size))
				if jsonMode {
					emitJSON(JSONEvent{Type: "MODIFY", Timestamp: ts, File: path, Size: formatBytes(size)})
				}
			}
		} else {
			m.fileCache[path] = &FileMetadata{Path: path, Size: size, ModTime: fi.ModTime(), Hash: hash, LastUpdated: now, Logged: true}
		}
		return
	}

	// --- Check 4: COPY detection ---
	var copySourcePath string
	destBase := strings.ToLower(filepath.Base(path))
	destExt := strings.ToLower(filepath.Ext(path))
	destStem := strings.TrimSuffix(destBase, destExt)
	destCleanName := strings.ReplaceAll(destStem, "_", " ")

	for srcPath := range m.fileCache {
		if strings.EqualFold(srcPath, path) {
			continue
		}
		srcFi, err := os.Stat(srcPath)
		if err != nil || srcFi.IsDir() {
			continue
		}

		srcSize := srcFi.Size()
		srcBase := strings.ToLower(filepath.Base(srcPath))
		srcExt := strings.ToLower(filepath.Ext(srcPath))
		srcStem := strings.TrimSuffix(srcBase, srcExt)
		srcCleanName := strings.ReplaceAll(srcStem, "_", " ")

		nameAndSizeMatch := (srcBase == destBase || srcCleanName == destCleanName) && srcSize == size && size > 0
		copySuffixMatch := srcSize == size && size > 0 && srcExt == destExt &&
			(strings.HasPrefix(destStem, srcStem+" - copy") ||
				strings.HasPrefix(destStem, srcStem+" (") ||
				strings.HasPrefix(destCleanName, srcCleanName+" - copy") ||
				strings.HasPrefix(destCleanName, srcCleanName+" ("))

		if nameAndSizeMatch || copySuffixMatch {
			copySourcePath = srcPath
			break
		}

		if srcSize == size && size > 0 {
			srcHash, _, _ := computeFastHash(srcPath)
			if srcHash != "" && hash != "" && srcHash == hash && hash != "empty" {
				copySourcePath = srcPath
				break
			}
		}
	}

	delete(m.newlyCreated, path)
	m.fileCache[path] = &FileMetadata{Path: path, Size: size, ModTime: fi.ModTime(), Hash: hash, LastUpdated: now, Logged: true}

	ext := filepath.Ext(path)
	if ext == "" {
		ext = "None"
	}
	ts := getTimestamp()

	if copySourcePath != "" {
		if ev, ok := m.recentCreates[path]; ok {
			ev.Detected = true
		}
		if !m.isDuplicateEvent("COPY", path) {
			logMessage("\n[%s] %sCOPY DETECTED%s\n  Source: %s\n  Destination: %s\n  File Size: %s\n  File Type: %s\n",
				ts, colorGreen, colorReset, copySourcePath, path, formatBytes(size), ext)
			if jsonMode {
				emitJSON(JSONEvent{Type: "COPY", Timestamp: ts, Source: copySourcePath, Destination: path, Size: formatBytes(size), FileType: ext})
			}
		}
		return
	}

	// --- Check 5: Plain CREATE DETECTED ---
	if !m.isDuplicateEvent("CREATE", path) {
		logMessage("\n[%s] %sCREATE DETECTED%s\n  File: %s\n  File Size: %s\n",
			ts, colorBlue, colorReset, path, formatBytes(size))
		if jsonMode {
			emitJSON(JSONEvent{Type: "CREATE", Timestamp: ts, File: path, Size: formatBytes(size), FileType: ext})
		}
	}
}

func main() {
	flag.BoolVar(&jsonMode, "json", false, "Output events as JSON lines to stdout (for dashboard integration)")
	flag.Parse()

	if !jsonMode {
		initConsole()
	}

	discovered, err := DiscoverDirectoryRoots()
	if err != nil {
		if jsonMode {
			emitJSON(JSONEvent{Type: "ERROR", Timestamp: getTimestamp(), Message: fmt.Sprintf("Failed to discover directories: %v", err)})
		} else {
			logMessage("%s[Error]%s Failed to discover directories: %v\n", colorRed, colorReset, err)
		}
		os.Exit(1)
	}

	if len(discovered) == 0 {
		if jsonMode {
			emitJSON(JSONEvent{Type: "ERROR", Timestamp: getTimestamp(), Message: "No valid directories or drives found"})
		} else {
			logMessage("%s[Error]%s No valid directories or drives found.\n", colorRed, colorReset)
		}
		os.Exit(1)
	}

	persisted, err := loadMonitoringConfig()
	if err != nil {
		if jsonMode {
			emitJSON(JSONEvent{Type: "ERROR", Timestamp: getTimestamp(), Message: fmt.Sprintf("Failed to load monitoring config: %v", err)})
		} else {
			logMessage("%s[Warning]%s Failed to load monitoring config: %v\n", colorYellow, colorReset, err)
		}
	}

	monitor, err := NewFileMonitor()
	if err != nil {
		if jsonMode {
			emitJSON(JSONEvent{Type: "ERROR", Timestamp: getTimestamp(), Message: fmt.Sprintf("Failed to initialize watcher: %v", err)})
		} else {
			logMessage("%s[Error]%s Failed to initialize watcher: %v\n", colorRed, colorReset, err)
		}
		os.Exit(1)
	}
	defer monitor.watcher.Close()

	monitor.setAvailableRoots(discovered)

	if jsonMode {
		monitor.emitDirectorySnapshot()
	}

	if len(persisted) > 0 {
		monitor.restorePersistedWatches(persisted)
	}

	if jsonMode {
		monitor.emitWatchedFoldersSnapshot()
	}

	if !jsonMode {
		ts := getTimestamp()
		logMessage("[%s] %sFile System Monitor Started%s\n", ts, colorBold, colorReset)
		logMessage("Available roots: %d | Watched roots: %d\n", len(discovered), len(monitor.getWatchedRootsList()))
		logMessage("\n%s[Listening for file system events... Press Ctrl+C to stop]%s\n", colorGray, colorReset)
	}

	// Graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	monitor.StartDriveMonitor()
	go monitor.StartEventLoop()
	go monitor.ListenForCommands()

	<-sigChan
	if !jsonMode {
		logMessage("\n[%s] %sFile System Monitor Stopped.%s\n", getTimestamp(), colorYellow, colorReset)
	}
}
