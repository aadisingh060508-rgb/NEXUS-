import { useCallback, useEffect, useRef, useState } from 'react';
import { groupDirectories, isWatched, normalizePath, pathKey } from '../components/directory-monitor/directoryUtils';

const ACK_TIMEOUT_MS = 15000;

export function useDirectoryMonitor({ tracking }) {
  const [directories, setDirectories] = useState([]);
  const [watched, setWatched] = useState(new Set());
  const [pending, setPending] = useState(new Map());
  const [errors, setErrors] = useState(new Map());
  const pendingTimers = useRef(new Map());

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
    const keyPath = pathKey(ack.path);
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
          if (ack.path) next.delete(normalizePath(ack.path));
          if (ack.canonicalPath) next.delete(normalizePath(ack.canonicalPath));
          return next;
        });
      }
    } else {
      const errorKey = keyCanon || keyPath;
      setErrors((prev) => new Map(prev).set(errorKey, ack.error || 'Operation failed'));
    }
  }, [clearPendingTimer]);

  const handleWsEvent = useCallback((event) => {
    switch (event.type) {
      case 'DIRECTORY_SNAPSHOT':
        handleDirectorySnapshot(event.directories);
        break;
      case 'DIRECTORY_ADDED':
        handleDirectoryAdded(event.directory);
        break;
      case 'DIRECTORY_REMOVED':
        handleDirectoryRemoved(event.path);
        break;
      case 'WATCHED_FOLDERS':
        handleWatchedFolders(event.folders);
        break;
      case 'COMMAND_ACK':
        handleCommandAck(event);
        break;
      default:
        break;
    }
  }, [handleCommandAck, handleDirectoryAdded, handleDirectoryRemoved, handleDirectorySnapshot, handleWatchedFolders]);

  useEffect(() => {
    if (!tracking) return;

    fetch('/api/directories')
      .then((r) => r.json())
      .then((data) => handleDirectorySnapshot(data.directories))
      .catch(() => {});

    fetch('/api/watched-folders')
      .then((r) => r.json())
      .then((data) => handleWatchedFolders(data.folders))
      .catch(() => {});
  }, [tracking, handleDirectorySnapshot, handleWatchedFolders]);

  const toggleDirectory = useCallback(async (dir, enable) => {
    if (!tracking) return;
    const action = enable ? 'watch' : 'unwatch';
    setPendingAction(dir.path, action);

    try {
      const res = await fetch(`/api/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dir.path }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        clearPendingTimer(pathKey(dir.path));
        setPending((prev) => {
          const next = new Map(prev);
          next.delete(pathKey(dir.path));
          return next;
        });
        setErrors((prev) => new Map(prev).set(pathKey(dir.path), data.error || 'Request failed'));
      }
    } catch (err) {
      clearPendingTimer(pathKey(dir.path));
      setPending((prev) => {
        const next = new Map(prev);
        next.delete(pathKey(dir.path));
        return next;
      });
      setErrors((prev) => new Map(prev).set(pathKey(dir.path), err.message || 'Network error'));
    }
  }, [tracking, setPendingAction, clearPendingTimer]);

  const grouped = groupDirectories(directories);

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
