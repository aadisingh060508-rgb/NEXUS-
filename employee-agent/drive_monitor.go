package main

import (
	"fmt"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/windows"
)

// StartDriveMonitor polls for drive connect/disconnect and updates available roots.
func (m *FileMonitor) StartDriveMonitor() {
	go func() {
		knownDrives := make(map[string]bool)

		m.mu.RLock()
		for _, root := range m.availableRoots {
			if root.Kind == "drive" || root.Kind == "removable" || isDriveRoot(root.Path) {
				knownDrives[strings.ToUpper(normalizePath(root.Path))] = true
			}
		}
		m.mu.RUnlock()

		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()

		for range ticker.C {
			bitmask, err := windows.GetLogicalDrives()
			if err != nil {
				continue
			}

			currentDrives := make(map[string]bool)
			for i := 0; i < 26; i++ {
				if (bitmask & (1 << uint(i))) == 0 {
					continue
				}
				drive := normalizePath(fmt.Sprintf("%c:\\", 'A'+i))
				currentDrives[strings.ToUpper(drive)] = true
			}

			for drive := range currentDrives {
				upper := strings.ToUpper(drive)
				if knownDrives[upper] {
					continue
				}
				knownDrives[upper] = true

				rootPtr, _ := syscall.UTF16PtrFromString(drive)
				driveType := windows.GetDriveType(rootPtr)
				if driveType == windows.DRIVE_NO_ROOT_DIR {
					continue
				}

				dir := directoryRootForPath(drive)

				m.mu.Lock()
				m.availableRoots[pathKey(dir.Path)] = dir
				m.mu.Unlock()

				if jsonMode {
					emitJSON2(DirectoryAddedEvent{Type: "DIRECTORY_ADDED", Directory: dir})
				}

				if dir.Removable {
					ts := getTimestamp()
					logMessage("\n[%s] %sPEN DRIVE INSERTED%s\n  Drive: %s\n", ts, colorMagenta, colorReset, dir.Path)
					if jsonMode {
						emitJSON(JSONEvent{
							Type:        "pen_drive_insert",
							Timestamp:   ts,
							File:        dir.Path,
							Destination: dir.Path,
							Message:     fmt.Sprintf("Pen drive inserted: %s", dir.Path),
							IsExternal:  true,
						})
					}
				}

				if isDesiredWatch(dir.Path) {
					result := m.WatchRoot(dir.Path)
					if jsonMode && result.Success {
						emitJSON2(CommandAck{
							Type:          "COMMAND_ACK",
							Action:        "watch",
							Path:          dir.Path,
							Success:       true,
							CanonicalPath: result.CanonicalPath,
						})
						m.emitWatchedFoldersSnapshot()
					}
				}
			}

			for drive := range knownDrives {
				if currentDrives[drive] {
					continue
				}
				delete(knownDrives, drive)

				displayDrive := displayPath(drive)
				wasWatched := false
				var wasRemovable bool
				m.mu.RLock()
				if entry, ok := m.availableRoots[pathKey(displayDrive)]; ok {
					wasRemovable = entry.Removable
				}
				for key := range m.watchedRoots {
					if pathsEqual(key, drive) {
						wasWatched = true
						break
					}
				}
				m.mu.RUnlock()

				if wasWatched {
					m.UnwatchRoot(displayDrive)
					if jsonMode {
						m.emitWatchedFoldersSnapshot()
					}
				}

				m.mu.Lock()
				delete(m.availableRoots, pathKey(displayDrive))
				m.purgeCacheUnderRoot(displayDrive)
				m.mu.Unlock()

				ts := getTimestamp()
				if jsonMode {
					emitJSON2(DirectoryRemovedEvent{Type: "DIRECTORY_REMOVED", Path: displayDrive})
				}

				if wasRemovable {
					logMessage("\n[%s] %sPEN DRIVE EJECTED%s\n  Drive: %s\n", ts, colorYellow, colorReset, displayDrive)
					if jsonMode {
						emitJSON(JSONEvent{
							Type:       "pen_drive_eject",
							Timestamp:  ts,
							File:       displayDrive,
							Source:     displayDrive,
							Message:    fmt.Sprintf("Pen drive ejected: %s", displayDrive),
							IsExternal: true,
						})
					}
				}
			}
		}
	}()
}
