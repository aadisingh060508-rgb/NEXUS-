import { useState } from 'react'

export default function OverviewPage({ user, employees, onViewEmployee, logs = [] }) {
  const [selectedEventType, setSelectedEventType] = useState('all')
  const [selectedEmployeeFilter, setSelectedEmployeeFilter] = useState('all')

  const totalEmployees = employees.length
  // Total events calculated from DB logs (each log row = 1 event) + employee event totals if applicable
  const dbTotalEvents = logs.length
  const mockTotalEvents = employees.reduce((n, e) => n + (e.events || 0), 0)
  const displayTotalEvents = Math.max(dbTotalEvents, mockTotalEvents)

  // Map DB logs to recent activity format
  const dbRecentActivity = logs.map(log => ({
    time: log.timestamp || 'Just now',
    employee: (user?.email || 'Admin').split('@')[0],
    type: (log.type || 'INFO').toUpperCase(),
    file: log.file || log.destination || log.source || 'File Event',
    path: log.source || log.destination || log.file || ''
  }))

  // Fallback mock recent activity for visual demonstration if DB has few entries
  const mockRecentActivity = [
    { time: '12:17:55 am', employee: 'Priya Patil', type: 'CREATE', file: 'Screenshot 2026-08-27 001754.png', path: 'C:\\Users\\PRIYA\\Pictures\\Screenshots\\Screenshot 2026-08-27 001754.png' },
    { time: '12:18:30 am', employee: 'Rahul Sharma', type: 'DELETE', file: 'Screenshot 2026-07-25 182720.png', path: 'C:\\Users\\RAHUL\\Pictures\\Screenshots\\Screenshot 2026-07-25 182720.png' },
    { time: '12:25:40 am', employee: 'Amit Shah', type: 'COPY', file: 'test_copy.txt', path: 'C:\\Users\\AMIT\\Desktop\\ITR\\test_copy.txt' },
    { time: '12:27:40 am', employee: 'Neha Gupta', type: 'MODIFY', file: 'Q3-forecast.xlsx', path: 'C:\\Users\\NEHA\\Documents\\Finance\\Q3-forecast.xlsx' },
  ]

  const combinedActivity = dbRecentActivity.length > 0 
    ? [...dbRecentActivity.slice().reverse(), ...mockRecentActivity]
    : mockRecentActivity

  // Unique list of employees for filter dropdown
  const uniqueEmployees = Array.from(new Set(combinedActivity.map(a => a.employee)))

  // Unique list of event types for filter dropdown
  const uniqueEventTypes = Array.from(new Set(combinedActivity.map(a => a.type)))

  // Filter top 10 new rows
  const filteredActivity = combinedActivity.filter(row => {
    const matchesEvent = selectedEventType === 'all' || row.type.toLowerCase() === selectedEventType.toLowerCase()
    const matchesEmp = selectedEmployeeFilter === 'all' || row.employee.toLowerCase() === selectedEmployeeFilter.toLowerCase()
    return matchesEvent && matchesEmp
  }).slice(0, 10)

  return (
    <div className="page-view">
      <div className="page-header-row">
        <div>
          <h1 className="page-title">Good afternoon, {(user?.email || 'Admin').split('@')[0]}</h1>
          <p className="page-subtitle">Here's your monitoring overview.</p>
        </div>
      </div>

      {/* KPI Cards: Only Total Employees & Total Events */}
      <div className="admin-stats-grid two-up" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        <div className="admin-stat-card">
          <span className="font-mono-label">Total Employees</span>
          <span className="admin-stat-value">{totalEmployees} <span className="stat-unit">Employees</span></span>
        </div>
        <div className="admin-stat-card">
          <span className="font-mono-label">Total Events</span>
          <span className="admin-stat-value">{displayTotalEvents} <span className="stat-unit">Events</span></span>
        </div>
      </div>

      {/* Employee Monitoring Table: Columns - Employee, Last Activity, Events, Action */}
      <section className="admin-panel">
        <h2>Employee Monitoring</h2>
        <div className="data-table">
          <div className="data-table-row data-table-head" style={{ gridTemplateColumns: '2fr 2fr 1.5fr 1fr' }}>
            <span>Employee</span>
            <span>Last Activity</span>
            <span>Events</span>
            <span>Action</span>
          </div>
          {employees.map(emp => (
            <div className="data-table-row" key={emp.id} style={{ gridTemplateColumns: '2fr 2fr 1.5fr 1fr' }}>
              <span className="cell-strong">{emp.name}</span>
              <span>{emp.lastActive}</span>
              <span className="cell-strong">{emp.events}</span>
              <span><button className="table-view-btn" onClick={() => onViewEmployee(emp)}>View</button></span>
            </div>
          ))}
        </div>
      </section>

      {/* Recent Activity Section */}
      <section className="admin-panel">
        <div className="panel-head-row">
          <h2>Recent Activity</h2>
          <div className="filter-row compact" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            {/* Employee Filter Dropdown */}
            <select
              className="filter-select"
              value={selectedEmployeeFilter}
              onChange={(e) => setSelectedEmployeeFilter(e.target.value)}
              title="Filter by employee"
            >
              <option value="all">All Employees</option>
              {uniqueEmployees.map(emp => (
                <option key={emp} value={emp}>{emp}</option>
              ))}
            </select>

            {/* Events List Filter Dropdown */}
            <select
              className="filter-select"
              value={selectedEventType}
              onChange={(e) => setSelectedEventType(e.target.value)}
              title="Filter by event type"
            >
              <option value="all">All Events</option>
              {uniqueEventTypes.map(t => (
                <option key={t} value={t}>{t} Events</option>
              ))}
            </select>
          </div>
        </div>
        <div className="recent-activity-list">
          {filteredActivity.length === 0 ? (
            <div style={{ padding: '20px', color: 'var(--text-muted)', fontSize: '0.9rem' }}>No activity matching selected filters.</div>
          ) : (
            filteredActivity.map((row, i) => (
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
            ))
          )}
        </div>
      </section>
    </div>
  )
}

