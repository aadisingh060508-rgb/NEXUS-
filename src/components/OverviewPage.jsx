const STATUS_LABEL = { online: 'Online', offline: 'Offline', warning: 'Warning' }

export default function OverviewPage({ user, employees, onViewEmployee, recentActivity }) {
  const totalEmployees = employees.length
  const totalDevices = employees.length
  const totalEvents = employees.reduce((n, e) => n + (e.events || 0), 0)
  const onlineDevices = employees.filter(e => e.status === 'online').length

  return (
    <div className="page-view">
      <div className="page-header-row">
        <div>
          <h1 className="page-title">Good afternoon, {(user?.email || 'Admin').split('@')[0]}</h1>
          <p className="page-subtitle">Here's your monitoring overview.</p>
        </div>
      </div>

      <div className="admin-stats-grid four-up">
        <div className="admin-stat-card">
          <span className="font-mono-label">Total Employees</span>
          <span className="admin-stat-value">{totalEmployees} <span className="stat-unit">Employees</span></span>
        </div>
        <div className="admin-stat-card">
          <span className="font-mono-label">Total Devices</span>
          <span className="admin-stat-value">{totalDevices} <span className="stat-unit">Devices</span></span>
        </div>
        <div className="admin-stat-card">
          <span className="font-mono-label">Total Events</span>
          <span className="admin-stat-value">{totalEvents} <span className="stat-unit">Events</span></span>
        </div>
        <div className="admin-stat-card">
          <span className="font-mono-label">Online Devices</span>
          <span className="admin-stat-value accent-lime">{onlineDevices} / {totalDevices} <span className="stat-unit">Online</span></span>
        </div>
      </div>

      <section className="admin-panel">
        <h2>Employee Monitoring</h2>
        <div className="data-table">
          <div className="data-table-row data-table-head">
            <span>Employee</span>
            <span>Device</span>
            <span>Status</span>
            <span>Last Activity</span>
            <span>Events</span>
            <span>Monitoring</span>
            <span>Action</span>
          </div>
          {employees.map(emp => (
            <div className="data-table-row" key={emp.id}>
              <span className="cell-strong">{emp.name}</span>
              <span>{emp.device}</span>
              <span><span className={`status-dot-label ${emp.status}`}><span className="status-dot-inline" />{STATUS_LABEL[emp.status]}</span></span>
              <span>{emp.lastActive}</span>
              <span className="cell-strong">{emp.events}</span>
              <span><span className="paths-chip">{emp.paths} paths</span></span>
              <span><button className="table-view-btn" onClick={() => onViewEmployee(emp)}>View</button></span>
            </div>
          ))}
        </div>
      </section>

      <section className="admin-panel">
        <div className="panel-head-row">
          <h2>Recent Activity</h2>
          <div className="filter-row compact">
            <input className="filter-input" type="text" placeholder="Search filename, path or employee." disabled />
            <select className="filter-select" defaultValue="all" disabled>
              <option value="all">All Events</option>
            </select>
          </div>
        </div>
        <div className="recent-activity-list">
          {recentActivity.map((row, i) => (
            <div className="recent-activity-row" key={i}>
              <span className="log-timestamp">{row.time}</span>
              <span className="mini-avatar">{row.employee[0]}</span>
              <span className="cell-strong">{row.employee}</span>
              <span className="log-type-badge" data-type={row.type}>{row.type}</span>
              <div className="recent-activity-file">
                <span className="employee-field-value">{row.file}</span>
                <span className="path-meta">{row.path}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
