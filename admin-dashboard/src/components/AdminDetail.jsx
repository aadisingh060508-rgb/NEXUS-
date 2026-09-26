import { useState } from 'react'
import EmployeeActivityPanel from './EmployeeActivityPanel'
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

  const displayName = employee?.name || (user?.email || 'Admin').split('@')[0]
  const initials = displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const isOnline = employee?.status === 'online' || (connected ?? false)
  const deviceName = employee?.device || employee?.device_id || `${displayName}-Device`
  const totalEvents = employee?.events ?? (stats?.total || 0)
  const pathsLabel = employee?.paths ? `${employee.paths} paths` : `${monitoredPathsCount || 1} drives`
  const activityIsOn = employee ? employee.status === 'online' : (tracking ?? false)

  const filteredActivity = recentActivity.filter(row => {
    const matchesDrive = driveFilter === 'all' || row.type === driveFilter
    const q = search.trim().toLowerCase()
    const fileName = row.file || row.destination || row.source || ''
    const filePath = row.path || row.source || ''
    const matchesSearch = !q || fileName.toLowerCase().includes(q) || filePath.toLowerCase().includes(q)
    return matchesDrive && matchesSearch
  })

  const activityTypes = [...new Set(recentActivity.map(r => r.type).filter(Boolean))]

  return (
    <div className="admin-detail">
      <button className="back-link" onClick={onBack}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
        Back
      </button>

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
          <span className="admin-user-email">{employee?.email || user?.email || 'N/A'}</span>
        </div>
        <div className="admin-user-meta">
          <div className="admin-meta-item">
            <span className="font-mono-label">Device</span>
            <span className="admin-meta-value">{deviceName}</span>
          </div>
          <div className="admin-meta-item">
            <span className="font-mono-label">Last Activity</span>
            <span className="admin-meta-value">{employee?.lastActive || lastActivity || 'Just now'}</span>
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
          <span className="admin-stat-value">{employee?.lastActive || lastActivity || 'Just now'}</span>
        </div>
      </div>

      {/* ── Device Information ── */}
      <section className="admin-panel">
        <h2>Device Information</h2>
        <div className="admin-info-grid">
          <div className="admin-info-cell">
            <span className="font-mono-label">Operating System</span>
            <span className="admin-info-value">{employee?.os || 'Windows 11'}</span>
          </div>
          <div className="admin-info-cell">
            <span className="font-mono-label">Agent Status</span>
            <span className="admin-info-value">{isOnline ? 'Online (Active)' : 'Offline'}</span>
          </div>
          <div className="admin-info-cell">
            <span className="font-mono-label">Last Check-in</span>
            <span className="admin-info-value">{employee?.lastActive || (connected ? 'Live' : 'Offline')}</span>
          </div>
          <div className="admin-info-cell">
            <span className="font-mono-label">Device ID</span>
            <span className="admin-info-value mono-value">{employee?.id || employee?.device_id || 'N/A'}</span>
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
      <section className="admin-panel" style={{ padding: 0, backgroundColor: 'transparent', border: 'none', boxShadow: 'none' }}>
        <h2 style={{ marginBottom: '1rem' }}>Activity Feed</h2>
        <EmployeeActivityPanel 
          employeeId={employee?.id} 
          employeeName={displayName} 
        />
      </section>
    </div>
  )
}
