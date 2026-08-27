export default function DirectoryRow({ directory, watched, pending, error, disabled, onToggle }) {
  const key = directory.path;
  const isPending = pending === 'watch' || pending === 'unwatch';
  const isOn = watched;

  return (
    <div className="directory-row">
      <div className="directory-info">
        <div className="directory-name">
          {directory.name}
          {directory.removable && <span className="directory-badge removable">USB</span>}
        </div>
        <div className="directory-path" title={directory.path}>{directory.path}</div>
        {error && <div className="directory-error">{error}</div>}
      </div>
      <div className="directory-toggle-col">
        {isPending ? (
          <span className="directory-pending">{pending === 'watch' ? 'ON…' : 'OFF…'}</span>
        ) : (
          <button
            type="button"
            className={`directory-toggle ${isOn ? 'on' : 'off'}`}
            disabled={disabled || isPending}
            onClick={() => onToggle(directory, !isOn)}
            aria-pressed={isOn}
          >
            {isOn ? 'ON' : 'OFF'}
          </button>
        )}
      </div>
    </div>
  );
}
