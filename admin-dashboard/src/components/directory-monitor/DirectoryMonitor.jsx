import DirectoryGroup from './DirectoryGroup';
import { pathKey } from './directoryUtils';

export default function DirectoryMonitor({
  tracking,
  grouped,
  pending,
  errors,
  isDirWatched,
  onToggle,
}) {
  const pendingByKey = new Map(
    [...pending.entries()].map(([k, v]) => [k, v])
  );
  const errorsByKey = new Map(
    [...errors.entries()]
  );

  const resolvePending = (dir) => pendingByKey.get(pathKey(dir.path));
  const resolveError = (dir) => errorsByKey.get(pathKey(dir.path));

  if (!tracking) {
    return (
      <section className="directory-monitor">
        <div className="section-header" style={{ padding: 0, border: 'none' }}>
          <div>
            <h2 style={{ marginTop: '4px' }}>Directory Monitoring</h2>
          </div>
        </div>
        <div className="directory-monitor-hint">
          Turn <strong>Tracking ON</strong> to discover directories and control monitoring roots.
        </div>
      </section>
    );
  }

  return (
    <section className="directory-monitor">
      <div className="section-header" style={{ padding: 0, border: 'none' }}>
        <div>
          <h2 style={{ marginTop: '4px' }}>Directory Monitoring</h2>
          <span className="directory-monitor-subtitle">Parent roots only — subfolders are covered recursively</span>
        </div>
      </div>

      <DirectoryGroup
        title="User Folders"
        directories={grouped.userFolders}
        pending={pendingByKey}
        errors={errorsByKey}
        disabled={!tracking}
        isDirWatched={isDirWatched}
        onToggle={onToggle}
      />

      <DirectoryGroup
        title="Drives"
        directories={grouped.drives}
        pending={pendingByKey}
        errors={errorsByKey}
        disabled={!tracking}
        isDirWatched={isDirWatched}
        onToggle={onToggle}
      />

      {!grouped.userFolders.length && !grouped.drives.length && (
        <div className="directory-monitor-hint">Discovering available directories…</div>
      )}
    </section>
  );
}
