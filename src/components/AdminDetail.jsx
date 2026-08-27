import { useState } from 'react'

export default function AdminDetail({
  user,
  tracking,
  connected,
  stats,
  monitoredPathsCount,
  lastActivity,
  recentActivity = [],
  employee,
  onBack,
}) {
  const [scopeOpen, setScopeOpen] = useState(true)
  const [driveFilter, setDriveFilter] = useState('all')
  const [search, setSearch] = useState('')

  const isMock = Boolean(employee)
  const displayName = isMock ? employee.name : (user?.email || 'admin').split('@')[0]
  const initials = isMock
    ? employee.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : displayName.slice(0, 2).toUpperCase()
  const isOnline = isMock ? employee.status === 'online' : connected
  const deviceName = isMock ? employee.device : `${displayName}-Laptop`
  const totalEvents = isMock ? employee.events : stats.total
  const pathsLabel = isMock ? `${employee.paths} paths` : `${monitoredPathsCount} ${monitoredPathsCount === 1 ? 'drive' : 'drives'}`
  const activityIsOn = isMock ? employee.status !== 'offline' : tracking

  const filteredActivity = recentActivity.filter(row => {
    const matchesDrive = driveFilter === 'all' || row.type === driveFilter
    const q = search.trim().toLowerCase()
    const matchesSearch = !q || row.file.toLowerCase().includes(q) || row.path.toLowerCase().includes(q)
    return matchesDrive && matchesSearch
  })

  const activityTypes = [...new Set(recentActivity.map(r => r.type))]

  return (
    <div className="admin-detail">
      <button className="back-link" onClick={onBack}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
        Back
      </button>

      <span className="section-marker"><span className="marker-index">/05</span> DEVICE_DETAIL</span>

      {/* ── User Card ── */}
      <div className="admin-user-card">
        <div className="admin-avatar">{initials}</div>
        <div className="admin-user-info">
          <div className="admin-user-name-row">
            <span className="admin-user-name">{displayName}</span>
            <span className={`status-pill ${isOnline ? 'online' : 'offline'}`}>
              {isOnline ? 'Online' : 'Offline'}
            </span>
          </div>
          <span className="admin-user-email">{isMock ? `${displayName.toLowerCase().replace(/\s+/g, '.')}@example.com` : user?.email}</span>
        </div>
        <div className="admin-user-meta">
          <div className="admin-meta-item">
            <span className="font-mono-label">Device</span>
            <span className="admin-meta-value">{deviceName}</span>
          </div>
          <div className="admin-meta-item">
            <span className="font-mono-label">Last Activity</span>
            <span className="admin-meta-value">{isMock ? employee.lastActive : lastActivity}</span>
          </div>
        </div>
      </div>

      {/* ── Stat Cards ── */}
      <div className="admin-stats-grid">
        <div className="admin-stat-card">
          <span className="font-mono-label">Device Status</span>
          <span className={`admin-stat-value ${isOnline ? 'accent-lime' : 'accent-critical'}`}>
            {isOnline ? 'Online' : 'Offline'}
          </span>
        </div>
        <div className="admin-stat-card">
          <span className="font-mono-label">Total Events</span>
          <span className="admin-stat-value">{totalEvents}</span>
        </div>
        <div className="admin-stat-card">
          <span className="font-mono-label">Monitored Paths</span>
          <span className="admin-stat-value">{pathsLabel}</span>
        </div>
        <div className="admin-stat-card">
          <span className="font-mono-label">Last Activity</span>
          <span className="admin-stat-value">{isMock ? employee.lastActive : lastActivity}</span>
        </div>
      </div>

      {/* ── Device Information ── */}
      <section className="admin-panel">
        <h2>Device Information</h2>
        <div className="admin-info-grid">
          <div className="admin-info-cell">
            <span className="font-mono-label">Operating System</span>
            <span className="admin-info-value">{isMock ? 'Windows 11 Pro' : 'Windows / Dev Laptop'}</span>
          </div>
          <div className="admin-info-cell">
            <span className="font-mono-label">Agent Status</span>
            <span className="admin-info-value">{isMock ? (isOnline ? 'Online' : 'Offline') : (tracking ? 'Online (Tracking)' : 'Online (Idle)')}</span>
          </div>
          <div className="admin-info-cell">
            <span className="font-mono-label">Last Check-in</span>
            <span className="admin-info-value">{isMock ? employee.lastActive : (connected ? 'Live' : 'Reconnecting')}</span>
          </div>
          <div className="admin-info-cell">
            <span className="font-mono-label">Device ID</span>
            <span className="admin-info-value mono-value">{isMock ? employee.id : 'localhost'}</span>
          </div>
        </div>
      </section>

      {/* ── Monitoring Scope ── */}
      <section className="admin-panel">
        <h2>Monitoring Scope</h2>
        <div className="scope-tree">
          <button className="scope-root-row" onClick={() => setScopeOpen(v => !v)}>
            <svg
              className={`scope-chevron ${scopeOpen ? 'open' : ''}`}
              width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
            <span className="scope-root-label">C:\</span>
          </button>

          {scopeOpen && (
            <div className="scope-child-row">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <span className="scope-child-label">Whole Drive</span>
              <div className="scope-toggle-col">
                <span className={`toggle-label ${activityIsOn ? 'active' : ''}`}>{activityIsOn ? 'ON' : 'OFF'}</span>
                <span className={`toggle-btn static ${activityIsOn ? 'active' : ''}`} aria-hidden="true">
                  <span className="toggle-knob" />
                </span>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Recent Activity ── */}
      <section className="admin-panel">
        <div className="panel-head-row">
          <h2>Recent Activity</h2>
          <div className="filter-row compact">
            <input
              className="filter-input"
              type="text"
              placeholder="Search filename, path or employee."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select className="filter-select" value={driveFilter} onChange={(e) => setDriveFilter(e.target.value)}>
              <option value="all">All Drives</option>
              {activityTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {filteredActivity.length === 0 ? (
          <p className="empty-inline-note">No matching activity recorded.</p>
        ) : (
          <div className="recent-activity-list">
            {filteredActivity.map((row, i) => (
              <div className="recent-activity-row" key={i}>
                <span className="log-timestamp">{row.time}</span>
                <span className="mini-avatar">{isMock ? displayName[0] : 'U'}</span>
                <span className="cell-strong">{isMock ? displayName : 'Unknown Employee'}</span>
                <span className="log-type-badge" data-type={row.type}>{row.type}</span>
                <div className="recent-activity-file">
                  <span className="employee-field-value">{row.file}</span>
                  <span className="path-meta">{row.path}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
