import { useMemo, useState } from 'react'
import { getSupabaseClient } from '../supabaseClient'

const STATUS_LABEL = { online: 'Online', offline: 'Offline', warning: 'Warning' }

export default function EmployeesPage({ employees, onViewEmployee }) {
  const [search, setSearch] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteStatus, setInviteStatus] = useState('')
  const [isInviting, setIsInviting] = useState(false)
  // Generated code shown to admin after creation
  const [generatedCode, setGeneratedCode] = useState(null) // { adminId, code, expiresInMinutes }
  const [copied, setCopied] = useState(false)

  const handleInviteSubmit = async (e) => {
    e.preventDefault()
    if (!inviteEmail) return
    setIsInviting(true)
    setInviteStatus('')
    setGeneratedCode(null)

    try {
      const supabase = getSupabaseClient()
      if (!supabase) throw new Error('Supabase not configured')

      // Fetch the current session to get the access token explicitly
      const { data: { session } } = await supabase.auth.getSession()

      const { data, error } = await supabase.functions.invoke('send-connection-request', {
        body: { employeeEmail: inviteEmail },
        headers: {
          Authorization: session?.access_token ? `Bearer ${session.access_token}` : undefined
        }
      })

      if (error) throw error

      if (data?.error === 'no_account') {
        setInviteStatus(`Error: ${data.message}`)
      } else if (data?.error) {
        setInviteStatus(`Error: ${data.error}${data.details ? ' - ' + JSON.stringify(data.details) : ''}`)
      } else if (data?.success && data?.code) {
        // Show the code on screen — no email needed
        setGeneratedCode({
          adminId: data.adminId,
          code: data.code,
          expiresInMinutes: data.expiresInMinutes ?? 30
        })
        setInviteEmail('')
      } else {
        setInviteStatus('Unexpected response from server.')
      }
    } catch (err) {
      setInviteStatus(`Error: ${err.message}`)
    } finally {
      setIsInviting(false)
    }
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setInviteEmail('')
    setInviteStatus('')
    setGeneratedCode(null)
    setCopied(false)
  }

  const handleCopy = () => {
    if (!generatedCode) return
    const text = `Admin ID: ${generatedCode.adminId}\nCode: ${generatedCode.code}`
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

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
      <div className="page-header-row">
        <div>
          <h1 className="page-title">Employees</h1>
          <p className="page-subtitle">Select and manage employees monitored by the organization.</p>
        </div>
        <button className="primary-btn" type="button" onClick={() => setIsModalOpen(true)}>
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
        {filtered.length === 0 ? (
          <div style={{
            gridColumn: '1 / -1',
            padding: '3rem 2rem',
            textAlign: 'center',
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            border: '1px dashed #cbd5e1',
            color: '#64748b'
          }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '0.75rem' }}>
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <h3 style={{ margin: '0 0 0.5rem', color: '#1e293b', fontSize: '1.05rem', fontWeight: 600 }}>No Employees Found</h3>
            <p style={{ margin: 0, fontSize: '0.85rem' }}>No employee agents are currently connected. Click <strong>"Add Employee"</strong> above to invite and connect an employee device.</p>
          </div>
        ) : (
          filtered.map(emp => (
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
          ))
        )}
      </div>

      {/* ── Add Employee Modal ── */}
      {isModalOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)'
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
            border: '1px solid #334155',
            padding: '2rem',
            borderRadius: '16px',
            width: '420px',
            maxWidth: '90%',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.7)'
          }}>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{
                  width: '36px', height: '36px', borderRadius: '10px',
                  background: 'rgba(59,130,246,0.15)', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', color: '#3b82f6'
                }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" />
                  </svg>
                </div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#f1f5f9' }}>Add Employee</h3>
              </div>
              <button onClick={closeModal} style={{
                background: 'none', border: 'none', color: '#64748b', cursor: 'pointer',
                fontSize: '1.4rem', lineHeight: 1, padding: '0.25rem'
              }}>×</button>
            </div>

            {/* ── Step 1: Enter email (shown when no code generated yet) ── */}
            {!generatedCode && (
              <form onSubmit={handleInviteSubmit}>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.8rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Employee Email
                  </label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    placeholder="employee@company.com"
                    style={{
                      width: '100%', padding: '0.75rem 1rem', borderRadius: '8px',
                      border: '1px solid #334155', background: '#0f172a',
                      color: '#f1f5f9', fontSize: '0.95rem', outline: 'none',
                      boxSizing: 'border-box'
                    }}
                    required
                  />
                  <p style={{ margin: '0.5rem 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                    The employee must have an account in the system first.
                  </p>
                </div>

                {inviteStatus && (
                  <div style={{
                    marginBottom: '1rem', padding: '0.75rem 1rem', borderRadius: '8px', fontSize: '0.85rem',
                    background: inviteStatus.startsWith('Error') ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
                    color: inviteStatus.startsWith('Error') ? '#f87171' : '#4ade80',
                    border: `1px solid ${inviteStatus.startsWith('Error') ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`
                  }}>
                    {inviteStatus}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                  <button type="button" onClick={closeModal} style={{
                    padding: '0.6rem 1.2rem', borderRadius: '8px',
                    border: '1px solid #334155', background: 'transparent',
                    cursor: 'pointer', color: '#94a3b8', fontWeight: 500
                  }}>
                    Cancel
                  </button>
                  <button type="submit" disabled={isInviting} style={{
                    padding: '0.6rem 1.4rem', borderRadius: '8px', border: 'none',
                    background: isInviting ? '#1e40af' : '#3b82f6',
                    color: '#fff', cursor: isInviting ? 'not-allowed' : 'pointer',
                    fontWeight: 600, opacity: isInviting ? 0.8 : 1,
                    display: 'flex', alignItems: 'center', gap: '0.5rem'
                  }}>
                    {isInviting ? (
                      <>
                        <span style={{
                          width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.3)',
                          borderTopColor: '#fff', borderRadius: '50%',
                          animation: 'spin 0.8s linear infinite', display: 'inline-block'
                        }} />
                        Generating…
                      </>
                    ) : 'Generate Code'}
                  </button>
                </div>
              </form>
            )}

            {/* ── Step 2: Show generated code ── */}
            {generatedCode && (
              <div>
                {/* Success banner */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '0.6rem',
                  padding: '0.75rem 1rem', borderRadius: '8px',
                  background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)',
                  marginBottom: '1.5rem'
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span style={{ fontSize: '0.85rem', color: '#4ade80', fontWeight: 600 }}>
                    Code generated! Share it with the employee.
                  </span>
                </div>

                {/* Instruction */}
                <p style={{ margin: '0 0 1rem', fontSize: '0.83rem', color: '#94a3b8', lineHeight: 1.5 }}>
                  Tell the employee to open their <strong style={{ color: '#f1f5f9' }}>Employee Agent panel</strong> → "Connect to Admin" and enter:
                </p>

                {/* Code card */}
                <div style={{
                  background: '#0f172a', border: '1px solid #1e3a5f',
                  borderRadius: '12px', padding: '1.25rem 1.5rem', marginBottom: '1rem'
                }}>
                  <div style={{ marginBottom: '1rem' }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      Admin ID
                    </span>
                    <div style={{
                      fontFamily: 'monospace', fontSize: '0.78rem', color: '#38bdf8',
                      marginTop: '0.3rem', wordBreak: 'break-all',
                      background: 'rgba(56,189,248,0.05)', padding: '0.5rem 0.75rem',
                      borderRadius: '6px', border: '1px solid rgba(56,189,248,0.15)'
                    }}>
                      {generatedCode.adminId}
                    </div>
                  </div>

                  <div>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      6-Digit Code
                    </span>
                    <div style={{
                      fontFamily: 'monospace', fontSize: '2rem', fontWeight: 800,
                      color: '#a78bfa', letterSpacing: '0.4rem', textAlign: 'center',
                      marginTop: '0.4rem', padding: '0.75rem',
                      background: 'rgba(167,139,250,0.08)', borderRadius: '10px',
                      border: '1px solid rgba(167,139,250,0.2)'
                    }}>
                      {generatedCode.code}
                    </div>
                  </div>
                </div>

                {/* Expiry notice */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '0.4rem',
                  marginBottom: '1.25rem', fontSize: '0.78rem', color: '#f59e0b'
                }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                  </svg>
                  Expires in {generatedCode.expiresInMinutes} minutes
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button onClick={handleCopy} style={{
                    flex: 1, padding: '0.65rem', borderRadius: '8px',
                    border: '1px solid #334155', background: copied ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.04)',
                    color: copied ? '#4ade80' : '#94a3b8', cursor: 'pointer',
                    fontWeight: 600, fontSize: '0.85rem', transition: 'all 0.2s',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem'
                  }}>
                    {copied ? (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                        Copied!
                      </>
                    ) : (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                        Copy Details
                      </>
                    )}
                  </button>
                  <button onClick={closeModal} style={{
                    flex: 1, padding: '0.65rem', borderRadius: '8px',
                    border: 'none', background: '#3b82f6',
                    color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem'
                  }}>
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
