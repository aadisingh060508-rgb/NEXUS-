import { useState, useEffect, useRef, useCallback } from 'react'
import Auth from './Auth'
import { getSupabaseClient } from './supabaseClient'
import { logActivity, fetchActivityLogs, clearActivityLogs, setStoredUserUuid, fetchBrowserActivityLogs, sendAgentCommand, subscribeToCommandResult } from './supabaseLog'
import DirectoryMonitor from './components/directory-monitor/DirectoryMonitor'
import { useDirectoryMonitor } from './hooks/useDirectoryMonitor'
import Sidebar from './components/Sidebar'
import AdminDetail from './components/AdminDetail'
import EmployeesPage from './components/EmployeesPage'
import OverviewPage from './components/OverviewPage'
import WebsiteMonitoring from './components/WebsiteMonitoring'

const EVENT_TYPES = [
  'create',
  'copy',
  'move',
  'rename',
  'delete',
  'modify',
  'pen_drive_insert',
  'pen_drive_eject',
  'browser_activity'
]

const STAT_LABELS = {
  create: 'Creates',
  copy: 'Copies',
  move: 'Moves',
  rename: 'Renames',
  delete: 'Deletes',
  modify: 'Modifies',
  pen_drive_insert: 'USB In',
  pen_drive_eject: 'USB Out',
  browser_activity: 'Browsing',
}

const getInitialStats = () => ({
  total: 0,
  create: 0,
  copy: 0,
  move: 0,
  rename: 0,
  delete: 0,
  modify: 0,
  pen_drive_insert: 0,
  pen_drive_eject: 0,
  browser_activity: 0,
})

export default function App() {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)

  const [tracking, setTracking] = useState(false)
  const [connected, setConnected] = useState(false)   // true = Supabase Realtime is live
  const [reconnecting, setReconnecting] = useState(false)
  const [logs, setLogs] = useState([])
  const [browserLogs, setBrowserLogs] = useState([])
  const [connectedDrives, setConnectedDrives] = useState([]) // currently plugged drives (display only)
  const [stats, setStats] = useState(getInitialStats())
  const [bumpKey, setBumpKey] = useState(null)
  const [toast, setToast] = useState(null)

  const [view, setView] = useState('overview')
  const [selectedEmployee, setSelectedEmployee] = useState(null)
  const [connectedEmployees, setConnectedEmployees] = useState([])

  const wsRef = useRef(null)
  const reconnectTimer = useRef(null)
  const reconnectAttempts = useRef(0)
  const logEndRef = useRef(null)
  const logContainerRef = useRef(null)
  const autoScroll = useRef(true)
  const toastTimer = useRef(null)
  const recentEventsRef = useRef(new Map())

  // The employee whose agent is currently being controlled
  // (selectedEmployee is set when admin opens a specific employee's dashboard)
  const activeAgentEmployeeId = selectedEmployee?.id ?? null

  // ── Supabase connectivity → drives the CONNECTED badge ──
  useEffect(() => {
    const supabase = getSupabaseClient()
    if (!supabase) return
    const checkConn = () => {
      // In supabase-js v2, use the isConnected() method on the realtime client
      const isLive = typeof supabase.realtime?.isConnected === 'function' 
        ? supabase.realtime.isConnected() 
        : false
      setConnected(isLive)
    }
    const id = setInterval(checkConn, 2000)
    checkConn()
    return () => clearInterval(id)
  }, [])

  const {
    grouped,
    pending,
    errors,
    isDirWatched,
    toggleDirectory,
    handleWsEvent,
  } = useDirectoryMonitor({ tracking, selectedEmployeeId: activeAgentEmployeeId })

  // ── Fetch real employees linked to this admin ──
  const fetchConnectedEmployees = useCallback(async (adminId) => {
    const supabase = getSupabaseClient()
    if (!supabase || !adminId) return
    const { data, error } = await supabase
      .from('users')
      .select('id, email, full_name, is_active')
      .eq('admin_id', adminId)
    if (error) {
      console.warn('[Employees] fetch error:', error.message)
      return
    }
    const mapped = (data || []).map((u) => ({
      id: u.id,
      name: u.full_name || u.email.split('@')[0],
      role: 'Employee',
      department: 'General',
      device: `${(u.full_name || u.email.split('@')[0])}-Laptop`,
      status: 'online',
      lastActive: 'Just now',
      events: 0,
      paths: 0,
      isReal: true,
      email: u.email,
    }))
    setConnectedEmployees(mapped)
  }, [])

  // ── Subscribe to users table changes for live employee updates ──
  useEffect(() => {
    if (!user?.id) return
    const supabase = getSupabaseClient()
    if (!supabase) return

    fetchConnectedEmployees(user.id)

    const channel = supabase
      .channel('connected-employees')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'users',
        filter: `admin_id=eq.${user.id}`,
      }, () => {
        fetchConnectedEmployees(user.id)
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user?.id, fetchConnectedEmployees])

  // ── Show Toast Notification (Upper Middle) ──
  const showToast = useCallback((type, title, desc) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ type, title, desc })
    toastTimer.current = setTimeout(() => {
      setToast(null)
    }, 3200)
  }, [])

  // ── Load Existing Activity Logs from DB ──
  const loadLogsFromDb = useCallback(async (userId) => {
    if (!userId) return
    try {
      const rows = await fetchActivityLogs()

      // If DB is empty, clear local state too
      if (!rows || rows.length === 0) {
        setLogs([])
        setStats(getInitialStats())
        return
      }

      const formatted = rows.map((row) => {
        const details = (typeof row.details === 'object' && row.details !== null) ? row.details : {}
        const rawAction = (row.action || 'info').toLowerCase()
        const type = rawAction === 'file_moved' ? 'move' : rawAction
        const ts = details.timestamp || (row.timestamp ? new Date(row.timestamp).toLocaleString() : '')

        return {
          id: row.id || `db-${Math.random()}`,
          type: type,
          timestamp: ts,
          file: row.dest_path || details.file || details.destination || details.file_path || '',
          source: row.source_path || details.source || details.source_path || '',
          destination: row.dest_path || details.destination || details.dest_path || '',
          size: details.size || '',
          fileType: details.fileType || '',
          message: details.message || (type === 'pen_drive_insert' ? `Pen drive inserted: ${row.dest_path || ''}` : type === 'pen_drive_eject' ? `Pen drive removed: ${row.source_path || ''}` : ''),
          isExternal: Boolean(row.pen_drive_id || details.isExternal || type.includes('pen_drive') || type.includes('usb'))
        }
      })

      setLogs(formatted)

      // Recompute stats from persisted records
      const initial = getInitialStats()
      initial.total = formatted.length
      formatted.forEach((item) => {
        const t = (item.type || '').toLowerCase()
        if (initial[t] !== undefined) {
          initial[t] += 1
        }
      })
      setStats(initial)
      
      // Fetch Browser logs
      try {
        const bRows = await fetchBrowserActivityLogs();
        const formattedBrowser = bRows.map(row => ({
          ...row,
          type: 'browser_activity',
          timestamp: new Date(row.visited_at).toLocaleString()
        }));
        setBrowserLogs(formattedBrowser);
      } catch (err) {
        console.warn('Could not load browser logs:', err);
      }
      
    } catch (err) {
      console.warn('Could not load activity logs from Supabase:', err.message || err)
    }
  }, [])

  // ── Supabase Auth Check & Initial Data Hydration ──
  useEffect(() => {
    const supabase = getSupabaseClient()
    if (!supabase) {
      setAuthLoading(false)
      return
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null
      setUser(u)
      setStoredUserUuid(u?.id ?? null)
      setAuthLoading(false)
      if (u?.id) {
        supabase.from('users').upsert({
          id: u.id,
          email: u.email,
          full_name: u.email ? u.email.split('@')[0] : 'Admin',
          role: 'admin',
          is_active: true
        }, { onConflict: 'id' }).then(({ error }) => { if (error) console.warn('Admin profile upsert:', error.message) })

        loadLogsFromDb(u.id)
      }
    }).catch(() => {
      setAuthLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null
      setUser(nextUser)
      setStoredUserUuid(nextUser?.id ?? null)
      setAuthLoading(false)
      if (nextUser?.id) {
        supabase.from('users').upsert({
          id: nextUser.id,
          email: nextUser.email,
          full_name: nextUser.email ? nextUser.email.split('@')[0] : 'Admin',
          role: 'admin',
          is_active: true
        }, { onConflict: 'id' }).then(({ error }) => { if (error) console.warn('Admin profile upsert:', error.message) })

        loadLogsFromDb(nextUser.id)
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [loadLogsFromDb])

  // ── Event Deduplication Check ──
  const isDuplicate = useCallback((event) => {
    const type = (event.type || '').toUpperCase()
    const target = event.file || event.destination || event.source || ''
    const key = `${type}:${target.toLowerCase()}`
    const now = Date.now()
    const lastTime = recentEventsRef.current.get(key)

    if (lastTime && now - lastTime < 1500) {
      return true
    }
    recentEventsRef.current.set(key, now)

    if (recentEventsRef.current.size > 200) {
      for (const [k, v] of recentEventsRef.current.entries()) {
        if (now - v > 5000) recentEventsRef.current.delete(k)
      }
    }
    return false
  }, [])

  // ── Process and Log Activity Event ──
  const processEvent = useCallback((event) => {
    const rawType = (event.type || '').toLowerCase()
    const type = rawType === 'file_moved' ? 'move' : rawType

    if (!EVENT_TYPES.includes(type)) {
      return
    }

    if (isDuplicate(event)) {
      return
    }

    setStats(prev => {
      const next = { ...prev }
      next.total = (prev.total || 0) + 1
      if (next[type] !== undefined) {
        next[type] = (prev[type] || 0) + 1
      }
      return next
    })
    setBumpKey(type)
    setTimeout(() => setBumpKey(null), 250)

    if (type === 'pen_drive_insert') {
      showToast('on', 'Pen Drive Inserted', `Removable storage detected: ${event.file || event.destination || ''}`)
    } else if (type === 'pen_drive_eject') {
      showToast('off', 'Pen Drive Removed', `Removable storage disconnected: ${event.file || event.source || ''}`)
    }

    const newLogEntry = {
      ...event,
      type: type,
      id: Date.now() + Math.random(),
      timestamp: event.timestamp || new Date().toLocaleString()
    }

    setLogs(prev => {
      const next = [...prev, newLogEntry]
      return next.length > 500 ? next.slice(-500) : next
    })

    // Persist event to Supabase DB (guarded by RLS) if it's not a browser event
    // Browser events are already persisted by the server directly.
    if (type !== 'browser_activity') {
      logActivity({
        action: rawType,
        details: event,
        source_path: event.source || null,
        dest_path: event.destination || event.file || null,
        device_id: typeof window !== 'undefined' ? window.location.hostname : null,
        pen_drive_id: (type === 'pen_drive_insert' || type === 'pen_drive_eject' || event.isExternal) ? (event.file || event.destination || 'EXTERNAL_USB') : null
      }).catch(err => {
        console.warn('[Supabase Log] Auto-insert note:', err.message || err)
      })
    } else {
      setBrowserLogs(prev => {
        const next = [newLogEntry, ...prev]
        return next.length > 500 ? next.slice(0, 500) : next
      })
    }
  }, [isDuplicate, showToast])

  // ── WebSocket Connection for Live OS Events ──
  // NOTE: WebSocket proxy to localhost:3001 has been removed from vite.config.js.
  // The admin dashboard now communicates with the remote employee agent exclusively
  // via Supabase Realtime (sendAgentCommand / subscribeToCommandResult).
  // Uncomment this block AND restore the vite.config.js proxy ONLY if you run the
  // employee-agent on the SAME machine as the admin dashboard.
  const connectWS = useCallback(() => {
    if (!user) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws`

    // Check if the local agent WS endpoint is actually reachable before connecting.
    // If there's no proxy configured, opening the socket will immediately fail.
    let ws
    try {
      ws = new WebSocket(wsUrl)
    } catch {
      return // Not available — remote-only mode via Supabase
    }

    ws.onopen = () => {
      reconnectAttempts.current = 0
      setConnected(true)
      setReconnecting(false)
    }

    ws.onmessage = (evt) => {
      try {
        const event = JSON.parse(evt.data)
        
        if (event.type === 'STATUS') {
          setTracking(event.tracking)
          return
        }

        handleWsEvent(event)

        if (event.type === 'CURRENT_DRIVES' && Array.isArray(event.drives)) {
          setConnectedDrives(event.drives)
          return
        }

        processEvent(event)
      } catch (e) { /* ignore parse errors */ }
    }

    ws.onclose = () => {
      setConnected(false)
      // Only retry up to 2 times for local WS; remote control uses Supabase Realtime
      if (reconnectAttempts.current < 2) {
        setReconnecting(true)
        const delay = Math.min(2000 * Math.pow(2, reconnectAttempts.current), 8000)
        reconnectAttempts.current++
        reconnectTimer.current = setTimeout(connectWS, delay)
      } else {
        // Give up on local WS — Supabase Realtime handles everything
        setReconnecting(false)
        reconnectAttempts.current = 0
      }
    }

    ws.onerror = () => ws.close()
    wsRef.current = ws
  }, [user, processEvent, handleWsEvent])

  useEffect(() => {
    // Local WS is disabled — admin communicates with agent via Supabase Realtime only.
    // Uncomment connectWS() below ONLY when running the employee-agent on the same machine.
    // if (user) {
    //   connectWS()
    // }
    return () => {
      if (wsRef.current) wsRef.current.close()
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    }
  }, [user, connectWS])

  // ── Auto-scroll ──
  useEffect(() => {
    if (autoScroll.current && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs])

  const handleScroll = () => {
    const el = logContainerRef.current
    if (!el) return
    autoScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 150
  }

  // ── Toggle Tracking via Supabase relay ──
  // Sends a 'toggle_tracking' command row; the remote employee-agent picks it
  // up via Realtime, executes start/stop locally, then writes back the result.
  const handleToggle = async () => {
    if (!activeAgentEmployeeId) {
      showToast('off', 'No Employee Selected', 'Open an employee\'s dashboard first to control their agent.')
      return
    }
    try {
      const cmdRow = await sendAgentCommand({
        employeeId: activeAgentEmployeeId,
        command: 'toggle_tracking',
      })

      // Optimistically flip UI — the agent will confirm via STATUS ws event
      const nextTracking = !tracking
      setTracking(nextTracking)
      if (nextTracking) {
        showToast('on', 'Tracking ON', 'Command sent — agent is starting monitoring…')
      } else {
        showToast('off', 'Tracking OFF', 'Command sent — agent is stopping monitoring…')
      }

      // Subscribe for the definitive ACK from the agent
      const unsub = subscribeToCommandResult(cmdRow.id, ({ status, result }) => {
        if (status === 'done' || status === 'error') {
          unsub()
          if (status === 'done' && result?.tracking !== undefined) {
            setTracking(result.tracking)
            if (result.tracking) {
              showToast('on', 'Tracking ON', 'Live file and pen drive monitoring is active.')
            } else {
              showToast('off', 'Tracking OFF', 'File monitoring paused.')
            }
          } else if (status === 'error') {
            // Revert the optimistic update
            setTracking(tracking)
            showToast('off', 'Toggle Failed', result?.error || 'Agent reported an error.')
          }
        }
      })
    } catch (e) {
      console.error('Toggle failed:', e)
      showToast('off', 'Toggle Failed', 'Could not send command. Check Supabase connection.')
    }
  }

  // ── Clear Logs (From DB and State) ──
  const handleClear = async () => {
    try {
      await clearActivityLogs()
      setLogs([])
      setStats(getInitialStats())
      recentEventsRef.current.clear()
      showToast('off', 'History Cleared', 'All activity logs deleted from database.')
    } catch (e) {
      console.error('Failed to clear logs from DB:', e.message || e)
      showToast('off', 'Clear Failed', `Error: ${e.message || 'Unknown error'}`)
    }
  }

  // ── Sign Out ──
  const handleSignOut = async () => {
    if (tracking) {
      await handleToggle()
    }
    const supabase = getSupabaseClient()
    if (supabase) {
      await supabase.auth.signOut()
    }
    setUser(null)
    setLogs([])
    setStats(getInitialStats())
  }

  useEffect(() => {
    const onTriggerSignOut = () => handleSignOut();
    window.addEventListener('trigger-signout', onTriggerSignOut);
    return () => window.removeEventListener('trigger-signout', onTriggerSignOut);
  }, [tracking]);

  // Initial Auth Loading Screen
  if (authLoading) {
    return (
      <div className="auth-loading-screen">
        <div className="spinner large"></div>
        <p>Initializing secure session...</p>
      </div>
    )
  }

  // If not logged in, render Auth (Sign In / Sign Up)
  if (!user) {
    return <Auth onAuthSuccess={(authenticatedUser) => setUser(authenticatedUser)} />
  }

  const connectionState = connected ? 'connected' : 'disconnected'
  const connectionLabel = connected ? 'Connected' : 'Supabase Offline'

  const monitoredPathsCount = grouped?.drives?.length || 1
  const lastActivity = logs.length ? (logs[logs.length - 1].timestamp || 'Just now') : '—'

  const realEmployee = {
    id: 'real',
    name: (user.email || 'admin').split('@')[0],
    role: 'Project Manager',
    department: 'Management',
    device: `${(user.email || 'admin').split('@')[0]}-Laptop`,
    status: connected ? 'online' : 'offline',
    lastActive: lastActivity,
    events: stats.total,
    paths: monitoredPathsCount,
    isReal: true,
  }
  const allEmployees = connectedEmployees

  const handleViewEmployee = (emp) => {
    setSelectedEmployee(emp)
    setView('admin')
  }

  const recentActivityFeed = logs.slice(0, 5).map(l => ({
    time: l.timestamp || 'Just now',
    employee: l.employee_name || l.employee || (user?.email || 'Admin').split('@')[0],
    type: (l.type || 'INFO').toUpperCase(),
    file: l.file || l.destination || l.source || 'File Event',
    path: l.source || l.destination || l.file || ''
  }))

  return (
    <div className="app-shell">
      <Sidebar view={view} onNavigate={(v) => { setSelectedEmployee(null); setView(v) }} />

      <div className="app-content">
        {view === 'overview' && (
          <OverviewPage
            user={user}
            employees={allEmployees}
            onViewEmployee={handleViewEmployee}
            recentActivity={recentActivityFeed}
            logs={logs}
          />
        )}

        {view === 'employees' && (
          <EmployeesPage employees={allEmployees} onViewEmployee={handleViewEmployee} />
        )}

        {view === 'website' && (
          <WebsiteMonitoring
            recent={browserLogs}
          />
        )}

        {view === 'admin' && selectedEmployee && (
          <AdminDetail
            employee={selectedEmployee}
            recentActivity={logs}
            onBack={() => { setSelectedEmployee(null); setView('employees') }}
          />
        )}

        {view === 'dashboard' && (
          <div className="app">
            {/* ── Toast Notification Popup (Upper Middle) ── */}
            {toast && (
              <div className={`toast-notification ${toast.type}`}>
                <div className="toast-icon">
                  {toast.type === 'on' ? (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  ) : (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="6" y="4" width="4" height="16"></rect>
                      <rect x="14" y="4" width="4" height="16"></rect>
                    </svg>
                  )}
                </div>
                <div className="toast-content">
                  <div className="toast-title">{toast.title}</div>
                  <div className="toast-desc">{toast.desc}</div>
                </div>
                <button className="toast-close" onClick={() => setToast(null)}>×</button>
              </div>
            )}

            {/* ── Header ── */}
            <header className="header">
              <div className="header-left">
                <button className="back-btn" onClick={() => setView('overview')} title="Back to Overview" style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', marginRight: '8px' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="19" y1="12" x2="5" y2="12"></line>
                    <polyline points="12 19 5 12 12 5"></polyline>
                  </svg>
                </button>
                <svg className="logo-icon" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
                  <polyline points="13 2 13 9 20 9"/>
                </svg>
                <div>
                  <h1 style={{ textTransform: 'capitalize' }}>
                    {selectedEmployee?.name || (selectedEmployee?.email || user?.email || 'User').split('@')[0]}
                  </h1>
                  <span className="font-mono-label">FS_ACTIVITY_MONITOR</span>
                </div>
              </div>

              <div className="header-right">
                <div className="user-profile-badge" title={`Signed in as ${user.email}`}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                  </svg>
                  <span className="user-email-text">{user.email}</span>
                </div>

                <div className={`status-badge ${connectionState}`}>
                  <span className="status-dot" />
                  <span className="status-text">{connectionLabel}</span>
                </div>

                <div className="toggle-wrapper">
                  <span className={`toggle-label ${tracking ? 'active' : ''}`}>
                    {tracking ? 'Tracking On' : 'Tracking Off'}
                  </span>
                  <button
                    className={`toggle-btn ${tracking ? 'active' : ''}`}
                    onClick={handleToggle}
                    role="switch"
                    aria-checked={tracking}
                    aria-label="Toggle tracking"
                  >
                    <span className="toggle-knob" />
                  </button>
                </div>

                <button className="signout-btn" onClick={handleSignOut} title="Sign Out">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                    <polyline points="16 17 21 12 16 7"></polyline>
                    <line x1="21" y1="12" x2="9" y2="12"></line>
                  </svg>
                  <span>Sign Out</span>
                </button>
              </div>
            </header>

            {/* ── Stats Bar ── */}
            <section className="stats-bar-section">
              <div className="stats-bar">
                <div className={`stat-card stat-card-primary ${bumpKey === 'total' || bumpKey ? 'bump' : ''}`}>
                  <div className="stat-value">{stats.total}</div>
                  <div className="stat-label">Total</div>
                </div>
                {EVENT_TYPES.map(type => (
                  <div key={type} className={`stat-card ${bumpKey === type ? 'bump' : ''}`}>
                    <div className="stat-value">{stats[type] || 0}</div>
                    <div className="stat-label">{STAT_LABELS[type] || type}</div>
                  </div>
                ))}
              </div>
            </section>

            <DirectoryMonitor
              tracking={tracking}
              grouped={grouped}
              pending={pending}
              errors={errors}
              isDirWatched={isDirWatched}
              onToggle={toggleDirectory}
            />

            {/* ── Log Feed ── */}
            <section className="log-feed">
              <div className="section-header">
                <div>
                  <h2>Activity Log History (Persisted)</h2>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button className="action-btn clear-history-btn" onClick={handleClear} title="Clear history and delete records">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                    Clear History
                  </button>
                </div>
              </div>

              <div className="log-container" ref={logContainerRef} onScroll={handleScroll}>
                {logs.length === 0 ? (
                  <div className="empty-state">
                    <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity="0.25">
                      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    <p>No activity logs recorded. Turn Tracking ON or insert a pen drive to capture events.</p>
                  </div>
                ) : (
                  <div className="log-list">
                    {logs.map((event) => {
                      const type = (event.type || 'INFO').toUpperCase()
                      const isUsbEvent = type === 'PEN_DRIVE_INSERT' || type === 'PEN_DRIVE_EJECT' || type === 'USB_INSERT' || type === 'USB_EJECT'
                      const hasSourceDest = (type === 'MOVE' || type === 'COPY') && (event.source && event.destination)

                      if (isUsbEvent) {
                        const isInsert = type.includes('INSERT')
                        const driveTarget = event.file || event.destination || event.source || 'Removable Drive'

                        return (
                          <div key={event.id} className="log-entry log-entry-usb external">
                            <span className="log-timestamp">{event.timestamp}</span>
                            <span className="log-type-badge" data-type={type}>
                              {isInsert ? 'USB INSERT' : 'USB EJECT'}
                            </span>

                            <div className="log-path-card single-card usb-card" title={driveTarget}>
                              <span className="path-chip usb-chip">
                                {isInsert ? 'PEN DRIVE CONNECTED' : 'PEN DRIVE REMOVED'}
                              </span>
                              <span className="path-text">{driveTarget}</span>
                              {event.message && <span className="path-meta">{event.message}</span>}
                            </div>

                            <div className="log-trailing-info">
                              <span className="usb-badge highlight">USB</span>
                            </div>
                          </div>
                        )
                      }

                      if (hasSourceDest) {
                        return (
                          <div key={event.id} className={`log-entry log-entry-transfer ${event.isExternal ? 'external' : ''}`}>
                            <span className="log-timestamp">{event.timestamp}</span>

                            <div className="log-path-card source-card" title={event.source}>
                              <span className="path-chip source-chip">SOURCE</span>
                              <span className="path-text">{event.source}</span>
                            </div>

                            <div className="transfer-action-col">
                              <span className="log-type-badge" data-type={type}>{type}</span>
                              <svg className="transfer-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <line x1="5" y1="12" x2="19" y2="12"></line>
                                <polyline points="12 5 19 12 12 19"></polyline>
                              </svg>
                            </div>

                            <div className="log-path-card destination-card" title={event.destination}>
                              <span className="path-chip destination-chip">DESTINATION</span>
                              <span className="path-text">{event.destination}</span>
                            </div>

                            <div className="log-trailing-info">
                              {event.size && <span className="log-size">{event.size}</span>}
                              {event.isExternal && <span className="usb-badge highlight">USB</span>}
                            </div>
                          </div>
                        )
                      }

                      if (type === 'BROWSER_ACTIVITY') {
                        return (
                          <div key={event.id} className="log-entry log-entry-single">
                            <span className="log-timestamp">{event.timestamp}</span>
                            <span className="log-type-badge" data-type={type}>BROWSE</span>

                            <div className="log-path-card single-card" title={event.url}>
                              <span className="path-chip target-chip" style={{ background: '#3b82f6', color: '#fff' }}>URL</span>
                              <span className="path-text">{event.domain || event.url}</span>
                              {event.page_title && <span className="path-meta">{event.page_title}</span>}
                            </div>
                          </div>
                        )
                      }

                      const targetPath = event.file || event.destination || event.source || ''
                      return (
                        <div key={event.id} className={`log-entry log-entry-single ${event.isExternal ? 'external' : ''}`}>
                          <span className="log-timestamp">{event.timestamp}</span>
                          <span className="log-type-badge" data-type={type}>{type}</span>

                          <div className="log-path-card single-card" title={targetPath}>
                            <span className="path-chip target-chip">
                              {type === 'DELETE' ? 'DELETED' : type === 'CREATE' ? 'NEW FILE' : type === 'MODIFY' ? 'MODIFIED' : 'FILE'}
                            </span>
                            <span className="path-text">{targetPath}</span>
                            {event.message && <span className="path-meta">{event.message}</span>}
                          </div>

                          <div className="log-trailing-info">
                            {event.size && <span className="log-size">{event.size}</span>}
                            {event.isExternal && <span className="usb-badge highlight">USB</span>}
                          </div>
                        </div>
                      )
                    })}
                    <div ref={logEndRef} />
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
