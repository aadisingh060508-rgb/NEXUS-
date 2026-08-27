const ACTIVITY_LABEL = { active: 'Active', idle: 'Idle', visited: 'Visited' }

export default function WebsiteMonitoring({ stats, activity, recent }) {
  return (
    <div className="page-view">
      <span className="section-marker"><span className="marker-index">/07</span> WEBSITE_MONITORING</span>

      <div className="page-header-row">
        <div>
          <h1 className="page-title">Website Monitoring</h1>
          <p className="page-subtitle">Monitor employee browser and website activity.</p>
        </div>
      </div>

      <div className="filter-row">
        <select className="filter-select" defaultValue="today"><option value="today">Today</option></select>
        <select className="filter-select" defaultValue="all-emp"><option value="all-emp">All Employees</option></select>
        <select className="filter-select" defaultValue="all-browser"><option value="all-browser">All Browsers</option></select>
        <input className="filter-input" type="text" placeholder="Search website or employee" />
      </div>

      <div className="admin-stats-grid four-up">
        <div className="admin-stat-card">
          <span className="font-mono-label">Total Visits</span>
          <span className="admin-stat-value">{stats.totalVisits.toLocaleString()}</span>
        </div>
        <div className="admin-stat-card">
          <span className="font-mono-label">Active Websites</span>
          <span className="admin-stat-value">{stats.activeWebsites}</span>
        </div>
        <div className="admin-stat-card">
          <span className="font-mono-label">Active Employees</span>
          <span className="admin-stat-value">{stats.activeEmployees}</span>
        </div>
        <div className="admin-stat-card">
          <span className="font-mono-label">Browsing Time</span>
          <span className="admin-stat-value">{stats.browsingTime}</span>
        </div>
      </div>

      <div className="two-col-layout">
        <section className="admin-panel">
          <h2>Website Activity</h2>
          <div className="data-table">
            <div className="data-table-row data-table-head six-col">
              <span>Employee</span>
              <span>Website</span>
              <span>Browser</span>
              <span>Activity</span>
              <span>Time</span>
              <span>Duration</span>
            </div>
            {activity.map((row, i) => (
              <div className="data-table-row six-col" key={i}>
                <span className="cell-strong">{row.employee}</span>
                <span>{row.website}</span>
                <span>{row.browser}</span>
                <span><span className={`status-dot-label ${row.activity === 'active' ? 'online' : row.activity === 'idle' ? 'warning' : ''}`}><span className="status-dot-inline" />{ACTIVITY_LABEL[row.activity]}</span></span>
                <span>{row.time}</span>
                <span>{row.duration}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="admin-panel">
          <h2>Recent Website Activity</h2>
          <ul className="recent-feed-list">
            {recent.map((row, i) => (
              <li key={i}>
                <span className="feed-dot" />
                <span><strong>{row.employee}</strong> {row.action} <strong>{row.site}</strong></span>
                <span className="feed-time font-mono-label">{row.time}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
