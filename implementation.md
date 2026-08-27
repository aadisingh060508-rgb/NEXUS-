# Directory-Wise Monitoring — Implementation Plan

## 1. Feature Goal

Build a **single-laptop directory monitoring system** where:

```text
Monitoring Agent
      ↓
Discovers top-level monitoring roots
      ↓
Server
      ↓
Admin UI
      ↓
Admin ON/OFF
      ↓
Agent watches/unwatches selected parent directories recursively
```

The existing file-event engine remains the foundation. The main change is separating:

```text
AVAILABLE DIRECTORIES
```

from:

```text
WATCHED DIRECTORIES
```

A directory being discovered must **not automatically mean it is being monitored**.

---

# 2. Current Codebase Assessment

The current project already contains most of the filesystem-monitoring engine.

### Existing and reusable

* `fsnotify` recursive directory monitoring
* File create/delete/modify/rename detection
* File metadata/cache logic
* Dynamic drive detection
* Drive insertion/removal events
* Go ↔ Node stdin/stdout command channel
* `watch` / `unwatch` commands
* `COMMAND_ACK`
* `WATCHED_FOLDERS` snapshot
* `/api/watch`
* `/api/unwatch`
* `/api/watched-folders`
* WebSocket event broadcasting
* Existing React WebSocket connection

### Main changes required

1. Replace automatic "watch everything discovered" behavior with **discovery-only** behavior.
2. Add a clean **available parent-directory model**.
3. Add admin UI for parent-directory ON/OFF.
4. Make watched roots **canonical and non-redundant**.
5. Make external-drive detection update the available directory list.
6. Add robust persistence/recovery.
7. Harden concurrency, ACK handling, and edge cases.

---

# 3. Core Data Model

The system should maintain two separate concepts.

## Available roots

Directories/drives that currently exist on the machine.

```go
type DirectoryRoot struct {
    Path        string `json:"path"`
    Name        string `json:"name"`
    Kind        string `json:"kind"`        // user_folder | drive | removable
    Removable   bool   `json:"removable"`
    Available   bool   `json:"available"`
}
```

Example:

```text
Desktop
Documents
Downloads
Pictures
C:\
D:\
E:\
```

## Watched roots

Only directories explicitly enabled by the admin.

```go
watchedRoots map[string]struct{}
```

Use a normalized path as the key.

---

# 4. Path Normalization

## Problem

The same Windows path can arrive in different forms:

```text
C:\Projects
c:\projects\
C:/Projects
```

Simple string comparisons can therefore create duplicates or failed unwatch operations.

## Solution

Create one canonical helper:

```go
func normalizePath(path string) string
```

It should:

1. Clean the path.
2. Convert separators to the Windows form.
3. Remove unnecessary trailing separators.
4. Normalize case for comparisons.
5. Preserve the correct drive-root representation.

Use the normalized representation for all internal comparisons.

Keep the original/canonical display path separately if needed.

---

# 5. Canonical Watch-Root Logic

## Problem

The admin could enable:

```text
C:\
C:\Users
C:\Users\John
```

Only `C:\` is actually necessary.

## Rule

For a new watch root `R`:

```text
if an existing root P is an ancestor of R:
    ignore R
```

Otherwise:

```text
remove all existing roots that are descendants of R
add R
```

### Algorithm

```text
addWatchRoot(R):

normalize R

for each existing root P:
    if P == R:
        return already watched

    if P is ancestor of R:
        return already covered

remove every existing P where R is ancestor of P

add R
```

### Complexity

With `n` watched roots:

```text
O(n)
```

Since the watched-root list is expected to be small, this is preferable to maintaining unnecessary tree structures.

---

# 6. Canonical Unwatch Logic

## Problem

If:

```text
C:\          ON
C:\Projects  ON
```

and `C:\` is turned OFF, there should not be a hidden `C:\Projects` watch left behind.

## Rule

Because only canonical roots are stored, `C:\Projects` should never exist while `C:\` already covers it.

Therefore:

```text
unwatch(R)
```

removes only the canonical root `R`.

If descendants were previously stored because of old state, remove every stored root contained under `R`.

This makes the server and Go watcher state deterministic.

---

# 7. Directory Discovery

## Problem

Current Go startup logic builds `activeFolders` and immediately uses them as `watchedFolders`.

That conflates:

```text
"exists"
```

with:

```text
"should be monitored"
```

## Solution

Introduce a discovery layer.

Example:

```go
func DiscoverDirectoryRoots() ([]DirectoryRoot, error)
```

It should discover only the parent-level roots required by the admin UI.

### User folders

Use Windows-known user directories where available:

```text
Desktop
Documents
Downloads
Pictures
Music
Videos
```

### Drives

Discover currently available filesystem volumes:

```text
C:\
D:\
E:\
```

Drive metadata should include whether it is removable.

### Important behavior

Discovery does **not** call `watcher.Add()`.

It only returns metadata.

---

# 8. External Drive Detection

## Existing capability

The project already polls `GetLogicalDrives()` and detects insertion/removal.

## Required change

Current behavior effectively does:

```text
new drive
   ↓
automatically add to watchedFolders
   ↓
start monitoring
```

Change it to:

```text
new drive
   ↓
add to availableRoots
   ↓
emit DIRECTORY_ADDED
```

Only after:

```text
admin → ON
```

should the Go monitor call `walkAndWatch()`.

### Removal

When a drive disappears:

```text
remove from availableRoots
remove from watchedRoots if it was being watched
remove its active watcher registrations
clear related cache entries
emit DIRECTORY_REMOVED
```

---

# 9. Go Monitor Refactor

## `main.go`

### Keep

* `FileMetadata`
* event correlation
* `handleEvent`
* hashing
* file event processing
* recursive watcher implementation

### Update

#### `FileMonitor`

Replace:

```go
watchedFolders []string
```

with a canonical structure, preferably:

```go
watchedRoots map[string]string
```

Where:

```text
key   = normalized comparison path
value = canonical display path
```

Also add:

```go
availableRoots map[string]DirectoryRoot
```

This makes lookup and duplicate prevention deterministic.

---

# 10. Recursive Watcher

## Existing

`walkAndWatch()` already performs recursive registration.

Reuse it.

## Required improvement

Separate:

```text
watchRoot(root)
```

from:

```text
walkAndWatch(root, depth)
```

Recommended structure:

```go
func (m *FileMonitor) watchRoot(root string) error
func (m *FileMonitor) unwatchRoot(root string) error
func (m *FileMonitor) walkAndWatch(root string, maxDepth int)
func (m *FileMonitor) removeWatch(root string)
```

The root-management methods should own the state changes.

The recursive functions should only own filesystem watcher registration/removal.

This prevents state corruption.

---

# 11. Full Recursive Monitoring

## Problem

Current drive roots use:

```go
m.walkAndWatch(folder, 2)
```

Therefore `C:\` or another drive does not truly cover the entire tree.

## Required behavior

For a selected parent root:

```text
C:\
```

the monitor should recursively cover the complete supported subtree.

For normal directories:

```text
Documents
```

it already recursively watches.

### Important implementation decision

Do **not** simply change `2` to `0` and assume the problem is solved.

Full-drive monitoring must be tested against:

* huge directory trees
* access-denied locations
* system directories
* reparse points/junctions
* watcher handle/resource limits

The production implementation should define explicit safe traversal rules.

---

# 12. Reparse Points / Junctions

## Problem

Windows directory trees can contain junctions/reparse points.

Naively traversing them can cause:

```text
directory A
  ↓
junction
  ↓
directory B
  ↓
junction back to A
```

or monitoring outside the intended root.

## Solution

The traversal layer should identify reparse-point directories and define a consistent policy.

For the first robust version:

```text
skip directory reparse points unless explicitly supported
```

This prevents accidental traversal outside the selected monitoring root.

---

# 13. New Commands

Current:

```json
{"action":"watch","path":"C:\\Projects"}
{"action":"unwatch","path":"C:\\Projects"}
```

Keep these.

Add discovery-related messages from Go to Node.

### Directory snapshot

```json
{
  "type": "DIRECTORY_SNAPSHOT",
  "directories": [
    {
      "path": "C:\\Users\\John\\Documents",
      "name": "Documents",
      "kind": "user_folder",
      "removable": false
    },
    {
      "path": "D:\\",
      "name": "New Volume (D:)",
      "kind": "drive",
      "removable": false
    }
  ]
}
```

### Directory added

```json
{
  "type": "DIRECTORY_ADDED",
  "directory": {
    "path": "E:\\",
    "name": "USB Drive (E:)",
    "kind": "removable",
    "removable": true
  }
}
```

### Directory removed

```json
{
  "type": "DIRECTORY_REMOVED",
  "path": "E:\\"
}
```

---

# 14. Command ACK Improvements

Current ACK:

```json
{
  "type": "COMMAND_ACK",
  "action": "watch",
  "path": "C:\\Projects",
  "success": true
}
```

Keep this, but make the response authoritative.

Recommended:

```json
{
  "type": "COMMAND_ACK",
  "action": "watch",
  "path": "C:\\Projects",
  "success": true,
  "canonicalPath": "C:\\Projects"
}
```

The UI should update its final monitoring state only after this ACK.

---

# 15. Node `server.js`

## Current role

`server.js` already:

* spawns Go
* reads stdout
* tracks watched folders
* sends commands
* exposes APIs
* broadcasts WebSocket messages

Keep this architecture.

## Refactor state

Replace:

```js
const watchedFolders = new Set();
```

with:

```js
const directoryState = {
    available: new Map(),
    watched: new Set()
};
```

Normalize all paths before adding/removing.

---

# 16. New API

### Get available directories

```http
GET /api/directories
```

Response:

```json
{
  "directories": [...]
}
```

### Get watched roots

Existing:

```http
GET /api/watched-folders
```

Keep it.

### Watch

Existing:

```http
POST /api/watch
```

### Unwatch

Existing:

```http
POST /api/unwatch
```

No new API is required for individual files because files are never controlled directly.

---

# 17. WebSocket State

On WebSocket connection, send enough state for the UI to reconstruct itself:

```text
STATUS
DIRECTORY_SNAPSHOT
WATCHED_FOLDERS
```

For runtime changes:

```text
DIRECTORY_ADDED
DIRECTORY_REMOVED
COMMAND_ACK
STATUS
```

This prevents the React page from depending entirely on its previous local state.

---

# 18. Persistence

## Problem

Current manually selected watches disappear when the monitor process/server restarts.

## Required behavior

Persist selected parent roots locally for the current single-machine implementation.

Use a small JSON state file:

```text
data/
└── monitoring-config.json
```

Example:

```json
{
  "watchedRoots": [
    "C:\\Users\\John\\Documents",
    "D:\\Projects"
  ]
}
```

### Startup

```text
load config
    ↓
discover directories
    ↓
validate persisted paths
    ↓
start watchers for valid persisted roots
    ↓
emit snapshot
```

If a persisted USB path no longer exists:

```text
do not start watching it
```

When the USB returns, optionally restore its watch state by path.

This should be explicitly tested because drive letters can change.

---

# 19. Node/Go Ownership

Use a single source of truth for actual monitoring state:

```text
Go
=
actual filesystem watcher state
```

Node:

```text
server-side mirror/cache
```

React:

```text
UI representation
```

Therefore:

```text
React says ON
```

is not authoritative.

Only:

```text
Go COMMAND_ACK success=true
```

means the operation actually succeeded.

---

# 20. Pending UI State

## Problem

`POST /api/watch` currently confirms that the command was written to stdin, not that Go successfully applied it.

## Solution

For each root:

```js
pendingActions.set(path, "watch");
```

UI:

```text
Documents   [ ON... ]
```

Then:

```text
COMMAND_ACK success=true
```

→

```text
Documents   [ ON ]
```

Failure:

```text
Documents   [ OFF ]
Error: access denied
```

Add a timeout fallback so a permanently missing ACK does not leave the UI stuck forever.

---

# 21. React UI

## Current

`src/App.jsx` currently contains the main dashboard and WebSocket event handling.

Do not continue adding all directory-management logic directly into this large component.

Create a dedicated component layer.

Recommended:

```text
src/
├── components/
│   └── directory-monitor/
│       ├── DirectoryMonitor.jsx
│       ├── DirectoryGroup.jsx
│       ├── DirectoryRow.jsx
│       └── directoryUtils.js
│
├── hooks/
│   └── useDirectoryMonitor.js
```

### `DirectoryMonitor.jsx`

Responsible for:

* rendering directory groups
* showing ON/OFF
* showing pending state
* responding to add/remove events

### `DirectoryRow.jsx`

Responsible for:

```text
name
path
type
removable badge
toggle
pending indicator
```

### `useDirectoryMonitor.js`

Responsible for:

* directory state
* watched state
* pending actions
* WebSocket events
* API commands

This keeps filesystem state out of presentation code.

---

# 22. UI Structure

Keep the admin view focused on monitoring roots.

```text
Directory Monitoring

User Folders
────────────────────
Desktop       OFF
Documents     ON
Downloads     OFF
Pictures      OFF
Music         OFF
Videos        OFF

Drives
────────────────────
OS (C:)       ON
Data (D:)     OFF
USB (E:)      OFF
```

No file-level toggle UI.

The recursive watcher handles descendants automatically.

---

# 23. USB Behavior

Desired state machine:

```text
USB absent
    ↓
USB connected
    ↓
DIRECTORY_ADDED
    ↓
Available + OFF
    ↓
Admin ON
    ↓
WATCH command
    ↓
ACK success
    ↓
Available + ON
```

Removal:

```text
USB connected + ON
    ↓
USB removed
    ↓
UNWATCH/cleanup
    ↓
DIRECTORY_REMOVED
    ↓
Remove from UI
```

---

# 24. Race Conditions

The code must handle:

```text
watch
unwatch
watch
```

arriving rapidly.

Use serialized command processing in Go.

The stdin command loop is already naturally ordered, but state changes should remain under the monitor mutex where shared.

Never allow:

```text
watchedRoots state
```

and:

```text
fsnotify watcher state
```

to be updated independently without a clear failure path.

---

# 25. Error Handling

Every watch operation should distinguish:

```text
invalid path
not a directory
does not exist
permission denied
already watched
already covered by parent
watcher registration failed
```

Do not convert every failure into:

```text
success: true
```

The ACK should communicate the actual result.

---

# 26. File Cache Rules

When unwatching a root:

```text
remove cached metadata under that root
```

but use a proper path-boundary check.

Avoid:

```go
strings.HasPrefix(path, root)
```

because:

```text
C:\Projects2
```

is not inside:

```text
C:\Projects
```

Use a helper such as:

```go
func isPathWithin(path, root string) bool
```

based on normalized paths and separator boundaries.

This same helper should be reused for:

* nested watch detection
* cache cleanup
* unwatch cleanup
* descendant filtering

---

# 27. Recommended Helper Layer

Add a focused Go file:

```text
path_utils.go
```

Functions:

```go
normalizePath(path string) string

pathsEqual(a, b string) bool

isPathWithin(path, root string) bool

isAncestor(parent, child string) bool

isDriveRoot(path string) bool
```

This removes duplicated path logic currently spread across the codebase.

---

# 28. Recommended Go Structure After Refactor

```text
ITR-Project/
├── main.go
├── commands.go
├── path_utils.go                 ← NEW
├── directory_discovery.go        ← NEW
├── watch_manager.go              ← NEW
├── drive_monitor.go              ← NEW
├── monitoring_state.go           ← NEW
│
├── fsmonitor.exe
├── server.js
│
├── src/
│   ├── App.jsx
│   ├── App.css
│   ├── main.jsx
│   │
│   ├── components/
│   │   └── directory-monitor/
│   │       ├── DirectoryMonitor.jsx
│   │       ├── DirectoryGroup.jsx
│   │       ├── DirectoryRow.jsx
│   │       └── directoryUtils.js
│   │
│   └── hooks/
│       └── useDirectoryMonitor.js
│
└── data/
    └── monitoring-config.json
```

---

# 29. Responsibility of Each New Go File

### `path_utils.go`

All Windows path comparison/normalization rules.

### `directory_discovery.go`

Discovers:

* Desktop
* Documents
* Downloads
* Pictures
* Music
* Videos
* filesystem drives
* removable drives

Produces directory metadata.

### `watch_manager.go`

Owns:

```text
watch root
unwatch root
canonical roots
ancestor/descendant rules
recursive registration
```

This should contain the core algorithm instead of mixing it with event processing.

### `drive_monitor.go`

Owns:

```text
drive connected
drive removed
drive metadata
available-root updates
```

### `monitoring_state.go`

Owns persistence:

```text
load
save
validate
restore
```

---

# 30. `main.go` After Refactor

`main.go` should become mainly orchestration:

```go
discover roots
load persisted watch configuration
create monitor
restore valid watched roots
start drive monitor
start event loop
start command listener
emit initial snapshots
wait for shutdown
```

Avoid keeping all business logic in `main.go`.

---

# 31. `commands.go` After Refactor

Keep command parsing, but make command handlers call the watch manager:

```text
watch
  ↓
WatchManager.WatchRoot()

unwatch
  ↓
WatchManager.UnwatchRoot()
```

Then emit:

```text
COMMAND_ACK
WATCHED_FOLDERS
```

from the resulting actual state.

---

# 32. `server.js` After Refactor

Responsibilities should remain:

```text
spawn Go
  ↓
read protocol
  ↓
maintain server mirror
  ↓
REST API
  ↓
WebSocket broadcast
```

It should **not implement filesystem monitoring logic itself**.

The existing Node drive polling can eventually be removed or reduced once the Go agent becomes the authoritative source of directory/drive discovery.

Avoid having both Node and Go independently discover USB state long-term because that creates two competing sources of truth.

---

# 33. `App.jsx`

Only keep high-level dashboard responsibilities.

Move directory-specific state and event processing into:

```text
useDirectoryMonitor()
```

and rendering into:

```text
DirectoryMonitor
```

Existing file-event display can remain unchanged.

---

# 34. Implementation Order

### Phase 1 — Refactor existing watcher state

1. Add path normalization helpers.
2. Replace `watchedFolders []string` with canonical watch-root state.
3. Implement ancestor/descendant handling.
4. Fix path-boundary checks.
5. Keep existing file-event behavior unchanged.

### Phase 2 — Separate discovery from monitoring

1. Build directory discovery.
2. Build directory snapshot messages.
3. Stop automatically watching discovered roots.
4. Restore only persisted/admin-selected roots.

### Phase 3 — External drives

1. Detect connect.
2. Emit `DIRECTORY_ADDED`.
3. Display as available/OFF.
4. Detect removal.
5. Cleanup active monitoring/cache safely.

### Phase 4 — Admin control

1. Add directory API/state.
2. Add WebSocket synchronization.
3. Build directory UI.
4. Implement ON/OFF commands.
5. Implement pending/ACK/error states.

### Phase 5 — Persistence/recovery

1. Save watched roots.
2. Load them on restart.
3. Validate paths.
4. Restore available drives when they reappear.

### Phase 6 — Hardening

Test:

```text
create
modify
delete
rename
new child directory
USB insert
USB remove
watch
unwatch
nested roots
duplicate roots
drive root
large directories
access denied
restart
process crash
server restart
rapid toggling
```

---

# 35. Definition of Done

The feature is complete for the single-laptop phase when:

```text
1. Agent discovers correct parent roots.
2. Admin sees only those roots.
3. New removable drives appear dynamically.
4. Removed drives disappear dynamically.
5. Nothing is monitored merely because it was discovered.
6. ON watches the selected root recursively.
7. OFF reliably stops that root.
8. Nested redundant roots are eliminated.
9. Actual Go state is the source of truth.
10. UI reflects COMMAND_ACK results.
11. Monitoring survives restart according to saved configuration.
12. Existing create/delete/modify/rename behavior remains intact.
13. Large and problematic directories are handled safely.
14. USB insertion/removal does not desynchronize state.
15. The entire system is tested on one Windows laptop before multi-user work begins.
```

## Codebase Change Summary

### Must update

```text
main.go
commands.go
server.js
src/App.jsx
```

### Strongly recommended new files

```text
path_utils.go
directory_discovery.go
watch_manager.go
drive_monitor.go
monitoring_state.go

src/components/directory-monitor/
src/hooks/useDirectoryMonitor.js
```

### Reuse, do not rebuild

```text
fsnotify event processing
file correlation
hashing
create/delete/modify/rename detection
existing WebSocket transport
existing watch/unwatch command transport
```

The core implementation principle is:

```text
DISCOVERY ≠ MONITORING

availableRoots
      ↓
admin decision
      ↓
canonical watchedRoots
      ↓
recursive fsnotify monitoring
```

That separation should be the foundation of the entire feature.
