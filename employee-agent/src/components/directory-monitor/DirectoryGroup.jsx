import DirectoryRow from './DirectoryRow';
import { pathKey } from './directoryUtils';

export default function DirectoryGroup({ title, directories, pending, errors, disabled, isDirWatched, onToggle }) {
  if (!directories.length) return null;

  return (
    <section className="directory-group">
      <h3 className="directory-group-title">{title}</h3>
      <div className="directory-group-list">
        {directories.map((dir) => (
          <DirectoryRow
            key={dir.path}
            directory={dir}
            watched={isDirWatched(dir.path)}
            pending={pending.get(pathKey(dir.path))}
            error={errors.get(pathKey(dir.path))}
            disabled={disabled}
            onToggle={onToggle}
          />
        ))}
      </div>
    </section>
  );
}
