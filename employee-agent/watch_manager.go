package main

import (
	"os"
	"path/filepath"
	"strings"
	"time"
)

// WatchResult describes the outcome of a watch/unwatch operation.
type WatchResult struct {
	CanonicalPath string
	Success       bool
	Error         string
	Already       bool
}

func (m *FileMonitor) setAvailableRoots(roots []DirectoryRoot) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.availableRoots = make(map[string]DirectoryRoot, len(roots))
	for _, r := range roots {
		m.availableRoots[pathKey(r.Path)] = r
	}
}

func (m *FileMonitor) getAvailableRootsList() []DirectoryRoot {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]DirectoryRoot, 0, len(m.availableRoots))
	for _, r := range m.availableRoots {
		out = append(out, r)
	}
	return out
}

func (m *FileMonitor) emitDirectorySnapshot() {
	if !jsonMode {
		return
	}
	emitJSON2(DirectorySnapshot{
		Type:        "DIRECTORY_SNAPSHOT",
		Directories: m.getAvailableRootsList(),
	})
}

func (m *FileMonitor) emitWatchedFoldersSnapshot() {
	if !jsonMode {
		return
	}
	emitJSON2(WatchedFoldersSnapshot{
		Type:    "WATCHED_FOLDERS",
		Folders: m.getWatchedRootsList(),
	})
}

func (m *FileMonitor) getWatchedRootsList() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]string, 0, len(m.watchedRoots))
	for _, display := range m.watchedRoots {
		out = append(out, display)
	}
	return out
}

func (m *FileMonitor) isWatchedPath(path string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for rootKey := range m.watchedRoots {
		if isPathWithin(path, rootKey) {
			return true
		}
	}
	return false
}

func (m *FileMonitor) purgeCacheUnderRoot(root string) {
	rootNorm := normalizePath(root)
	for k := range m.fileCache {
		if isPathWithin(k, rootNorm) {
			delete(m.fileCache, k)
		}
	}
}

// WatchRoot adds a canonical watch root and registers fsnotify handlers.
func (m *FileMonitor) WatchRoot(path string) WatchResult {
	clean := normalizePath(path)
	if clean == "" {
		return WatchResult{Success: false, Error: "invalid path"}
	}

	fi, err := os.Stat(clean)
	if err != nil {
		return WatchResult{CanonicalPath: clean, Success: false, Error: "path does not exist"}
	}
	if !fi.IsDir() {
		return WatchResult{CanonicalPath: clean, Success: false, Error: "not a directory"}
	}

	display := displayPath(clean)

	m.mu.Lock()
	for existingKey, existingDisplay := range m.watchedRoots {
		if pathsEqual(existingKey, clean) {
			m.mu.Unlock()
			return WatchResult{CanonicalPath: existingDisplay, Success: true, Already: true}
		}
		if isAncestor(existingKey, clean) {
			m.mu.Unlock()
			return WatchResult{CanonicalPath: existingDisplay, Success: true, Already: true, Error: "already covered by parent"}
		}
	}

	var toRemove []string
	for existingKey := range m.watchedRoots {
		if isAncestor(clean, existingKey) {
			toRemove = append(toRemove, existingKey)
		}
	}
	for _, descKey := range toRemove {
		descDisplay := m.watchedRoots[descKey]
		delete(m.watchedRoots, descKey)
		m.mu.Unlock()
		go m.removeWatch(descDisplay)
		m.mu.Lock()
		m.purgeCacheUnderRoot(descDisplay)
	}

	m.watchedRoots[pathKey(clean)] = display
	m.mu.Unlock()

	go func(targetPath string) {
		_ = m.walkAndWatch(targetPath, 0)
	}(display)

	active := m.getWatchedRootsList()
	_ = syncDesiredWithActive(active)

	return WatchResult{CanonicalPath: display, Success: true}
}

// UnwatchRoot removes a watch root and cleans up fsnotify registrations and cache.
func (m *FileMonitor) UnwatchRoot(path string) WatchResult {
	clean := normalizePath(path)
	if clean == "" {
		return WatchResult{Success: false, Error: "invalid path"}
	}

	m.mu.Lock()
	key := pathKey(clean)
	display, found := m.watchedRoots[key]
	if !found {
		for k, d := range m.watchedRoots {
			if pathsEqual(k, clean) {
				key = k
				display = d
				found = true
				break
			}
		}
	}

	if !found {
		m.mu.Unlock()
		go m.removeWatch(displayPath(clean))
		return WatchResult{CanonicalPath: displayPath(clean), Success: true, Already: true}
	}

	delete(m.watchedRoots, key)

	var descendantKeys []string
	for k, d := range m.watchedRoots {
		if isPathWithin(d, display) {
			descendantKeys = append(descendantKeys, k)
		}
	}
	for _, k := range descendantKeys {
		delete(m.watchedRoots, k)
	}
	m.mu.Unlock()

	go func(targetPath string) {
		m.removeWatch(targetPath)
		m.mu.Lock()
		m.purgeCacheUnderRoot(targetPath)
		m.mu.Unlock()
	}(display)

	active := m.getWatchedRootsList()
	_ = syncDesiredWithActive(active)

	return WatchResult{CanonicalPath: display, Success: true}
}

func (m *FileMonitor) restorePersistedWatches(paths []string) {
	for _, p := range paths {
		if _, err := os.Stat(normalizePath(p)); err != nil {
			continue
		}
		result := m.WatchRoot(p)
		if !result.Success && result.Error != "already covered by parent" {
			continue
		}
	}
}

// walkAndWatch recursively walks a directory tree and registers watchers.
func (m *FileMonitor) walkAndWatch(root string, maxDepth int) error {
	root = normalizePath(root)
	rootDepth := strings.Count(root, `\`)

	var walkErr error
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			if os.IsPermission(err) {
				return filepath.SkipDir
			}
			return nil
		}
		if info == nil {
			return nil
		}

		if info.IsDir() {
			if path != root && isReparsePoint(info) {
				return filepath.SkipDir
			}
			if maxDepth > 0 {
				depth := strings.Count(normalizePath(path), `\`) - rootDepth
				if isDriveRoot(root) {
					depth = strings.Count(normalizePath(path), `\`) - 1
				}
				if depth > maxDepth {
					return filepath.SkipDir
				}
			}
			if shouldSkipDir(info.Name()) && !pathsEqual(path, root) {
				return filepath.SkipDir
			}
			if addErr := m.watcher.Add(path); addErr != nil {
				walkErr = addErr
			}
			return nil
		}

		if !isNoiseFile(path) {
			m.mu.Lock()
			m.fileCache[path] = &FileMetadata{
				Path:        path,
				Size:        info.Size(),
				ModTime:     info.ModTime(),
				LastUpdated: time.Now(),
				Logged:      true,
			}
			m.mu.Unlock()
		}
		return nil
	})
	if err != nil {
		return err
	}
	return walkErr
}
