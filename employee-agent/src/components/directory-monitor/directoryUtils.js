export function normalizePath(p) {
  if (!p || typeof p !== 'string') return '';
  let normalized = p.replace(/\//g, '\\');
  if (/^[a-zA-Z]:\\?$/.test(normalized)) {
    return normalized.slice(0, 2).toUpperCase() + '\\';
  }
  normalized = normalized.replace(/\\+$/, '');
  return normalized;
}

export function pathKey(p) {
  return normalizePath(p).toLowerCase();
}

export function isWatched(dirPath, watchedSet) {
  const key = pathKey(dirPath);
  for (const w of watchedSet) {
    const wKey = pathKey(w);
    if (wKey === key) return true;
    if (wKey.endsWith('\\') && key.startsWith(wKey.slice(0, 2).toLowerCase())) {
      if (key.startsWith(wKey.toLowerCase())) return true;
    }
    if (key.startsWith(wKey + '\\') || key.startsWith(wKey + '/')) return true;
  }
  return false;
}

export function groupDirectories(directories) {
  const userFolders = [];
  const drives = [];

  for (const dir of directories) {
    if (dir.kind === 'user_folder') userFolders.push(dir);
    else drives.push(dir);
  }

  const folderOrder = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos'];
  userFolders.sort((a, b) => {
    const ai = folderOrder.findIndex((n) => a.name.startsWith(n));
    const bi = folderOrder.findIndex((n) => b.name.startsWith(n));
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  drives.sort((a, b) => a.path.localeCompare(b.path));

  return { userFolders, drives };
}
