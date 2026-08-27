import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

let monitorProcess = null;
let isTracking = false;

const directoryState = {
  available: new Map(),
  watched: new Set(),
};

const systemDrive = (process.env.SystemDrive || 'C:').toUpperCase().replace(/[/\\]+$/, '');

function normalizePath(p) {
  if (!p || typeof p !== 'string') return '';
  let normalized = path.normalize(p).replace(/\//g, '\\');
  if (/^[a-zA-Z]:\\?$/.test(normalized)) {
    return normalized.slice(0, 2).toUpperCase() + '\\';
  }
  if (normalized.endsWith('\\') && !/^[a-zA-Z]:\\$/.test(normalized)) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function pathKey(p) {
  return normalizePath(p).toLowerCase();
}

function broadcast(data) {
  const msg = typeof data === 'string' ? data : JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(msg);
    }
  });
}

function setAvailableDirectory(dir) {
  if (!dir?.path) return;
  directoryState.available.set(pathKey(dir.path), {
    ...dir,
    path: normalizePath(dir.path),
    available: dir.available !== false,
  });
}

function removeAvailableDirectory(dirPath) {
  directoryState.available.delete(pathKey(dirPath));
}

function setWatchedFolders(folders) {
  directoryState.watched.clear();
  if (!Array.isArray(folders)) return;
  for (const f of folders) {
    directoryState.watched.add(normalizePath(f));
  }
}

function addWatchedFolder(folderPath) {
  if (folderPath) directoryState.watched.add(normalizePath(folderPath));
}

function removeWatchedFolder(folderPath) {
  if (folderPath) directoryState.watched.delete(normalizePath(folderPath));
}

function getDirectoryList() {
  return [...directoryState.available.values()].sort((a, b) => {
    const kindOrder = { user_folder: 0, drive: 1, removable: 2 };
    const ka = kindOrder[a.kind] ?? 9;
    const kb = kindOrder[b.kind] ?? 9;
    if (ka !== kb) return ka - kb;
    return (a.name || a.path).localeCompare(b.name || b.path);
  });
}

function sendInitialState(ws) {
  ws.send(JSON.stringify({ type: 'STATUS', tracking: isTracking }));
  ws.send(JSON.stringify({
    type: 'DIRECTORY_SNAPSHOT',
    directories: getDirectoryList(),
  }));
  ws.send(JSON.stringify({
    type: 'WATCHED_FOLDERS',
    folders: [...directoryState.watched],
  }));
}

function getConnectedDrives() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const found = [];
  for (let i = 0; i < letters.length; i++) {
    const d = letters[i] + ':\\';
    try {
      if (fs.existsSync(d)) found.push(d);
    } catch {
      // ignore
    }
  }
  return found;
}

function getNonSystemDrives() {
  return getConnectedDrives().filter((d) => !d.toUpperCase().startsWith(systemDrive));
}

function attachMonitorListeners(proc) {
  const rl = createInterface({ input: proc.stdout });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const parsed = JSON.parse(trimmed);

      if (parsed.type === 'DIRECTORY_SNAPSHOT' && Array.isArray(parsed.directories)) {
        directoryState.available.clear();
        for (const dir of parsed.directories) setAvailableDirectory(dir);
        console.log(`[Server] Directory snapshot: ${parsed.directories.length} roots`);
        broadcast(trimmed);
        return;
      }

      if (parsed.type === 'DIRECTORY_ADDED' && parsed.directory) {
        setAvailableDirectory(parsed.directory);
        console.log(`[Server] Directory added: ${parsed.directory.path}`);
        broadcast(trimmed);
        return;
      }

      if (parsed.type === 'DIRECTORY_REMOVED' && parsed.path) {
        removeAvailableDirectory(parsed.path);
        removeWatchedFolder(parsed.path);
        console.log(`[Server] Directory removed: ${parsed.path}`);
        broadcast(trimmed);
        return;
      }

      if (parsed.type === 'WATCHED_FOLDERS' && Array.isArray(parsed.folders)) {
        setWatchedFolders(parsed.folders);
        console.log(`[Server] Watched folders: ${parsed.folders.join(', ') || 'none'}`);
        broadcast(trimmed);
        return;
      }

      if (parsed.type === 'COMMAND_ACK') {
        if (parsed.success && parsed.action === 'watch') {
          addWatchedFolder(parsed.canonicalPath || parsed.path);
        } else if (parsed.success && parsed.action === 'unwatch') {
          removeWatchedFolder(parsed.canonicalPath || parsed.path);
        }
        console.log(`[Command Ack] ${parsed.action} ${parsed.path}: ${parsed.success ? 'ok' : parsed.error}`);
        broadcast(trimmed);
        return;
      }

      if (parsed.type && parsed.type !== 'INFO') {
        console.log(`[Event] ${parsed.type}: ${parsed.file || parsed.destination || ''}`);
        broadcast(trimmed);
      }
    } catch {
      console.log(`[Monitor raw] ${trimmed}`);
    }
  });

  proc.stderr.on('data', (chunk) => {
    console.error(`[Monitor stderr] ${chunk.toString().trim()}`);
  });

  proc.on('exit', (code, signal) => {
    console.log(`[Server] Monitor process exited (code=${code}, signal=${signal})`);
    monitorProcess = null;
    isTracking = false;
    directoryState.watched.clear();
    broadcast({ type: 'STATUS', tracking: false });
  });
}

function startMonitor() {
  if (monitorProcess) {
    console.log('[Server] Monitor already running');
    return;
  }

  const exePath = path.join(__dirname, 'fsmonitor.exe');

  const trySpawnGoRun = () => {
    console.log('[Server] Spawning file monitor via Go toolchain: go run . --json');
    try {
      monitorProcess = spawn('go', ['run', '.', '--json'], {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: true,
      });

      monitorProcess.on('error', (err) => {
        console.error('[Server] Failed to start monitor via go run:', err.message);
        monitorProcess = null;
        isTracking = false;
        broadcast({ type: 'STATUS', tracking: false });
      });

      isTracking = true;
      broadcast({ type: 'STATUS', tracking: true });
      attachMonitorListeners(monitorProcess);
    } catch (err) {
      console.error('[Server] Exception spawning go run:', err);
      monitorProcess = null;
      isTracking = false;
      broadcast({ type: 'STATUS', tracking: false });
    }
  };

  console.log(`[Server] Spawning file monitor: ${exePath} --json`);
  try {
    monitorProcess = spawn(exePath, ['--json'], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    monitorProcess.on('error', (err) => {
      console.warn(`[Server] Executable spawn failed (${err.message}). Retrying with "go run"...`);
      monitorProcess = null;
      trySpawnGoRun();
    });

    isTracking = true;
    broadcast({ type: 'STATUS', tracking: true });
    attachMonitorListeners(monitorProcess);
  } catch (err) {
    console.warn(`[Server] Exception spawning executable (${err.message}). Retrying with "go run"...`);
    trySpawnGoRun();
  }
}

function stopMonitor() {
  if (!monitorProcess) {
    isTracking = false;
    broadcast({ type: 'STATUS', tracking: false });
    return;
  }

  console.log('[Server] Stopping file monitor...');
  const pidToKill = monitorProcess.pid;
  monitorProcess = null;
  isTracking = false;
  directoryState.watched.clear();
  broadcast({ type: 'STATUS', tracking: false });

  if (pidToKill) {
    try {
      spawn('taskkill', ['/pid', pidToKill.toString(), '/f', '/t'], { windowsHide: true });
    } catch {
      // ignore
    }
  }
}

function sendCommand(action, targetPath, res) {
  if (!monitorProcess || !monitorProcess.stdin.writable) {
    return res.status(409).json({ success: false, error: 'Monitor is not running' });
  }
  if (!targetPath || typeof targetPath !== 'string') {
    return res.status(400).json({ success: false, error: 'path is required' });
  }

  const line = JSON.stringify({ action, path: targetPath }) + '\n';
  monitorProcess.stdin.write(line, (err) => {
    if (err) {
      console.error(`[Server] Failed to send ${action} command:`, err.message);
      return res.status(500).json({ success: false, error: 'Failed to send command to monitor' });
    }
    res.json({ success: true, sent: { action, path: normalizePath(targetPath) } });
  });
}

app.post('/api/toggle', (_req, res) => {
  if (isTracking) stopMonitor();
  else startMonitor();
  res.json({ tracking: isTracking });
});

app.get('/api/status', (_req, res) => {
  res.json({ tracking: isTracking });
});

app.get('/api/directories', (_req, res) => {
  res.json({ directories: getDirectoryList() });
});

app.get('/api/drives', (_req, res) => {
  res.json({ drives: getNonSystemDrives() });
});

app.post('/api/scan-drives', (_req, res) => {
  res.json({ success: true, drives: getNonSystemDrives() });
});

app.post('/api/watch', (req, res) => {
  sendCommand('watch', req.body?.path, res);
});

app.post('/api/unwatch', (req, res) => {
  sendCommand('unwatch', req.body?.path, res);
});

app.get('/api/watched-folders', (_req, res) => {
  res.json({ folders: [...directoryState.watched] });
});

wss.on('connection', (ws) => {
  sendInitialState(ws);

  const nonSystem = getNonSystemDrives();
  ws.send(JSON.stringify({
    type: 'CURRENT_DRIVES',
    drives: nonSystem,
    displayOnly: true,
  }));
});

function cleanup() {
  stopMonitor();
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`[Server] Backend running on http://localhost:${PORT}`);
  console.log('[Server] Ready for dashboard toggle.');
});
