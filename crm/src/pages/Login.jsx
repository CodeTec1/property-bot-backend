import { useState } from 'react'
import { supabase } from '../supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0B0F1A',
      display: 'flex',
      position: 'relative',
      overflow: 'hidden'
    }}>

      {/* Animated background orbs */}
      <div style={{
        position: 'absolute',
        top: '-200px',
        left: '-200px',
        width: '600px',
        height: '600px',
        borderRadius: '50%',
        background: 'radial-gradient(circle, #00E5FF18 0%, transparent 70%)',
        animation: 'float1 8s ease-in-out infinite'
      }} />
      <div style={{
        position: 'absolute',
        bottom: '-200px',
        right: '-200px',
        width: '700px',
        height: '700px',
        borderRadius: '50%',
        background: 'radial-gradient(circle, #00E5FF10 0%, transparent 70%)',
        animation: 'float2 10s ease-in-out infinite'
      }} />
      <div style={{
        position: 'absolute',
        top: '50%',
        left: '30%',
        width: '400px',
        height: '400px',
        borderRadius: '50%',
        background: 'radial-gradient(circle, #00E5FF08 0%, transparent 70%)',
        animation: 'float3 12s ease-in-out infinite'
      }} />

      {/* Grid pattern overlay */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `
          linear-gradient(rgba(0, 229, 255, 0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0, 229, 255, 0.03) 1px, transparent 1px)
        `,
        backgroundSize: '50px 50px'
      }} />

      {/* Left panel — branding */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '80px',
        position: 'relative',
        zIndex: 1
      }}>
        {/* Logo */}
        <div style={{ marginBottom: '60px' }}>
          <div style={{
            fontSize: '28px',
            fontWeight: '900',
            letterSpacing: '4px',
            color: '#ffffff',
            marginBottom: '6px'
          }}>
            PROCESSIVE
          </div>
          <div style={{
            fontSize: '11px',
            color: '#00E5FF',
            letterSpacing: '3px',
            fontWeight: '600'
          }}>
            FOR REAL ESTATE
          </div>
        </div>

        {/* Headline */}
        <h1 style={{
          fontSize: '48px',
          fontWeight: '800',
          color: '#ffffff',
          lineHeight: 1.1,
          marginBottom: '24px',
          maxWidth: '480px'
        }}>
          Your AI-Powered
          <span style={{
            display: 'block',
            background: 'linear-gradient(90deg, #00E5FF, #0088ff)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent'
          }}>
            Real Estate
          </span>
          Command Center
        </h1>

        <p style={{
          fontSize: '16px',
          color: '#C0C4C9',
          maxWidth: '400px',
          lineHeight: 1.7,
          marginBottom: '48px'
        }}>
          Monitor leads, track bookings, and manage properties — all powered by your WhatsApp AI assistant.
        </p>

        {/* Feature pills */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {[
            { icon: '👥', text: 'Real-time lead capture and tracking' },
            { icon: '📅', text: 'Automated booking management' },
            { icon: '🏡', text: 'Full property portfolio overview' },
            { icon: '🤖', text: 'AI WhatsApp assistant insights' }
          ].map((item, i) => (
            <div key={i} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }}>
              <div style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: '#00E5FF15',
                border: '1px solid #00E5FF33',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '16px',
                flexShrink: 0
              }}>
                {item.icon}
              </div>
              <span style={{
                fontSize: '14px',
                color: '#C0C4C9'
              }}>
                {item.text}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — login form */}
      <div style={{
        width: '480px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px',
        position: 'relative',
        zIndex: 1
      }}>
        <div style={{
          width: '100%',
          background: 'linear-gradient(135deg, #111827 0%, #0d1526 100%)',
          borderRadius: '24px',
          padding: '48px 40px',
          border: '1px solid #00E5FF22',
          boxShadow: '0 32px 80px rgba(0,0,0,0.5), 0 0 0 1px #00E5FF11, inset 0 1px 0 #00E5FF15'
        }}>

          {/* Form header */}
          <div style={{ marginBottom: '40px' }}>
            <h2 style={{
              fontSize: '26px',
              fontWeight: '800',
              color: '#ffffff',
              marginBottom: '8px'
            }}>
              Welcome back
            </h2>
            <p style={{
              fontSize: '14px',
              color: '#C0C4C9'
            }}>
              Sign in to access your dashboard
            </p>
          </div>

          {/* Error message */}
          {error && (
            <div style={{
              background: '#fee2e215',
              border: '1px solid #ef444433',
              borderRadius: '10px',
              padding: '12px 16px',
              marginBottom: '24px',
              fontSize: '13px',
              color: '#ef4444',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              ⚠️ {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleLogin}>

            {/* Email field */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: '600',
                color: '#C0C4C9',
                marginBottom: '8px',
                letterSpacing: '0.3px'
              }}>
                Email address
              </label>
              <div style={{ position: 'relative' }}>
                <span style={{
                  position: 'absolute',
                  left: '14px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  fontSize: '16px'
                }}>
                  ✉️
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@agency.com"
                  required
                  style={{
                    width: '100%',
                    padding: '14px 16px 14px 44px',
                    borderRadius: '12px',
                    border: '1.5px solid #00E5FF22',
                    background: '#0B0F1A',
                    color: '#ffffff',
                    fontSize: '14px',
                    outline: 'none',
                    boxSizing: 'border-box',
                    transition: 'border-color 0.2s, box-shadow 0.2s'
                  }}
                  onFocus={e => {
                    e.target.style.borderColor = '#00E5FF'
                    e.target.style.boxShadow = '0 0 0 3px #00E5FF15'
                  }}
                  onBlur={e => {
                    e.target.style.borderColor = '#00E5FF22'
                    e.target.style.boxShadow = 'none'
                  }}
                />
              </div>
            </div>

            {/* Password field */}
            <div style={{ marginBottom: '32px' }}>
              <label style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: '600',
                color: '#C0C4C9',
                marginBottom: '8px',
                letterSpacing: '0.3px'
              }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <span style={{
                  position: 'absolute',
                  left: '14px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  fontSize: '16px'
                }}>
                  🔒
                </span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  style={{
                    width: '100%',
                    padding: '14px 44px 14px 44px',
                    borderRadius: '12px',
                    border: '1.5px solid #00E5FF22',
                    background: '#0B0F1A',
                    color: '#ffffff',
                    fontSize: '14px',
                    outline: 'none',
                    boxSizing: 'border-box',
                    transition: 'border-color 0.2s, box-shadow 0.2s'
                  }}
                  onFocus={e => {
                    e.target.style.borderColor = '#00E5FF'
                    e.target.style.boxShadow = '0 0 0 3px #00E5FF15'
                  }}
                  onBlur={e => {
                    e.target.style.borderColor = '#00E5FF22'
                    e.target.style.boxShadow = 'none'
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: '14px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '16px',
                    padding: 0
                  }}
                >
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '16px',
                borderRadius: '12px',
                border: 'none',
                background: loading
                  ? '#C0C4C933'
                  : 'linear-gradient(135deg, #00E5FF, #0088ff)',
                color: loading ? '#C0C4C9' : '#0B0F1A',
                fontSize: '15px',
                fontWeight: '800',
                cursor: loading ? 'not-allowed' : 'pointer',
                letterSpacing: '0.5px',
                transition: 'all 0.2s',
                boxShadow: loading ? 'none' : '0 8px 24px #00E5FF33'
              }}
              onMouseEnter={e => {
                if (!loading) e.target.style.transform = 'translateY(-1px)'
              }}
              onMouseLeave={e => {
                e.target.style.transform = 'translateY(0)'
              }}
            >
              {loading ? 'Signing in...' : 'Sign In →'}
            </button>
          </form>

          {/* Footer */}
          <div style={{
            marginTop: '32px',
            paddingTop: '24px',
            borderTop: '1px solid #00E5FF11',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px'
          }}>
            <div style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: '#00E5FF',
              boxShadow: '0 0 6px #00E5FF',
              animation: 'pulse 2s infinite'
            }} />
            <span style={{
              fontSize: '12px',
              color: '#C0C4C9'
            }}>
              Powered by Processive AI
            </span>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes float1 {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(30px, 20px); }
        }
        @keyframes float2 {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(-20px, -30px); }
        }
        @keyframes float3 {
          0%, 100% { transform: translate(-50%, -50%); }
          50% { transform: translate(-45%, -55%); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        input::placeholder {
          color: #C0C4C955;
        }
      `}</style>
    </div>
  )
}