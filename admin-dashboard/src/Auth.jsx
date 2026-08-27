import { useState } from 'react'
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient'

export default function Auth({ onAuthSuccess }) {
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [infoMsg, setInfoMsg] = useState('')

  // For quick in-app configuration if .env was not populated yet
  const [hasConfig, setHasConfig] = useState(isSupabaseConfigured())
  const [configUrl, setConfigUrl] = useState('')
  const [configKey, setConfigKey] = useState('')

  const handleSaveConfig = (e) => {
    e.preventDefault()
    if (!configUrl.trim() || !configKey.trim()) {
      setErrorMsg('Please enter both Supabase URL and Anon Key')
      return
    }
    localStorage.setItem('supabase_url', configUrl.trim())
    localStorage.setItem('supabase_anon_key', configKey.trim())
    setHasConfig(true)
    setErrorMsg('')
    setInfoMsg('Supabase credentials saved successfully!')
  }

  const handleGoogleAuth = async () => {
    setErrorMsg('')
    setInfoMsg('')

    const supabase = getSupabaseClient()
    if (!supabase) {
      setErrorMsg('Supabase is not configured. Please add your credentials.')
      setHasConfig(false)
      return
    }

    setGoogleLoading(true)
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        },
      })
      if (error) throw error
    } catch (err) {
      setErrorMsg(err.message || 'Google authentication failed. Please check your Supabase settings.')
      setGoogleLoading(false)
    }
  }

  const handleAuth = async (e) => {
    e.preventDefault()
    setErrorMsg('')
    setInfoMsg('')

    const supabase = getSupabaseClient()
    if (!supabase) {
      setErrorMsg('Supabase is not configured. Please add your credentials.')
      setHasConfig(false)
      return
    }

    if (!email || !password) {
      setErrorMsg('Please provide both email and password.')
      return
    }

    if (isSignUp && password !== confirmPassword) {
      setErrorMsg('Passwords do not match.')
      return
    }

    if (isSignUp && password.length < 6) {
      setErrorMsg('Password must be at least 6 characters.')
      return
    }

    setLoading(true)

    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        })
        if (error) throw error

        if (data?.user && !data?.session) {
          setInfoMsg('Sign Up successful! Please check your email for confirmation.')
        } else if (data?.session) {
          setInfoMsg('Account created successfully!')
          if (onAuthSuccess) onAuthSuccess(data.session.user)
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })
        if (error) throw error

        if (data?.session) {
          if (onAuthSuccess) onAuthSuccess(data.session.user)
        }
      }
    } catch (err) {
      setErrorMsg(err.message || 'An authentication error occurred.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-wrapper">
      {/* ── Outer 2-Column Auth Card ── */}
      <div className="auth-split-card">
        
        {/* ── Left Banner Section (Screenshot Layout) ── */}
        <div className="auth-banner">
          {/* Ambient Glows */}
          <div className="banner-glow banner-glow-top"></div>
          <div className="banner-glow banner-glow-bottom"></div>

          {/* Top Brand Bar */}
          <div className="banner-brand">
            <div className="banner-logo-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
                <polyline points="13 2 13 9 20 9"/>
              </svg>
            </div>
            <span className="banner-brand-name">ITR File Monitor</span>
          </div>

          {/* Banner Main Content */}
          <div className="banner-main">
            <div className="banner-pill">
              <span className="banner-pill-dot"></span>
              <span>System / Ready</span>
            </div>

            <h1 className="banner-headline">Start Your<br />Journey</h1>
            <p className="banner-description">
              Follow these simple steps to set up your account and activate real-time file system intelligence & security tracking.
            </p>

            {/* Step Feature Cards (3 Glass Cards at Bottom) */}
            <div className="banner-steps">
              <div className="step-card active">
                <div className="step-number">1</div>
                <div className="step-content">
                  <div className="step-title">Register account</div>
                  <div className="step-subtitle">Instant secure access</div>
                </div>
              </div>

              <div className="step-card">
                <div className="step-number">2</div>
                <div className="step-content">
                  <div className="step-title">Live Tracking</div>
                  <div className="step-subtitle">Sub-second event logging</div>
                </div>
              </div>

              <div className="step-card">
                <div className="step-number">3</div>
                <div className="step-content">
                  <div className="step-title">Threat Audit</div>
                  <div className="step-subtitle">USB & media alerts</div>
                </div>
              </div>
            </div>
          </div>

          {/* Banner Footnote */}
          <div className="banner-footer">
            <span>v1.0.0 &bull; Real-time File Telemetry System</span>
          </div>
        </div>

        {/* ── Right Auth Form Panel ── */}
        <div className="auth-panel">
          {!hasConfig ? (
            <div className="config-form-container">
              <div className="auth-panel-header">
                <h2>Connect Supabase</h2>
                <p>
                  Please enter your Supabase Project URL and Anon Public Key to activate authentication.
                </p>
              </div>

              {errorMsg && <div className="auth-alert error">{errorMsg}</div>}
              {infoMsg && <div className="auth-alert info">{infoMsg}</div>}

              <form onSubmit={handleSaveConfig} className="auth-form">
                <div className="form-group">
                  <label>Project URL</label>
                  <input
                    type="url"
                    placeholder="https://xyzcompany.supabase.co"
                    value={configUrl}
                    onChange={(e) => setConfigUrl(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Anon Public Key</label>
                  <input
                    type="password"
                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                    value={configKey}
                    onChange={(e) => setConfigKey(e.target.value)}
                    required
                  />
                </div>

                <button type="submit" className="auth-submit-btn">
                  Save & Continue
                </button>
              </form>
            </div>
          ) : (
            <div className="auth-form-container">
              {/* Form Heading */}
              <div className="auth-panel-header">
                <h2>{isSignUp ? 'Join Us' : 'Welcome Back'}</h2>
                <p>
                  {isSignUp
                    ? 'Create your account to start tracking live file system activity.'
                    : 'Log in with your credentials to access the monitoring dashboard.'}
                </p>
              </div>

              {/* Tab Switcher */}
              <div className="auth-tabs">
                <button
                  type="button"
                  className={`auth-tab ${!isSignUp ? 'active' : ''}`}
                  onClick={() => {
                    setIsSignUp(false)
                    setErrorMsg('')
                    setInfoMsg('')
                  }}
                >
                  Log In
                </button>
                <button
                  type="button"
                  className={`auth-tab ${isSignUp ? 'active' : ''}`}
                  onClick={() => {
                    setIsSignUp(true)
                    setErrorMsg('')
                    setInfoMsg('')
                  }}
                >
                  Sign Up
                </button>
              </div>

              {errorMsg && <div className="auth-alert error">{errorMsg}</div>}
              {infoMsg && <div className="auth-alert info">{infoMsg}</div>}

              {/* Form Fields */}
              <form onSubmit={handleAuth} className="auth-form">
                <div className="form-group">
                  <label>Email address</label>
                  <input
                    type="email"
                    placeholder="user@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Password</label>
                  <input
                    type="password"
                    placeholder="••••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>

                {isSignUp && (
                  <div className="form-group">
                    <label>Confirm Password</label>
                    <input
                      type="password"
                      placeholder="••••••••••••"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                    />
                  </div>
                )}

                <button type="submit" className="auth-submit-btn" disabled={loading || googleLoading}>
                  {loading ? (
                    <span className="btn-loading">
                      <span className="spinner"></span>
                      {isSignUp ? 'Creating Account...' : 'Logging In...'}
                    </span>
                  ) : (
                    isSignUp ? 'Continue & Register' : 'Continue'
                  )}
                </button>
              </form>

              {/* Divider */}
              <div className="auth-divider">
                <span>Or</span>
              </div>

              {/* Google OAuth Button */}
              <button
                type="button"
                className="google-auth-btn"
                onClick={handleGoogleAuth}
                disabled={googleLoading || loading}
              >
                {googleLoading ? (
                  <span className="btn-loading">
                    <span className="spinner"></span>
                    Connecting to Google...
                  </span>
                ) : (
                  <>
                    <svg className="google-icon" width="20" height="20" viewBox="0 0 24 24">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                      />
                    </svg>
                    <span>{isSignUp ? 'Sign up with Google' : 'Sign in with Google'}</span>
                  </>
                )}
              </button>

              {/* Footer Switcher */}
              <div className="auth-footer">
                {isSignUp ? (
                  <p>
                    Already have an account?{' '}
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => {
                        setIsSignUp(false)
                        setErrorMsg('')
                        setInfoMsg('')
                      }}
                    >
                      Log In
                    </button>
                  </p>
                ) : (
                  <p>
                    Don't have an account?{' '}
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => {
                        setIsSignUp(true)
                        setErrorMsg('')
                        setInfoMsg('')
                      }}
                    >
                      Sign Up
                    </button>
                  </p>
                )}

                <button
                  type="button"
                  className="config-switch-link"
                  onClick={() => setHasConfig(false)}
                >
                  Change Supabase Settings
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
