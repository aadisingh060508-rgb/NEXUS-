import { useState, useEffect, useRef, useCallback } from 'react'
import { getSupabaseClient } from '../supabaseClient'

const PAGE_SIZE = 50

/**
 * EmployeeActivityPanel — An isolated, independently-scrollable activity feed
 * for a single employee. Loads the most recent PAGE_SIZE rows on mount,
 * appends new rows live via Supabase Realtime, and offers "Load older" pagination.
 */
export default function EmployeeActivityPanel({ employeeId, employeeName }) {
  const [activityLogs, setActivityLogs] = useState([])
  const [browserLogs, setBrowserLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [hasMoreBrowser, setHasMoreBrowser] = useState(true)
  const [tab, setTab] = useState('files') // 'files' | 'browser'
  const panelRef = useRef(null)
  const channelRef = useRef(null)

  // ── Initial fetch ──────────────────────────────────────────────────────────
  const fetchInitialData = useCallback(async () => {
    const supabase = getSupabaseClient()
    if (!supabase || !employeeId) return

    setLoading(true)
    try {
      // Fetch filesystem/USB logs
      const { data: fsData, error: fsErr } = await supabase
        .from('employee_activity_logs')
        .select('*')
        .eq('user_id', employeeId)
        .order('timestamp', { ascending: false })
        .range(0, PAGE_SIZE - 1)

      if (fsErr) console.error('[Panel] FS logs fetch error:', fsErr.message)
      else {
        setActivityLogs((fsData || []).reverse())
        setHasMore((fsData || []).length >= PAGE_SIZE)
      }

      // Fetch browser logs
      const { data: bData, error: bErr } = await supabase
        .from('browser_activity_logs')
        .select('*')
        .eq('employee_id', employeeId)
        .order('visited_at', { ascending: false })
        .range(0, PAGE_SIZE - 1)

      if (bErr) console.error('[Panel] Browser logs fetch error:', bErr.message)
      else {
        setBrowserLogs((bData || []).reverse())
        setHasMoreBrowser((bData || []).length >= PAGE_SIZE)
      }
    } catch (err) {
      console.error('[Panel] Initial fetch exception:', err)
    }
    setLoading(false)
  }, [employeeId])

  useEffect(() => {
    fetchInitialData()
  }, [fetchInitialData])

  // ── Realtime subscription ──────────────────────────────────────────────────
  // We don't set a table-level filter — RLS scopes the rows delivered to the admin.
  // We route incoming rows to this panel by matching employee_id / user_id.
  useEffect(() => {
    const supabase = getSupabaseClient()
    if (!supabase || !employeeId) return

    // We subscribe to specific employee's events for this panel
    const channel = supabase
      .channel(`emp-panel-${employeeId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'employee_activity_logs' },
        (payload) => {
          const row = payload.new
          if (row.user_id === employeeId) {
            setActivityLogs(prev => [...prev, row])
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'browser_activity_logs' },
        (payload) => {
          const row = payload.new
          // browser_activity_logs.employee_id is TEXT, compare as string
          if (row.employee_id === employeeId) {
            setBrowserLogs(prev => [...prev, row])
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`[Panel] Realtime subscribed for employee ${employeeId}`)
        }
      })

    channelRef.current = channel

    return () => {
      supabase.removeChannel(channel)
    }
  }, [employeeId])

  // ── Auto-scroll to bottom on new entries ───────────────────────────────────
  useEffect(() => {
    if (panelRef.current) {
      const el = panelRef.current
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100
      if (isNearBottom) {
        el.scrollTop = el.scrollHeight
      }
    }
  }, [activityLogs, browserLogs])

  // ── Load older (pagination) ────────────────────────────────────────────────
  const loadOlderFiles = async () => {
    const supabase = getSupabaseClient()
    if (!supabase || !employeeId || loadingMore) return

    setLoadingMore(true)
    const offset = activityLogs.length

    const { data, error } = await supabase
      .from('employee_activity_logs')
      .select('*')
      .eq('user_id', employeeId)
      .order('timestamp', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      console.error('[Panel] Load older FS error:', error.message)
    } else {
      const olderRows = (data || []).reverse()
      setActivityLogs(prev => [...olderRows, ...prev])
      setHasMore((data || []).length >= PAGE_SIZE)
    }
    setLoadingMore(false)
  }

  const loadOlderBrowser = async () => {
    const supabase = getSupabaseClient()
    if (!supabase || !employeeId || loadingMore) return

    setLoadingMore(true)
    const offset = browserLogs.length

    const { data, error } = await supabase
      .from('browser_activity_logs')
      .select('*')
      .eq('employee_id', employeeId)
      .order('visited_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      console.error('[Panel] Load older browser error:', error.message)
    } else {
      const olderRows = (data || []).reverse()
      setBrowserLogs(prev => [...olderRows, ...prev])
      setHasMoreBrowser((data || []).length >= PAGE_SIZE)
    }
    setLoadingMore(false)
  }

  // ── Render helpers ─────────────────────────────────────────────────────────
  function formatTimestamp(ts) {
    if (!ts) return ''
    try {
      return new Date(ts).toLocaleString()
    } catch {
      return ts
    }
  }

  function getActionLabel(action) {
    const map = {
      create: 'CREATE',
      copy: 'COPY',
      move: 'MOVE',
      rename: 'RENAME',
      delete: 'DELETE',
      modify: 'MODIFY',
      pen_drive_insert: 'USB INSERT',
      pen_drive_eject: 'USB EJECT',
    }
    return map[(action || '').toLowerCase()] || (action || 'EVENT').toUpperCase()
  }

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
        <div className="spinner" style={{ margin: '0 auto 0.5rem' }}></div>
        Loading activity for {employeeName || 'employee'}...
      </div>
    )
  }

  const currentLogs = tab === 'files' ? activityLogs : browserLogs
  const currentHasMore = tab === 'files' ? hasMore : hasMoreBrowser
  const loadOlder = tab === 'files' ? loadOlderFiles : loadOlderBrowser

  return (
    <div style={{
      border: '1px solid #e2e8f0',
      borderRadius: '12px',
      backgroundColor: '#ffffff',
      overflow: 'hidden',
      marginBottom: '1rem',
    }}>
      {/* Panel header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.75rem 1rem',
        borderBottom: '1px solid #f1f5f9',
        backgroundColor: '#f8fafc',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{
            width: '32px', height: '32px', borderRadius: '50%',
            background: '#e0e7ff', color: '#4f46e5',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.8rem', fontWeight: 700,
          }}>
            {(employeeName || 'U')[0].toUpperCase()}
          </div>
          <span style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.95rem' }}>
            {employeeName || employeeId}
          </span>
          <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
            ({currentLogs.length} events)
          </span>
        </div>

        {/* Tab toggles */}
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            onClick={() => setTab('files')}
            style={{
              padding: '4px 12px', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
              border: tab === 'files' ? '1px solid #4f46e5' : '1px solid #e2e8f0',
              background: tab === 'files' ? '#eef2ff' : '#fff',
              color: tab === 'files' ? '#4f46e5' : '#64748b',
            }}
          >
            Files / USB
          </button>
          <button
            onClick={() => setTab('browser')}
            style={{
              padding: '4px 12px', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
              border: tab === 'browser' ? '1px solid #3b82f6' : '1px solid #e2e8f0',
              background: tab === 'browser' ? '#eff6ff' : '#fff',
              color: tab === 'browser' ? '#3b82f6' : '#64748b',
            }}
          >
            Browser
          </button>
        </div>
      </div>

      {/* Load older button */}
      {currentHasMore && currentLogs.length > 0 && (
        <div style={{ textAlign: 'center', padding: '0.5rem' }}>
          <button
            onClick={loadOlder}
            disabled={loadingMore}
            style={{
              padding: '4px 16px', borderRadius: '6px', fontSize: '0.78rem',
              fontWeight: 600, cursor: loadingMore ? 'not-allowed' : 'pointer',
              border: '1px solid #e2e8f0', background: '#fff',
              color: '#64748b', opacity: loadingMore ? 0.6 : 1,
            }}
          >
            {loadingMore ? 'Loading…' : '↑ Load older'}
          </button>
        </div>
      )}

      {/* Scrollable log area */}
      <div
        ref={panelRef}
        style={{
          maxHeight: '400px',
          overflowY: 'auto',
          padding: '0.5rem 1rem',
        }}
      >
        {currentLogs.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
            No {tab === 'files' ? 'filesystem/USB' : 'browser'} activity recorded yet.
          </div>
        ) : tab === 'files' ? (
          currentLogs.map((log, i) => {
            const action = getActionLabel(log.action)
            const isUsb = action.includes('USB')
            return (
              <div
                key={log.id || i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.5rem 0',
                  borderBottom: i < currentLogs.length - 1 ? '1px solid #f8fafc' : 'none',
                  fontSize: '0.85rem',
                }}
              >
                <span style={{ color: '#94a3b8', fontSize: '0.75rem', minWidth: '130px', flexShrink: 0 }}>
                  {formatTimestamp(log.timestamp)}
                </span>
                <span
                  className="log-type-badge"
                  data-type={action}
                  style={{
                    fontSize: '0.7rem',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    flexShrink: 0,
                    background: isUsb ? 'rgba(245,158,11,0.12)' : 'rgba(99,102,241,0.08)',
                    color: isUsb ? '#d97706' : '#6366f1',
                    border: isUsb ? '1px solid rgba(245,158,11,0.2)' : '1px solid rgba(99,102,241,0.15)',
                  }}
                >
                  {action}
                </span>
                <span style={{ color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={log.dest_path || log.source_path || ''}
                >
                  {log.dest_path || log.source_path || (log.details?.file) || (log.details?.destination) || '—'}
                </span>
                {isUsb && (
                  <span style={{
                    fontSize: '0.65rem', padding: '1px 6px', borderRadius: '4px',
                    background: '#fef3c7', color: '#92400e', fontWeight: 700, flexShrink: 0,
                  }}>USB</span>
                )}
              </div>
            )
          })
        ) : (
          currentLogs.map((log, i) => {
            const domain = log.domain || ''
            const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : null
            return (
              <div
                key={log.id || i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.5rem 0',
                  borderBottom: i < currentLogs.length - 1 ? '1px solid #f8fafc' : 'none',
                  fontSize: '0.85rem',
                }}
              >
                <span style={{ color: '#94a3b8', fontSize: '0.75rem', minWidth: '130px', flexShrink: 0 }}>
                  {formatTimestamp(log.visited_at)}
                </span>
                {faviconUrl && (
                  <img src={faviconUrl} alt="" style={{ width: '16px', height: '16px', flexShrink: 0 }} />
                )}
                <span style={{ color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={log.url}
                >
                  {domain || log.url || '—'}
                </span>
                {log.page_title && (
                  <span style={{ color: '#94a3b8', fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {log.page_title}
                  </span>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
