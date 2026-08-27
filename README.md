# Local File System Monitor (Windows)

A real-time, high-performance file system monitoring application built for Windows using Go and the `fsnotify` library.

---

## Features

- **Monitored Directories**:
  - `C:\Users\<username>\Downloads`
  - `C:\Users\<username>\Pictures`
  - `C:\Users\<username>\Videos`
  - `C:\Users\<username>\Documents`
  - `C:\Users\<username>\Desktop`
  - Automatic recursive watching for all subfolders (including newly created folders).
- **Operation Detection**:
  - **COPY**: Correlates file creation with known files across monitored folders.
  - **MOVE**: Correlates file deletions and creations / cross-directory moves. Identifies external/USB destinations.
  - **DELETE**: Detects file deletion with last-known file size.
  - **RENAME**: Detects file renames within the same directory with old/new names.
  - **CREATE**: Detects brand new file creation.
  - **MODIFY**: Debounced file write and content modification detection.
- **Terminal Output**:
  - Precise timestamp `[YYYY-MM-DD HH:MM:SS]`.
  - Color-coded operation tags.
  - Human-readable file sizes (`KB`, `MB`, `GB`).
  - Formatted file paths.
- **Noise Filtering**: Automatically ignores temporary lock files (`~$*`, `*.tmp`, `thumbs.db`, `desktop.ini`).

---

## File Structure

```
ITR Project/
├── main.go          # Core file watcher and event correlation engine
├── go.mod           # Go module definitions and dependencies
├── go.sum           # Dependency checksums
├── fsmonitor.exe    # Compiled Windows executable
└── README.md        # Documentation and usage guide
```

---

## Requirements

- **OS**: Windows 10 or Windows 11
- **Go**: Version 1.20 or later (installed with `winget install GoLang.Go`)

---

## Quick Start

### 1. Run with `go run`
```bash
go run main.go
```

### 2. Or Build and Run Executable
```bash
# Build the binary
go build -o fsmonitor.exe main.go

# Run the monitor
.\fsmonitor.exe
```

---

## Sample Console Output

```text
[2024-08-18 17:32:15] File System Monitor Started
Watching: C:\Users\alice\Downloads\
Watching: C:\Users\alice\Pictures\
Watching: C:\Users\alice\Videos\
Watching: C:\Users\alice\Documents\
Watching: C:\Users\alice\Desktop\

[Listening for file system events... Press Ctrl+C to stop]

[2024-08-18 17:32:45] COPY DETECTED
  Source: C:\Users\alice\Documents\ClientList.xlsx
  Destination: C:\Users\alice\Downloads\ClientList.xlsx
  File Size: 2.5 MB
  File Type: .xlsx

[2024-08-18 17:35:42] MOVE DETECTED
  Source: C:\Users\alice\Downloads\Report.pdf
  Destination: E:\Report.pdf
  File Size: 5.1 MB
  Status: ✓ External Device (USB)

[2024-08-18 17:38:00] DELETE DETECTED
  File: C:\Users\alice\Documents\Draft_Email.txt
  File Size: 15 KB

[2024-08-18 17:40:33] RENAME DETECTED
  Old Name: Contract_v1.docx
  New Name: Contract_FINAL.docx
  Path: C:\Users\alice\Documents\

[2024-08-18 17:42:10] CREATE DETECTED
  File: C:\Users\alice\Desktop\notes.txt
  File Size: 120 B
```

---

## Stopping the Application

Press `Ctrl+C` in the terminal to stop the monitor gracefully.
