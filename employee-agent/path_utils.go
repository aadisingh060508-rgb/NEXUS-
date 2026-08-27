package main

import (
	"path/filepath"
	"strings"
)

// normalizePath returns a canonical Windows path for comparisons.
// Drive roots become "X:\"; other paths are cleaned without trailing separators.
func normalizePath(p string) string {
	if p == "" {
		return ""
	}
	clean := filepath.Clean(p)
	clean = strings.ReplaceAll(clean, "/", `\`)

	vol := filepath.VolumeName(clean)
	if vol != "" {
		letter := strings.ToUpper(vol[:len(vol)-1])
		rest := strings.TrimPrefix(clean, vol)
		rest = strings.Trim(rest, `\`)
		if rest == "" {
			return letter + `:\`
		}
		clean = letter + `:` + `\` + rest
	}

	if isDriveRoot(clean) {
		return strings.ToUpper(clean[:2]) + `\`
	}

	return strings.TrimRight(clean, `\`)
}

// displayPath formats a path for UI/emission (drive roots keep trailing backslash).
func displayPath(p string) string {
	n := normalizePath(p)
	if isDriveRoot(n) {
		return n
	}
	return n
}

func pathsEqual(a, b string) bool {
	return strings.EqualFold(normalizePath(a), normalizePath(b))
}

func pathKey(p string) string {
	return strings.ToLower(normalizePath(p))
}

// isDriveRoot reports whether path is a drive root like "C:\", "C:", "C:/".
func isDriveRoot(p string) bool {
	if len(p) == 2 && p[1] == ':' {
		return true
	}
	if len(p) == 3 && p[1] == ':' && (p[2] == '\\' || p[2] == '/') {
		return true
	}
	return false
}

// isPathWithin reports whether child is equal to or nested under root.
func isPathWithin(child, root string) bool {
	childNorm := normalizePath(child)
	rootNorm := normalizePath(root)
	if childNorm == "" || rootNorm == "" {
		return false
	}
	if pathsEqual(childNorm, rootNorm) {
		return true
	}
	if isDriveRoot(rootNorm) {
		prefix := strings.ToUpper(rootNorm[:2])
		return strings.HasPrefix(strings.ToUpper(childNorm), prefix)
	}
	childLower := strings.ToLower(childNorm)
	rootLower := strings.ToLower(rootNorm)
	if !strings.HasPrefix(childLower, rootLower) {
		return false
	}
	if len(childLower) == len(rootLower) {
		return true
	}
	return childLower[len(rootLower)] == '\\'
}

// isAncestor reports whether parent is a strict ancestor of child.
func isAncestor(parent, child string) bool {
	parentNorm := normalizePath(parent)
	childNorm := normalizePath(child)
	if parentNorm == "" || childNorm == "" {
		return false
	}
	if pathsEqual(parentNorm, childNorm) {
		return false
	}
	return isPathWithin(childNorm, parentNorm)
}
