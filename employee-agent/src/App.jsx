export default function App() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#0f172a',
      color: '#f8fafc',
      fontFamily: 'Inter, sans-serif',
      padding: '2rem',
      textAlign: 'center'
    }}>
      <div style={{
        background: '#1e293b',
        border: '1px solid #334155',
        borderRadius: '16px',
        padding: '2.5rem 3rem',
        maxWidth: '500px',
        boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)'
      }}>
        <div style={{
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          background: 'rgba(34, 197, 94, 0.15)',
          color: '#22c55e',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 1.5rem auto'
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem', color: '#ffffff' }}>Employee Agent Service Active</h2>
        <p style={{ color: '#94a3b8', fontSize: '0.95rem', lineHeight: '1.5', marginBottom: '1.5rem' }}>
          The local monitoring process (Go engine + Node server) is running in the background. Monitoring data is streamed directly to the Admin Dashboard.
        </p>
        <div style={{
          fontSize: '0.8rem',
          fontFamily: 'monospace',
          background: '#0f172a',
          padding: '0.75rem 1rem',
          borderRadius: '8px',
          color: '#38bdf8',
          border: '1px solid #1e293b'
        }}>
          STATUS: BACKGROUND_MONITORING_ACTIVE
        </div>
      </div>
    </div>
  )
}
