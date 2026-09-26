import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── File-backed session storage adapter ──────────────────────────────────────
const SESSION_FILE = path.join(__dirname, 'data', 'session.json');

function ensureDataDir() {
  const dir = path.dirname(SESSION_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readSessionStore() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
    }
  } catch {
    // corrupt file — start fresh
  }
  return {};
}

function writeSessionStore(store) {
  ensureDataDir();
  fs.writeFileSync(SESSION_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

const fileStorage = {
  getItem: (key) => {
    const store = readSessionStore();
    return store[key] ?? null;
  },
  setItem: (key, value) => {
    const store = readSessionStore();
    store[key] = value;
    writeSessionStore(store);
  },
  removeItem: (key) => {
    const store = readSessionStore();
    delete store[key];
    writeSessionStore(store);
  },
};

// ── Single authenticated Supabase client ─────────────────────────────────────
const supabase = (supabaseUrl && supabaseAnonKey)
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storage: fileStorage,
      },
    })
  : null;

const app = express();
app.use(cors());
app.use(express.json());
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

let monitorProcess = null;
let isTracking = false;
let activeEmployeeId = null;
let heartbeatInterval = null;

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

// ── Helper: get authenticated employee id from Supabase session ──────────────
async function getAuthenticatedUserId() {
  if (!supabase) return null;
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return null;
    return user.id;
  } catch {
    return null;
  }
}

// ── Insert filesystem/USB event into employee_activity_logs ──────────────────
async function insertActivityLog(event) {
  if (!supabase) return;
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    console.warn('[Supabase] No authenticated session — cannot insert activity log.');
    return;
  }

  const rawType = (event.type || '').toLowerCase();
  const action = rawType === 'file_moved' ? 'move' : rawType;

  const payload = {
    user_id: userId,
    action: action,
    details: event,
    device_id: event.device_id || null,
    pen_drive_id: (rawType === 'pen_drive_insert' || rawType === 'pen_drive_eject' || event.isExternal)
      ? (event.file || event.destination || 'EXTERNAL_USB')
      : null,
    source_path: event.source || event.source_path || null,
    dest_path: event.destination || event.file || event.dest_path || null,
    admin_notified: false,
  };

  try {
    const { error } = await supabase
      .from('employee_activity_logs')
      .insert([payload]);

    if (error) {
      console.error('[Supabase] Failed to insert activity log:', error.message);
    } else {
      console.log(`[Supabase] Inserted activity log: ${action}`);
    }
  } catch (err) {
    console.error('[Supabase] Exception inserting activity log:', err);
  }
}

// ── Event types that should be persisted to Supabase ─────────────────────────
const PERSISTABLE_EVENT_TYPES = new Set([
  'create', 'copy', 'move', 'rename', 'delete', 'modify',
  'pen_drive_insert', 'pen_drive_eject', 'file_moved',
]);

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

        // Persist filesystem/USB events to Supabase
        const eventType = parsed.type.toLowerCase();
        if (PERSISTABLE_EVENT_TYPES.has(eventType)) {
          insertActivityLog(parsed).catch(err => {
            console.error('[Supabase] Async insert error:', err);
          });
        }
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

      // Auto-watch default user directories
      setTimeout(() => {
        if (!monitorProcess || !monitorProcess.stdin.writable) return;
        const homeDir = os.homedir();
        const dirs = [
          path.join(homeDir, 'Desktop'),
          path.join(homeDir, 'Documents'),
          path.join(homeDir, 'Pictures'),
          path.join(homeDir, 'Downloads')
        ];
        dirs.forEach(d => {
          monitorProcess.stdin.write(JSON.stringify({ action: 'watch', path: d }) + '\n');
        });
      }, 1000);


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

    // Auto-watch default user directories
    setTimeout(() => {
      if (!monitorProcess || !monitorProcess.stdin.writable) return;
      const homeDir = os.homedir();
      const dirs = [
        path.join(homeDir, 'Desktop'),
        path.join(homeDir, 'Documents'),
        path.join(homeDir, 'Pictures'),
        path.join(homeDir, 'Downloads')
      ];
      dirs.forEach(d => {
        monitorProcess.stdin.write(JSON.stringify({ action: 'watch', path: d }) + '\n');
      });
    }, 1000);
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

// ── Heartbeat ────────────────────────────────────────────────────────────────
function startHeartbeat() {
  stopHeartbeat();
  heartbeatInterval = setInterval(async () => {
    if (!supabase) return;
    const userId = await getAuthenticatedUserId();
    if (!userId) return;
    try {
      const { error } = await supabase
        .from('users')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', userId);
      if (error) {
        console.error('[Heartbeat] Update failed:', error.message);
      }
    } catch (err) {
      console.error('[Heartbeat] Exception:', err);
    }
  }, 25000); // every 25 seconds
  console.log('[Heartbeat] Started (every 25s)');
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
    console.log('[Heartbeat] Stopped');
  }
}

// ── Session bootstrap endpoint ───────────────────────────────────────────────
app.post('/api/bootstrap-session', async (req, res) => {
  const { access_token, refresh_token } = req.body;
  if (!access_token || !refresh_token) {
    return res.status(400).json({ success: false, error: 'access_token and refresh_token are required' });
  }

  if (!supabase) {
    return res.status(500).json({ success: false, error: 'Supabase client not configured' });
  }

  try {
    const { data, error } = await supabase.auth.setSession({
      access_token,
      refresh_token,
    });

    if (error) {
      console.error('[Bootstrap] setSession failed:', error.message);
      return res.status(401).json({ success: false, error: error.message });
    }

    activeEmployeeId = data.user?.id || null;
    console.log(`[Bootstrap] Session established for user: ${activeEmployeeId}`);

    // Start heartbeat and monitoring now that we have a session
    startHeartbeat();
    if (!isTracking) startMonitor();

    // Re-subscribe to agent commands with the authenticated session
    subscribeToAgentCommands();

    res.json({ success: true, userId: activeEmployeeId });
  } catch (err) {
    console.error('[Bootstrap] Exception:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/toggle', (_req, res) => {
  if (isTracking) stopMonitor();
  else startMonitor();
  res.json({ tracking: isTracking });
});

app.post('/api/set-employee', (req, res) => {
  if (req.body?.employee_id) {
    activeEmployeeId = req.body.employee_id;
    console.log(`[Server] Active employee ID set to: ${activeEmployeeId}`);
    subscribeToAgentCommands();
  }
  res.json({ success: true, activeEmployeeId });
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

app.post('/api/browser-activity', async (req, res) => {
  const { url, timestamp, page_title, domain } = req.body;
  // Always use the authenticated session's user id — ignore any employee_id from request
  const employee_id = await getAuthenticatedUserId();

  if (!employee_id || !url || !timestamp) {
    return res.status(400).json({ success: false, error: 'Missing required fields or no authenticated session' });
  }

  if (supabase) {
    try {
      const { error } = await supabase
        .from('browser_activity_logs')
        .insert([{
          employee_id,
          url,
          domain: domain || null,
          page_title: page_title || null,
          visited_at: timestamp
        }]);

      if (error) {
        console.error('[Supabase] Failed to insert browser activity:', error.message);
      } else {
        console.log(`[Supabase] Inserted browser activity for ${employee_id}: ${url}`);
      }
    } catch (err) {
      console.error('[Supabase] Exception inserting browser activity:', err);
    }
  } else {
    console.warn('[Supabase] Client not configured. Cannot save browser activity.');
  }

  const activityEvent = {
    type: 'browser_activity',
    employee_id,
    url,
    domain,
    page_title,
    timestamp,
    message: `Visited: ${url}`
  };
  broadcast(activityEvent);

  res.json({ success: true });
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
  stopHeartbeat();
  stopMonitor();
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', () => {
  stopHeartbeat();
  stopMonitor();
});

const BASE_PORT = 3001;

function startServer(port) {
  server.listen(port, () => {
    console.log(`[Server] Backend running on http://localhost:${port}`);
    console.log('[Server] Ready for dashboard toggle.');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[Server] Port ${port} already in use — trying ${port + 1}...`);
      server.close();
      startServer(port + 1);
    } else {
      console.error('[Server] Fatal server error:', err);
      process.exit(1);
    }
  });
}

startServer(BASE_PORT);

// ── Supabase Realtime: agent_commands subscription ───────────────────────────
// The employee-agent uses its authenticated session to subscribe to
// agent_commands rows addressed to its employee_id.  When a command arrives
// it executes the action locally and writes status='done' + result back.
let agentCommandChannel = null;
let isSubscribingToCommands = false;

async function subscribeToAgentCommands() {
  if (!supabase) {
    console.warn('[AgentCommands] Supabase not configured — cloud relay disabled.');
    return;
  }
  
  if (isSubscribingToCommands) return;
  isSubscribingToCommands = true;

  try {
    // Remove existing channel if re-subscribing
    if (agentCommandChannel) {
      await supabase.removeChannel(agentCommandChannel);
      agentCommandChannel = null;
    }

  // Determine the employee ID from the authenticated session
  const userId = await getAuthenticatedUserId();
  if (userId) {
    activeEmployeeId = userId;
  }

  if (!activeEmployeeId) {
    console.warn('[AgentCommands] No authenticated session yet — standing by for /api/bootstrap-session.');
    return;
  }

  async function ackCommand(id, status, result = null) {
    const { error } = await supabase
      .from('agent_commands')
      .update({ status, result })
      .eq('id', id);
    if (error) console.error('[AgentCommands] ack write failed:', error.message);
  }

  async function dispatchCommand(row) {
    const { id, command, payload } = row;
    console.log(`[AgentCommands] Received command: ${command}`, payload);

    try {
      switch (command) {
        case 'toggle_tracking': {
          if (isTracking) stopMonitor();
          else startMonitor();
          // give the monitor a moment to settle
          await new Promise(r => setTimeout(r, 300));
          await ackCommand(id, 'done', {
            tracking: isTracking,
            directories: getDirectoryList(),
            watchedFolders: [...directoryState.watched],
          });
          break;
        }
        case 'get_status': {
          // Broadcast current state to any local WS clients
          broadcast({ type: 'STATUS', tracking: isTracking });
          broadcast({
            type: 'DIRECTORY_SNAPSHOT',
            directories: getDirectoryList(),
          });
          broadcast({
            type: 'WATCHED_FOLDERS',
            folders: [...directoryState.watched],
          });
          await ackCommand(id, 'done', {
            tracking: isTracking,
            directories: getDirectoryList(),
            watchedFolders: [...directoryState.watched],
          });
          break;
        }
        case 'watch': {
          if (!monitorProcess || !monitorProcess.stdin.writable) {
            await ackCommand(id, 'error', { error: 'Monitor not running' });
            break;
          }
          const targetPath = payload?.path;
          if (!targetPath) { await ackCommand(id, 'error', { error: 'path required' }); break; }
          const line = JSON.stringify({ action: 'watch', path: targetPath }) + '\n';
          monitorProcess.stdin.write(line, async (err) => {
            if (err) await ackCommand(id, 'error', { error: err.message });
            else await ackCommand(id, 'done', { canonicalPath: normalizePath(targetPath) });
          });
          break;
        }
        case 'unwatch': {
          if (!monitorProcess || !monitorProcess.stdin.writable) {
            await ackCommand(id, 'error', { error: 'Monitor not running' });
            break;
          }
          const targetPath = payload?.path;
          if (!targetPath) { await ackCommand(id, 'error', { error: 'path required' }); break; }
          const line = JSON.stringify({ action: 'unwatch', path: targetPath }) + '\n';
          monitorProcess.stdin.write(line, async (err) => {
            if (err) await ackCommand(id, 'error', { error: err.message });
            else await ackCommand(id, 'done', { canonicalPath: normalizePath(targetPath) });
          });
          break;
        }
        default:
          console.warn('[AgentCommands] Unknown command:', command);
          await ackCommand(id, 'error', { error: `Unknown command: ${command}` });
      }
    } catch (err) {
      console.error('[AgentCommands] dispatch error:', err);
      await ackCommand(id, 'error', { error: err.message });
    }
  }

  // Subscribe to new rows addressed to this employee
  const uniqueChannelId = `agent-commands-${activeEmployeeId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  agentCommandChannel = supabase
    .channel(uniqueChannelId)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'agent_commands',
        filter: `employee_id=eq.${activeEmployeeId}`,
      },
      (payload) => {
        const row = payload.new;
        if (row.status === 'pending') {
          dispatchCommand(row);
        }
      }
    )
    .subscribe((status) => {
      console.log(`[AgentCommands] Realtime subscription status for ${activeEmployeeId}:`, status);
    });

    console.log(`[AgentCommands] Listening for commands on Supabase Realtime (Employee ID: ${activeEmployeeId}).`);
  } catch (error) {
    console.error('[AgentCommands] Error setting up realtime:', error);
  } finally {
    isSubscribingToCommands = false;
  }
}

// ── Restore session on startup ───────────────────────────────────────────────
async function restoreSessionOnStartup() {
  if (!supabase) {
    console.warn('[Startup] Supabase not configured — skipping session restore.');
    return;
  }

  try {
    // The Supabase client with file-backed storage will auto-restore the session
    // from data/session.json via the storage adapter. We just need to check if
    // there's an active session.
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
      console.warn('[Startup] Session restore error:', error.message);
      return;
    }

    if (session?.user) {
      activeEmployeeId = session.user.id;
      console.log(`[Startup] Restored session for user: ${activeEmployeeId} (${session.user.email})`);
      startHeartbeat();
      if (!isTracking) startMonitor();
      subscribeToAgentCommands();
    } else {
      console.log('[Startup] No existing session found — waiting for /api/bootstrap-session.');
    }
  } catch (err) {
    console.warn('[Startup] Session restore exception:', err);
  }
}

restoreSessionOnStartup();
