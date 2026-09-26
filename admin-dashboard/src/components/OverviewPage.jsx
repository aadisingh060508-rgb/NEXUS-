import { useState } from 'react'
import EmployeeActivityPanel from './EmployeeActivityPanel'
export default function OverviewPage({ user, employees, onViewEmployee, logs = [] }) {
  const [selectedEventType, setSelectedEventType] = useState('all')
  const [selectedEmployeeFilter, setSelectedEmployeeFilter] = useState('all')

  const totalEmployees = employees.length
  // Total events calculated strictly from real DB logs + employee event counts
  const empTotalEvents = employees.reduce((n, e) => n + (e.events || 0), 0)
  const displayTotalEvents = Math.max(logs.length, empTotalEvents)

  // Map DB logs to recent activity format
  const dbRecentActivity = logs.map(log => ({
    time: log.timestamp || 'Just now',
    employee: log.employee_name || log.employee || (user?.email || 'Admin').split('@')[0],
    type: (log.type || 'INFO').toUpperCase(),
    file: log.file || log.destination || log.source || 'File Event',
    path: log.source || log.destination || log.file || ''
  }))

  const combinedActivity = dbRecentActivity.slice().reverse()

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

      {/* Employee Activity Feeds */}
      <section className="admin-panel" style={{ padding: 0, backgroundColor: 'transparent', border: 'none', boxShadow: 'none', marginTop: '2rem' }}>
        <h2 style={{ marginBottom: '1rem', fontSize: '1.25rem', color: '#1e293b' }}>Employee Activity Feeds</h2>
        {employees.length === 0 ? (
          <p style={{ color: '#64748b', fontStyle: 'italic' }}>No employees connected yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {employees.map(emp => (
              <EmployeeActivityPanel key={emp.id} employeeId={emp.id} employeeName={emp.name} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

