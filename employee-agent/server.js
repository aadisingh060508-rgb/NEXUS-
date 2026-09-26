import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey; // service key bypasses RLS for ack writes

// Client used for Realtime subscription + ack write-backs.
// We sign in with the employee credentials so RLS policies accept the UPDATE.
const supabase = (supabaseUrl && supabaseAnonKey)
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Service-role client for writing back acks without being blocked by RLS
const supabaseService = (supabaseUrl && supabaseServiceKey)
  ? createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } })
  : null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

let monitorProcess = null;
let isTracking = false;
let activeEmployeeId = 'TEST-EMP-001';

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
  const employee_id = activeEmployeeId;

  if (!employee_id || !url || !timestamp) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
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
  stopMonitor();
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);

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
// The employee-agent signs in once with its own credentials, then subscribes
// to agent_commands rows addressed to its employee_id.  When a command arrives
// it executes the action locally (using the same spawn logic already here)
// and writes status='done' + result back to the row so the admin dashboard
let agentCommandChannel = null;

async function subscribeToAgentCommands() {
  const realtimeClient = supabaseService || supabase;
  if (!realtimeClient) {
    console.warn('[AgentCommands] Supabase not configured — cloud relay disabled.');
    return;
  }

  // Remove existing channel if re-subscribing
  if (agentCommandChannel) {
    realtimeClient.removeChannel(agentCommandChannel);
    agentCommandChannel = null;
  }

  // (Note: Password sign-in logic removed. The agent backend now relies purely on
  // the SUPABASE_SERVICE_ROLE_KEY to bypass RLS, and it gets its activeEmployeeId
  // from the frontend GUI via /api/set-employee.)

  if (process.env.EMPLOYEE_ID) {
    activeEmployeeId = process.env.EMPLOYEE_ID;
  }

  if (!activeEmployeeId || activeEmployeeId === 'TEST-EMP-001') {
    console.warn('[AgentCommands] No valid activeEmployeeId configured yet — standing by for /api/set-employee.');
  }

  // Write-back helper — uses service role client if available, else anon
  const ackClient = supabaseService || supabase;

  async function ackCommand(id, status, result = null) {
    const { error } = await ackClient
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
  agentCommandChannel = realtimeClient
    .channel(`agent-commands-${activeEmployeeId}`)
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
}

subscribeToAgentCommands();

