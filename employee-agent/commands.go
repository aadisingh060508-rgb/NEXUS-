package main

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// Command is a single instruction sent from server.js over stdin.
type Command struct {
	Action string     `json:"action"`
	Path   string     `json:"path"`
	Policy *USBPolicy `json:"policy,omitempty"`
}

// CommandAck confirms a command was applied by the Go monitor.
type CommandAck struct {
	Type          string `json:"type"`
	Action        string `json:"action"`
	Path          string `json:"path"`
	Success       bool   `json:"success"`
	Error         string `json:"error,omitempty"`
	CanonicalPath string `json:"canonicalPath,omitempty"`
}

// WatchedFoldersSnapshot lists currently watched canonical roots.
type WatchedFoldersSnapshot struct {
	Type    string   `json:"type"`
	Folders []string `json:"folders"`
}

func (m *FileMonitor) ListenForCommands() {
	scanner := bufio.NewScanner(os.Stdin)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		var cmd Command
		if err := json.Unmarshal([]byte(line), &cmd); err != nil {
			continue
		}

		switch strings.ToLower(cmd.Action) {
		case "watch":
			m.handleWatchCommand(cmd.Path)
		case "unwatch":
			m.handleUnwatchCommand(cmd.Path)
		case "update_policy":
			if cmd.Policy != nil {
				m.policyEngine.SetPolicy(*cmd.Policy)
				if jsonMode {
					emitJSON2(CommandAck{Type: "COMMAND_ACK", Action: "update_policy", Success: true})
				}
			}
		default:
			if jsonMode {
				emitJSON2(CommandAck{Type: "COMMAND_ACK", Action: cmd.Action, Path: cmd.Path, Success: false, Error: "unknown action"})
			}
		}
	}

	if err := scanner.Err(); err != nil {
		logMessage("Error reading standard input: %v\n", err)
	}
}

func (m *FileMonitor) handleWatchCommand(path string) {
	result := m.WatchRoot(path)
	if !jsonMode {
		return
	}

	ack := CommandAck{
		Type:          "COMMAND_ACK",
		Action:        "watch",
		Path:          path,
		Success:       result.Success,
		CanonicalPath: result.CanonicalPath,
	}
	if result.Error != "" && !result.Success {
		ack.Error = result.Error
	} else if result.Already && result.Error != "" {
		ack.Error = result.Error
	}
	emitJSON2(ack)
	if result.Success {
		m.emitWatchedFoldersSnapshot()
	}
}

func (m *FileMonitor) handleUnwatchCommand(path string) {
	result := m.UnwatchRoot(path)
	if !jsonMode {
		return
	}

	ack := CommandAck{
		Type:          "COMMAND_ACK",
		Action:        "unwatch",
		Path:          path,
		Success:       result.Success,
		CanonicalPath: result.CanonicalPath,
	}
	if result.Error != "" && !result.Success {
		ack.Error = result.Error
	}
	emitJSON2(ack)
	if result.Success {
		m.emitWatchedFoldersSnapshot()
	}
}

func (m *FileMonitor) removeWatch(root string) {
	root = normalizePath(root)
	_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil || info == nil || !info.IsDir() {
			return nil
		}
		_ = m.watcher.Remove(path)
		return nil
	})
	_ = m.watcher.Remove(root)
}

func emitJSON2(v interface{}) {
	data, err := json.Marshal(v)
	if err != nil {
		return
	}
	os.Stdout.Write(data)
	os.Stdout.Write([]byte("\n"))
	_ = os.Stdout.Sync()
}
