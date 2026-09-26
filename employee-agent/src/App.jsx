import { useState, useEffect } from 'react';
import { getSupabaseClient } from './supabaseClient';
import Auth from './Auth';

// Bridge the browser session to the Node.js server
async function bridgeSessionToServer(session) {
  if (!session?.access_token || !session?.refresh_token) return;
  try {
    await fetch('http://localhost:3001/api/bootstrap-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      }),
    });
    console.log('[App] Session bridged to server successfully.');
  } catch (err) {
    console.error('[App] Failed to bridge session to server:', err);
  }
}

export default function App() {
  const [user, setUser] = useState(null);
  const [adminId, setAdminId] = useState(null);
  const [inputAdminId, setInputAdminId] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [connectError, setConnectError] = useState('');
  const [connectSuccess, setConnectSuccess] = useState('');

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    // Check initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);

        // Bridge session to Node server
        await bridgeSessionToServer(session);

        // Ensure user exists in users table
        const { error: upsertErr } = await supabase.from('users').upsert({
          id: session.user.id,
          email: session.user.email,
          full_name: session.user.email ? session.user.email.split('@')[0] : 'Unknown',
          is_active: true
        }, { onConflict: 'id' });
        if (upsertErr) console.error('UPSERT ERROR:', upsertErr);
        else console.log('Upsert result: OK');

        const { data } = await supabase.from('users').select('admin_id').eq('id', session.user.id).single();
        if (data) setAdminId(data.admin_id);
      }
    });

    // Listen for auth state changes — bridge session on every SIGNED_IN / TOKEN_REFRESHED
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        setUser(session.user);

        // Bridge session to server on sign-in and token refresh
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          await bridgeSessionToServer(session);
        }

        // Also set employee id on the server (legacy endpoint, still used for command routing)
        fetch('http://localhost:3001/api/set-employee', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employee_id: session.user.id })
        }).catch(err => console.error('Failed to set active employee:', err));

        const { data } = await supabase.from('users').select('admin_id').eq('id', session.user.id).single();
        if (data) setAdminId(data.admin_id);
      } else {
        setUser(null);
        setAdminId(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleConnectAdmin = async (e) => {
    e.preventDefault();
    setConnectError('');
    setConnectSuccess('');
    const supabase = getSupabaseClient();
    if (!supabase || !user) return;

    const { data: requests, error: fetchError } = await supabase
      .from('connection_requests')
      .select('*')
      .eq('admin_id', inputAdminId.trim())
      .eq('code', inputCode.trim())
      .eq('employee_email', user.email.toLowerCase().trim())
      .eq('status', 'pending');

    if (fetchError) {
      console.error('[Connect] Supabase query error:', fetchError);
      setConnectError(`Query error: ${fetchError.message}`);
      return;
    }
    if (!requests || requests.length === 0) {
      console.warn('[Connect] No matching record found. admin_id:', inputAdminId.trim(), '| code:', inputCode.trim(), '| email:', user.email.toLowerCase().trim());
      setConnectError('Invalid or expired code — check Admin ID, code, and that the code was generated for this email.');
      return;
    }

    const request = requests[0];
    if (new Date(request.expires_at) < new Date()) {
      setConnectError('Invalid or expired code');
      return;
    }

    const { error: updateReqError } = await supabase
      .from('connection_requests')
      .update({ status: 'used' })
      .eq('id', request.id);

    if (updateReqError) {
      setConnectError('Error connecting: ' + updateReqError.message);
      return;
    }

    const { error: userUpdateError } = await supabase
      .from('users')
      .update({ admin_id: inputAdminId })
      .eq('id', user.id);

    if (userUpdateError) {
      setConnectError('Error linking admin: ' + userUpdateError.message);
      return;
    }

    setAdminId(inputAdminId);
    setConnectSuccess('Connected successfully!');
  };

  const handleSignOut = async () => {
    const supabase = getSupabaseClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    setUser(null);
    setAdminId(null);
  };

  if (!user) {
    return <Auth onAuthSuccess={setUser} />;
  }

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
      {user && adminId ? (
        <div style={{
          background: '#1e293b',
          border: '1px solid #334155',
          borderRadius: '16px',
          padding: '2.5rem 3rem',
          maxWidth: '500px',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)',
          width: '100%'
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
            border: '1px solid #1e293b',
            marginBottom: '1.5rem'
          }}>
            STATUS: BACKGROUND_MONITORING_ACTIVE
          </div>
          <div style={{ color: '#22c55e', fontWeight: 600, padding: '1rem', background: 'rgba(34,197,94,0.1)', borderRadius: '8px' }}>
            Connected to admin: {adminId}
          </div>

          <div style={{ marginTop: '2rem', borderTop: '1px solid #334155', paddingTop: '1.5rem' }}>
            <button
              onClick={handleSignOut}
              style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', background: 'transparent', color: '#94a3b8', border: '1px solid #334155', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }}
              onMouseOver={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.borderColor = '#ef4444'; }}
              onMouseOut={e => { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.borderColor = '#334155'; }}
            >
              Sign Out & Switch Employee
            </button>
          </div>
        </div>
      ) : (
        <div style={{
          background: '#1e293b',
          border: '1px solid #334155',
          borderRadius: '16px',
          padding: '2rem',
          maxWidth: '500px',
          width: '100%',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)'
        }}>
          <form onSubmit={handleConnectAdmin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              background: 'rgba(59, 130, 246, 0.15)',
              color: '#3b82f6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 0.5rem auto'
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
            </div>
            <h3 style={{ margin: 0, fontSize: '1.4rem', color: '#fff', marginBottom: '0.5rem' }}>Link to Admin</h3>
            <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '1rem', lineHeight: '1.4' }}>
              Enter the 6-digit connection code generated by your administrator to activate monitoring.
            </p>
            <input
              type="text"
              placeholder="Admin ID (e.g. admin@company.com)"
              value={inputAdminId}
              onChange={e => setInputAdminId(e.target.value)}
              style={{ padding: '0.75rem', borderRadius: '8px', border: '1px solid #334155', background: '#0f172a', color: '#fff' }}
              required
            />
            <input
              type="text"
              placeholder="6-digit Code"
              value={inputCode}
              onChange={e => setInputCode(e.target.value)}
              style={{ padding: '0.75rem', borderRadius: '8px', border: '1px solid #334155', background: '#0f172a', color: '#fff', letterSpacing: '2px', textAlign: 'center', fontSize: '1.1rem' }}
              required
              maxLength={6}
            />
            <button type="submit" style={{ padding: '0.85rem', borderRadius: '8px', background: '#3b82f6', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer', marginTop: '0.5rem' }}>
              Verify & Connect
            </button>
            {connectError && <div style={{ color: '#ef4444', fontSize: '0.9rem', marginTop: '0.5rem', padding: '0.75rem', background: 'rgba(239,68,68,0.1)', borderRadius: '6px' }}>{connectError}</div>}

            <div style={{ marginTop: '1.5rem', borderTop: '1px solid #334155', paddingTop: '1rem' }}>
              <button
                type="button"
                onClick={handleSignOut}
                style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '0.85rem', cursor: 'pointer', textDecoration: 'underline' }}
              >
                Sign out of {user?.email}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
