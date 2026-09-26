package main

import (
	"os"
	"path/filepath"
	"strings"
	"syscall"

	"golang.org/x/sys/windows"
)

// DirectoryRoot describes a parent-level directory available for monitoring.
type DirectoryRoot struct {
	Path      string `json:"path"`
	Name      string `json:"name"`
	Kind      string `json:"kind"` // user_folder | drive | removable
	Removable bool   `json:"removable"`
	Available bool   `json:"available"`
}

// DirectorySnapshot is emitted to communicate all currently available roots.
type DirectorySnapshot struct {
	Type        string          `json:"type"`
	Directories []DirectoryRoot `json:"directories"`
}

// DirectoryAddedEvent is emitted when a new root becomes available.
type DirectoryAddedEvent struct {
	Type      string        `json:"type"`
	Directory DirectoryRoot `json:"directory"`
}

// DirectoryRemovedEvent is emitted when a root is no longer available.
type DirectoryRemovedEvent struct {
	Type string `json:"type"`
	Path string `json:"path"`
}

var userFolderNames = []struct {
	name string
	dir  string
}{
	{"Desktop", "Desktop"},
	{"Documents", "Documents"},
	{"Downloads", "Downloads"},
	{"Pictures", "Pictures"},
	{"Music", "Music"},
	{"Videos", "Videos"},
}

func getDriveLabel(root string) string {
	rootPtr, err := syscall.UTF16PtrFromString(normalizePath(root))
	if err != nil {
		return driveDisplayName(root, false)
	}

	volName := make([]uint16, windows.MAX_PATH+1)
	fsName := make([]uint16, windows.MAX_PATH+1)
	var serialNum, maxCompLen, fsFlags uint32

	err = windows.GetVolumeInformation(rootPtr, &volName[0], uint32(len(volName)),
		&serialNum, &maxCompLen, &fsFlags, &fsName[0], uint32(len(fsName)))
	if err == nil {
		label := windows.UTF16ToString(volName)
		label = strings.TrimSpace(label)
		if label != "" {
			letter := strings.ToUpper(root[:2])
			return label + " (" + letter + ")"
		}
	}
	return driveDisplayName(root, false)
}

func driveDisplayName(root string, removable bool) string {
	letter := strings.ToUpper(normalizePath(root)[:2])
	if removable {
		return "USB Drive (" + letter + ")"
	}
	if strings.EqualFold(letter, os.Getenv("SystemDrive")) || strings.EqualFold(letter, "C:") {
		return "OS (" + letter + ")"
	}
	return "Drive (" + letter + ")"
}

func driveKind(_ string, driveType uint32) (kind string, removable bool) {
	switch driveType {
	case windows.DRIVE_REMOVABLE, windows.DRIVE_CDROM:
		return "removable", true
	default:
		return "drive", false
	}
}

func discoverDrives() ([]DirectoryRoot, error) {
	bitmask, err := windows.GetLogicalDrives()
	if err != nil {
		return nil, err
	}

	var roots []DirectoryRoot
	for i := 0; i < 26; i++ {
		if (bitmask & (1 << uint(i))) == 0 {
			continue
		}
		letter := string(rune('A'+i)) + `:`
		root := normalizePath(letter + `\`)

		rootPtr, err := syscall.UTF16PtrFromString(root)
		if err != nil {
			continue
		}
		driveType := windows.GetDriveType(rootPtr)
		if driveType == windows.DRIVE_NO_ROOT_DIR || driveType == windows.DRIVE_UNKNOWN {
			continue
		}

		kind, removable := driveKind(root, driveType)
		name := getDriveLabel(root)
		if removable {
			name = driveDisplayName(root, true)
		}

		roots = append(roots, DirectoryRoot{
			Path:      displayPath(root),
			Name:      name,
			Kind:      kind,
			Removable: removable,
			Available: true,
		})
	}
	return roots, nil
}

func discoverUserFolders(homeDir string) []DirectoryRoot {
	var roots []DirectoryRoot
	seen := make(map[string]bool)

	addIfExists := func(name, folderPath string) {
		if _, err := os.Stat(folderPath); err != nil {
			return
		}
		key := pathKey(folderPath)
		if seen[key] {
			return
		}
		seen[key] = true
		roots = append(roots, DirectoryRoot{
			Path:      displayPath(folderPath),
			Name:      name,
			Kind:      "user_folder",
			Removable: false,
			Available: true,
		})
	}

	for _, uf := range userFolderNames {
		addIfExists(uf.name, filepath.Join(homeDir, uf.dir))
	}

	oneDriveRoot := filepath.Join(homeDir, "OneDrive")
	if _, err := os.Stat(oneDriveRoot); err == nil {
		for _, uf := range userFolderNames {
			addIfExists(uf.name+" (OneDrive)", filepath.Join(oneDriveRoot, uf.dir))
		}
	}

	return roots
}

// DiscoverDirectoryRoots returns parent-level directories/drives without watching them.
func DiscoverDirectoryRoots() ([]DirectoryRoot, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}

	roots := discoverUserFolders(homeDir)
	drives, err := discoverDrives()
	if err != nil {
		return roots, err
	}

	dedup := make(map[string]DirectoryRoot)
	for _, r := range roots {
		dedup[pathKey(r.Path)] = r
	}
	for _, r := range drives {
		dedup[pathKey(r.Path)] = r
	}

	out := make([]DirectoryRoot, 0, len(dedup))
	for _, r := range dedup {
		out = append(out, r)
	}
	return out, nil
}

func directoryRootForPath(path string) DirectoryRoot {
	norm := normalizePath(path)
	rootPtr, _ := syscall.UTF16PtrFromString(norm)
	driveType := windows.GetDriveType(rootPtr)

	if isDriveRoot(norm) {
		kind, removable := driveKind(norm, driveType)
		name := getDriveLabel(norm)
		if removable {
			name = driveDisplayName(norm, true)
		}
		return DirectoryRoot{
			Path:      displayPath(norm),
			Name:      name,
			Kind:      kind,
			Removable: removable,
			Available: true,
		}
	}

	name := filepath.Base(norm)
	return DirectoryRoot{
		Path:      displayPath(norm),
		Name:      name,
		Kind:      "user_folder",
		Removable: false,
		Available: true,
	}
}

// isReparsePoint reports whether a directory is a reparse point (junction/symlink).
func isReparsePoint(info os.FileInfo) bool {
	if info == nil || !info.IsDir() {
		return false
	}
	stat, ok := info.Sys().(*syscall.Win32FileAttributeData)
	if !ok {
		return false
	}
	return stat.FileAttributes&syscall.FILE_ATTRIBUTE_REPARSE_POINT != 0
}
