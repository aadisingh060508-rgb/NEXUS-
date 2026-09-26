import { useState, useMemo } from 'react';

const ACTIVITY_LABEL = { active: 'Active', idle: 'Idle', visited: 'Visited' }

function getRelativeTime(dateInput) {
  if (!dateInput) return '';
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return dateInput;

  const now = new Date();
  const diffInSeconds = Math.floor((now - date) / 1000);

  if (diffInSeconds < 60) {
    return 'Just now';
  } else if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60);
    return `${minutes} min ago`;
  } else if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600);
    return `${hours} hr ago`;
  } else {
    return date.toLocaleDateString();
  }
}

export default function WebsiteMonitoring({ stats: passedStats, activity: passedActivity, recent = [] }) {
  const [employeeFilter, setEmployeeFilter] = useState('all-emp');

  // Compute live statistics directly from real database logs
  const computedStats = useMemo(() => {
    const totalVisits = recent.length;
    const uniqueWebsites = new Set(recent.map(r => r.domain || r.site).filter(Boolean)).size;
    const uniqueEmployees = new Set(recent.map(r => r.employee_id || r.employee).filter(Boolean)).size;
    // Estimate browsing time (approx 3 min per visit)
    const totalMinutes = totalVisits * 3;
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    const browsingTime = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

    return {
      totalVisits,
      activeWebsites: uniqueWebsites,
      activeEmployees: uniqueEmployees,
      browsingTime: totalVisits > 0 ? browsingTime : '0m',
    };
  }, [recent]);

  const stats = (passedStats && passedStats.totalVisits > 0) ? passedStats : computedStats;

  // Map recent logs to activity rows if passedActivity is empty
  const liveActivity = useMemo(() => {
    if (passedActivity && passedActivity.length > 0) return passedActivity;
    return recent.map(r => ({
      employee: r.employee_id || r.employee || 'Employee',
      website: r.domain || r.site || r.url || 'Website',
      browser: r.browser || 'Chrome',
      activity: r.activity || 'visited',
      time: r.time || (r.visited_at ? new Date(r.visited_at).toLocaleTimeString() : 'Just now'),
      duration: r.duration || '1 min'
    }));
  }, [passedActivity, recent]);

  const employeeOptions = useMemo(() => {
    const ids = new Set(recent.map(r => r.employee_id || r.employee).filter(Boolean));
    return Array.from(ids);
  }, [recent]);

  const filteredRecent = useMemo(() => {
    if (employeeFilter === 'all-emp') return recent;
    return recent.filter(r => (r.employee_id || r.employee) === employeeFilter);
  }, [recent, employeeFilter]);

  return (
    <div className="page-view">
      <div className="page-header-row">
        <div>
          <h1 className="page-title">Website Monitoring</h1>
          <p className="page-subtitle">Monitor employee browser and website activity.</p>
        </div>
      </div>

      <div className="filter-row">
        <select className="filter-select" defaultValue="today"><option value="today">Today</option></select>
        <select className="filter-select" value={employeeFilter} onChange={e => setEmployeeFilter(e.target.value)}>
          <option value="all-emp">All Employees</option>
          {employeeOptions.map(emp => (
            <option key={emp} value={emp}>{emp}</option>
          ))}
        </select>
        <select className="filter-select" defaultValue="all-browser"><option value="all-browser">All Browsers</option></select>
        <input className="filter-input" type="text" placeholder="Search website or employee" />
      </div>

      <div className="admin-stats-grid four-up">
        <div className="admin-stat-card">
          <span className="font-mono-label">Total Visits</span>
          <span className="admin-stat-value">{stats.totalVisits?.toLocaleString() || 0}</span>
        </div>
        <div className="admin-stat-card">
          <span className="font-mono-label">Active Websites</span>
          <span className="admin-stat-value">{stats.activeWebsites || 0}</span>
        </div>
        <div className="admin-stat-card">
          <span className="font-mono-label">Active Employees</span>
          <span className="admin-stat-value">{stats.activeEmployees || 0}</span>
        </div>
        <div className="admin-stat-card">
          <span className="font-mono-label">Browsing Time</span>
          <span className="admin-stat-value">{stats.browsingTime || '0m'}</span>
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
            {liveActivity.length === 0 ? (
              <div style={{ padding: '20px', color: '#64748b', fontSize: '0.9rem', fontStyle: 'italic' }}>
                No website activity recorded.
              </div>
            ) : (
              liveActivity.map((row, i) => (
                <div className="data-table-row six-col" key={i}>
                  <span className="cell-strong">{row.employee}</span>
                  <span>{row.website}</span>
                  <span>{row.browser}</span>
                  <span><span className={`status-dot-label ${row.activity === 'active' ? 'online' : row.activity === 'idle' ? 'warning' : ''}`}><span className="status-dot-inline" />{ACTIVITY_LABEL[row.activity] || row.activity}</span></span>
                  <span>{row.time}</span>
                  <span>{row.duration}</span>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="admin-panel" style={{ backgroundColor: '#ffffff', borderRadius: '12px', padding: '24px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05)', border: '1px solid #f1f5f9' }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#1e293b', marginBottom: '8px', border: 'none', padding: 0 }}>Recent Activity</h2>
          <p style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: '24px' }}>Live feed of the latest browsing activity from monitored devices</p>
          
          <ul style={{ padding: 0, listStyle: 'none', margin: 0, position: 'relative' }}>
            {filteredRecent.length === 0 ? (
              <div style={{ color: '#64748b', fontSize: '0.9rem', fontStyle: 'italic', padding: '12px 0' }}>
                No recent browsing activity recorded yet.
              </div>
            ) : (
              filteredRecent.map((row, i) => {
                const employee = row.employee_id || row.employee || 'TEST-EMP-001';
                const domain = row.domain || row.site || '';
                const timeInput = row.visited_at || row.timestamp || row.time;
                const relTime = getRelativeTime(timeInput);
                
                const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : null;
                
                // Timeline and text colors matching the image's vibrant accents
                const timeColors = ['#4f46e5', '#3b82f6', '#ec4899', '#8b5cf6', '#d946ef', '#0ea5e9'];
                const timeColor = timeColors[i % timeColors.length];
                
                const isLast = i === filteredRecent.length - 1;

                return (
                  <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', paddingBottom: isLast ? '0' : '0', position: 'relative' }}>
                    {/* Vertical Timeline Line */}
                    {!isLast && (
                      <div style={{ position: 'absolute', left: '19px', top: '40px', bottom: '-16px', width: '2px', backgroundColor: '#e2e8f0', zIndex: 0 }} />
                    )}
                    
                    {/* Icon Container */}
                    <div style={{ 
                      position: 'relative',
                      zIndex: 1,
                      width: '40px', 
                      height: '40px', 
                      borderRadius: '50%', 
                      backgroundColor: '#f8fafc', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      border: '1px solid #f1f5f9',
                      flexShrink: 0
                    }}>
                      {faviconUrl ? (
                        <img src={faviconUrl} alt={domain} style={{ width: '20px', height: '20px' }} />
                      ) : (
                        <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#cbd5e1' }} />
                      )}
                    </div>
                    
                    {/* Content Container */}
                    <div style={{ flex: 1, minWidth: 0, paddingTop: '2px', borderBottom: isLast ? 'none' : '1px solid #f1f5f9', paddingBottom: '16px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ color: '#334155', fontSize: '0.95rem' }}>
                          Visited <strong style={{ color: '#0f172a' }}>{domain || 'Unknown'}</strong>
                        </div>
                        <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginTop: '4px' }}>
                          by {employee}
                        </div>
                      </div>
                      
                      {/* Time */}
                      <div style={{ color: timeColor, fontSize: '0.85rem', fontWeight: '500', whiteSpace: 'nowrap', paddingTop: '2px' }}>
                        {relTime}
                      </div>
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        </section>
      </div>
    </div>
  )
}

