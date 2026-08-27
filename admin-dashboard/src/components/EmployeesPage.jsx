import { useMemo, useState } from 'react'

const STATUS_LABEL = { online: 'Online', offline: 'Offline', warning: 'Warning' }

export default function EmployeesPage({ employees, onViewEmployee }) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return employees
    return employees.filter(e =>
      e.name.toLowerCase().includes(q) ||
      e.department.toLowerCase().includes(q) ||
      e.device.toLowerCase().includes(q)
    )
  }, [employees, search])

  const total = employees.length
  const online = employees.filter(e => e.status === 'online').length
  const offline = employees.filter(e => e.status === 'offline').length
  const warning = employees.filter(e => e.status === 'warning').length

  return (
    <div className="page-view">
      <span className="section-marker"><span className="marker-index">/06</span> EMPLOYEE_DIRECTORY</span>

      <div className="page-header-row">
        <div>
          <h1 className="page-title">Employees</h1>
          <p className="page-subtitle">Select and manage employees monitored by the organization.</p>
        </div>
        <button className="primary-btn" type="button">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Employee
        </button>
      </div>

      <div className="filter-row">
        <input
          className="filter-input"
          type="text"
          placeholder="Search employees"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="filter-select" defaultValue="all-status">
          <option value="all-status">All Status</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
          <option value="warning">Away / Warning</option>
        </select>
        <select className="filter-select" defaultValue="all-dept">
          <option value="all-dept">All Departments</option>
          {[...new Set(employees.map(e => e.department))].map(d => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>

      <div className="admin-stats-grid four-up">
        <div className="admin-stat-card">
          <span className="font-mono-label">Total Employees</span>
          <span className="admin-stat-value">{total}</span>
        </div>
        <div className="admin-stat-card">
          <span className="font-mono-label">Online</span>
          <span className="admin-stat-value accent-lime">{online}</span>
        </div>
        <div className="admin-stat-card">
          <span className="font-mono-label">Offline</span>
          <span className="admin-stat-value accent-critical">{offline}</span>
        </div>
        <div className="admin-stat-card">
          <span className="font-mono-label">Away / Warning</span>
          <span className="admin-stat-value accent-warning">{warning}</span>
        </div>
      </div>

      <div className="employee-card-grid">
        {filtered.map(emp => (
          <div className="employee-card" key={emp.id}>
            <div className="employee-card-head">
              <div className="employee-avatar">{emp.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</div>
              <div className="employee-card-title">
                <span className="employee-name">{emp.name}</span>
                <span className="employee-role">{emp.role}</span>
              </div>
            </div>

            <div className="employee-card-grid-fields">
              <div className="employee-field">
                <span className="font-mono-label">Employee ID</span>
                <span className="employee-field-value mono-value">{emp.id}</span>
              </div>
              <div className="employee-field">
                <span className="font-mono-label">Department</span>
                <span className="employee-field-value">{emp.department}</span>
              </div>
              <div className="employee-field">
                <span className="font-mono-label">Device</span>
                <span className="employee-field-value">{emp.device}</span>
              </div>
              <div className="employee-field">
                <span className="font-mono-label">Status</span>
                <span className={`status-dot-label ${emp.status}`}>
                  <span className="status-dot-inline" />
                  {STATUS_LABEL[emp.status]}
                </span>
              </div>
            </div>

            <div className="employee-field last-active-field">
              <span className="font-mono-label">Last Active</span>
              <span className="employee-field-value">{emp.lastActive}</span>
            </div>

            <button className="view-monitoring-btn" onClick={() => onViewEmployee(emp)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
              </svg>
              View Monitoring
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
