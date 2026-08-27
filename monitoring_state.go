package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

const monitoringConfigPath = "data/monitoring-config.json"

// MonitoringConfig persists admin-selected watch roots across restarts.
type MonitoringConfig struct {
	WatchedRoots []string `json:"watchedRoots"`
}

var (
	configMu     sync.Mutex
	desiredRoots []string // normalized keys of admin-selected roots
)

func loadMonitoringConfig() ([]string, error) {
	configMu.Lock()
	defer configMu.Unlock()

	data, err := os.ReadFile(monitoringConfigPath)
	if err != nil {
		if os.IsNotExist(err) {
			desiredRoots = nil
			return nil, nil
		}
		return nil, err
	}

	var cfg MonitoringConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}

	normalized := make([]string, 0, len(cfg.WatchedRoots))
	seen := make(map[string]bool)
	for _, p := range cfg.WatchedRoots {
		key := pathKey(p)
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		normalized = append(normalized, displayPath(p))
	}
	desiredRoots = normalized
	return normalized, nil
}

func saveMonitoringConfig(roots []string) error {
	configMu.Lock()
	defer configMu.Unlock()

	dedup := make(map[string]string)
	for _, p := range roots {
		key := pathKey(p)
		if key == "" {
			continue
		}
		dedup[key] = displayPath(p)
	}

	out := make([]string, 0, len(dedup))
	for _, p := range dedup {
		out = append(out, p)
	}
	desiredRoots = out

	if err := os.MkdirAll(filepath.Dir(monitoringConfigPath), 0755); err != nil {
		return err
	}

	data, err := json.MarshalIndent(MonitoringConfig{WatchedRoots: out}, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(monitoringConfigPath, data, 0644)
}

func getDesiredWatchedRoots() []string {
	configMu.Lock()
	defer configMu.Unlock()
	out := make([]string, len(desiredRoots))
	copy(out, desiredRoots)
	return out
}

func isDesiredWatch(path string) bool {
	key := pathKey(path)
	configMu.Lock()
	defer configMu.Unlock()
	for _, p := range desiredRoots {
		if pathKey(p) == key {
			return true
		}
	}
	return false
}

func syncDesiredWithActive(active []string) error {
	return saveMonitoringConfig(active)
}
