/**
 * useDirectoryMonitor.js
 *
 * Replaces all direct LAN /api/... fetch calls with Supabase-relayed
 * agent_commands rows.  The admin dashboard inserts a command; the
 * employee-agent (on a remote laptop) picks it up via Realtime, executes
 * it locally, then writes back status='done' + result.  ACKs come back to
 * the dashboard through the existing WebSocket broadcast that the agent
 * still sends to all locally-connected WS clients — those reach the dashboard
 * via the Supabase Realtime broadcast channel the agent publishes to.
 *
 * For watch/unwatch the local WS flow still works when the agent and dashboard
 * happen to be on the same machine; when they are on different machines the
 * command goes via Supabase and the ACK arrives via the agent_commands result
 * subscription.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { groupDirectories, isWatched, normalizePath, pathKey } from '../components/directory-monitor/directoryUtils';
import { sendAgentCommand, subscribeToCommandResult } from '../supabaseLog';

const ACK_TIMEOUT_MS = 20000; // slightly longer to account for cloud round-trip

export function useDirectoryMonitor({ tracking, selectedEmployeeId }) {
  const [directories, setDirectories] = useState([]);
  const [watched, setWatched]         = useState(new Set());
  const [pending, setPending]         = useState(new Map());
  const [errors, setErrors]           = useState(new Map());
  const pendingTimers = useRef(new Map());

  // ── pending / error helpers ───────────────────────────────────────────────

  const clearPendingTimer = useCallback((key) => {
    const timer = pendingTimers.current.get(key);
    if (timer) {
      clearTimeout(timer);
      pendingTimers.current.delete(key);
    }
  }, []);

  const setPendingAction = useCallback((dirPath, action) => {
    const key = pathKey(dirPath);
    clearPendingTimer(key);
    setPending((prev) => new Map(prev).set(key, action));
    setErrors((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });

    const timer = setTimeout(() => {
      setPending((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      setErrors((prev) => new Map(prev).set(key, 'Operation timed out'));
      pendingTimers.current.delete(key);
    }, ACK_TIMEOUT_MS);

    pendingTimers.current.set(key, timer);
  }, [clearPendingTimer]);

  // ── WS event handlers (still used when agent is local) ───────────────────

  const handleDirectorySnapshot = useCallback((dirs) => {
    setDirectories(Array.isArray(dirs) ? dirs : []);
  }, []);

  const handleDirectoryAdded = useCallback((dir) => {
    if (!dir?.path) return;
    setDirectories((prev) => {
      const next = prev.filter((d) => pathKey(d.path) !== pathKey(dir.path));
      return [...next, dir];
    });
  }, []);

  const handleDirectoryRemoved = useCallback((dirPath) => {
    const key = pathKey(dirPath);
    setDirectories((prev) => prev.filter((d) => pathKey(d.path) !== key));
    setWatched((prev) => {
      const next = new Set(prev);
      for (const w of next) {
        if (pathKey(w) === key) next.delete(w);
      }
      return next;
    });
    clearPendingTimer(key);
    setPending((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, [clearPendingTimer]);

  const handleWatchedFolders = useCallback((folders) => {
    setWatched(new Set((folders || []).map(normalizePath)));
  }, []);

  const handleCommandAck = useCallback((ack) => {
    const keyPath  = pathKey(ack.path);
    const keyCanon = pathKey(ack.canonicalPath);
    clearPendingTimer(keyPath);
    if (keyCanon) clearPendingTimer(keyCanon);

    setPending((prev) => {
      const next = new Map(prev);
      next.delete(keyPath);
      if (keyCanon) next.delete(keyCanon);
      return next;
    });

    if (ack.success) {
      setErrors((prev) => {
        const next = new Map(prev);
        next.delete(keyPath);
        if (keyCanon) next.delete(keyCanon);
        return next;
      });
      if (ack.action === 'watch') {
        const target = normalizePath(ack.canonicalPath || ack.path);
        setWatched((prev) => new Set(prev).add(target));
      } else if (ack.action === 'unwatch') {
        setWatched((prev) => {
          const next = new Set(prev);
          if (ack.path)         next.delete(normalizePath(ack.path));
          if (ack.canonicalPath) next.delete(normalizePath(ack.canonicalPath));
          return next;
        });
      }
    } else {
      const errorKey = keyCanon || keyPath;
      setErrors((prev) => new Map(prev).set(errorKey, ack.error || 'Operation failed'));
    }
  }, [clearPendingTimer]);

  /** Called by App.jsx for every incoming WS message */
  const handleWsEvent = useCallback((event) => {
    switch (event.type) {
      case 'DIRECTORY_SNAPSHOT': handleDirectorySnapshot(event.directories); break;
      case 'DIRECTORY_ADDED':    handleDirectoryAdded(event.directory);       break;
      case 'DIRECTORY_REMOVED':  handleDirectoryRemoved(event.path);          break;
      case 'WATCHED_FOLDERS':    handleWatchedFolders(event.folders);         break;
      case 'COMMAND_ACK':        handleCommandAck(event);                     break;
      default: break;
    }
  }, [handleCommandAck, handleDirectoryAdded, handleDirectoryRemoved, handleDirectorySnapshot, handleWatchedFolders]);

  // ── Boot: ask agent for current state whenever employee is selected ─────────
  // We send a 'get_status' command via Supabase. The agent replies with
  // directories and watchedFolders in the result payload.
  useEffect(() => {
    if (!selectedEmployeeId) return;  // no employee selected yet

    sendAgentCommand({
      employeeId: selectedEmployeeId,
      command: 'get_status',
    })
    .then((cmdRow) => {
      const unsub = subscribeToCommandResult(cmdRow.id, ({ status, result }) => {
        if (status === 'done' || status === 'error') {
          unsub();
          if (status === 'done' && result) {
            if (Array.isArray(result.directories)) handleDirectorySnapshot(result.directories);
            if (Array.isArray(result.watchedFolders)) handleWatchedFolders(result.watchedFolders);
            // Sync tracking state if the result includes it
          }
        }
      });
    })
    .catch((err) => {
      console.warn('[DirectoryMonitor] get_status command failed:', err.message);
    });
  }, [selectedEmployeeId, handleDirectorySnapshot, handleWatchedFolders]);

  // ── Toggle a single directory via Supabase relay ─────────────────────────
  const toggleDirectory = useCallback(async (dir, enable) => {
    if (!tracking || !selectedEmployeeId) return;
    const action = enable ? 'watch' : 'unwatch';
    setPendingAction(dir.path, action);

    let cmdRow;
    try {
      cmdRow = await sendAgentCommand({
        employeeId: selectedEmployeeId,
        command: action,
        payload: { path: dir.path },
      });
    } catch (err) {
      clearPendingTimer(pathKey(dir.path));
      setPending((prev) => {
        const next = new Map(prev);
        next.delete(pathKey(dir.path));
        return next;
      });
      setErrors((prev) => new Map(prev).set(pathKey(dir.path), err.message || 'Failed to send command'));
      return;
    }

    // Subscribe to the Supabase ACK (agent writes result back to this row)
    const unsub = subscribeToCommandResult(cmdRow.id, ({ status, result }) => {
      if (status === 'done' || status === 'error') {
        unsub();
        // Synthesise a COMMAND_ACK event so existing UI logic handles it
        handleCommandAck({
          action,
          path: dir.path,
          canonicalPath: result?.canonicalPath || dir.path,
          success: status === 'done',
          error: result?.error || (status === 'error' ? 'Agent reported error' : undefined),
        });
      }
    });
  }, [tracking, selectedEmployeeId, setPendingAction, clearPendingTimer, handleCommandAck]);

  const grouped      = groupDirectories(directories);
  const isDirWatched = useCallback((dirPath) => isWatched(dirPath, watched), [watched]);

  return {
    grouped,
    watched,
    pending,
    errors,
    isDirWatched,
    toggleDirectory,
    handleWsEvent,
  };
}
