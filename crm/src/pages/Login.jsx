import { useState } from 'react'
import { supabase } from '../supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    })

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
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
      position: 'relative',
      overflow: 'hidden'
    }}>

      {/* Background glow effects */}
      <div style={{
        position: 'absolute',
        top: '-100px',
        left: '-100px',
        width: '400px',
        height: '400px',
        borderRadius: '50%',
        background: '#00E5FF',
        opacity: 0.04,
        filter: 'blur(80px)'
      }} />
      <div style={{
        position: 'absolute',
        bottom: '-100px',
        right: '-100px',
        width: '400px',
        height: '400px',
        borderRadius: '50%',
        background: '#00E5FF',
        opacity: 0.04,
        filter: 'blur(80px)'
      }} />

      {/* Login card */}
      <div style={{
        width: '100%',
        maxWidth: '420px',
        background: '#ffffff',
        borderRadius: '24px',
        padding: '48px 40px',
        boxShadow: '0 24px 80px rgba(0,0,0,0.4)',
        position: 'relative',
        zIndex: 1
      }}>

        {/* Logo */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '40px',
          justifyContent: 'center'
        }}>
          <div style={{
            width: '40px',
            height: '40px',
            background: 'linear-gradient(135deg, #00E5FF, #00E5FF)',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: '900',
            fontSize: '20px',
            color: '#ffffff'
          }}>
            P
          </div>
          <div>
            <div style={{
              fontSize: '16px',
              fontWeight: '800',
              letterSpacing: '2px',
              color: '#0B0F1A'
            }}>
              PROCESSIVE
            </div>
            <div style={{
              fontSize: '10px',
              color: '#6b7280',
              letterSpacing: '1px'
            }}>
              FOR REAL ESTATE
            </div>
          </div>
        </div>

        {/* Heading */}
        <div style={{ marginBottom: '32px', textAlign: 'center' }}>
          <h2 style={{
            fontSize: '24px',
            fontWeight: '800',
            color: '#0B0F1A',
            marginBottom: '8px'
          }}>
            Welcome back
          </h2>
          <p style={{
            fontSize: '14px',
            color: '#6b7280'
          }}>
            Sign in to your dashboard
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div style={{
            background: '#fee2e2',
            border: '1px solid #fecaca',
            borderRadius: '10px',
            padding: '12px 16px',
            marginBottom: '20px',
            fontSize: '13px',
            color: '#dc2626'
          }}>
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: '20px' }}>
            <label style={{
              display: 'block',
              fontSize: '13px',
              fontWeight: '600',
              color: '#0B0F1A',
              marginBottom: '8px'
            }}>
              Email address
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@agency.com"
              required
              style={{
                width: '100%',
                padding: '14px 16px',
                borderRadius: '10px',
                border: '1.5px solid #e5e7eb',
                fontSize: '14px',
                color: '#0B0F1A',
                background: '#f9fafb',
                outline: 'none',
                transition: 'border-color 0.2s',
                boxSizing: 'border-box'
              }}
              onFocus={e => e.target.style.borderColor = '#00E5FF'}
              onBlur={e => e.target.style.borderColor = '#e5e7eb'}
            />
          </div>

          <div style={{ marginBottom: '28px' }}>
            <label style={{
              display: 'block',
              fontSize: '13px',
              fontWeight: '600',
              color: '#0B0F1A',
              marginBottom: '8px'
            }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              style={{
                width: '100%',
                padding: '14px 16px',
                borderRadius: '10px',
                border: '1.5px solid #e5e7eb',
                fontSize: '14px',
                color: '#0B0F1A',
                background: '#f9fafb',
                outline: 'none',
                transition: 'border-color 0.2s',
                boxSizing: 'border-box'
              }}
              onFocus={e => e.target.style.borderColor = '#00E5FF'}
              onBlur={e => e.target.style.borderColor = '#e5e7eb'}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '14px',
              borderRadius: '10px',
              border: 'none',
              background: loading
                ? '#9ca3af'
                : 'linear-gradient(135deg, #00E5FF, #00E5FF)',
              color: '#ffffff',
              fontSize: '15px',
              fontWeight: '700',
              cursor: loading ? 'not-allowed' : 'pointer',
              letterSpacing: '0.5px',
              transition: 'opacity 0.2s'
            }}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        {/* Footer */}
        <p style={{
          textAlign: 'center',
          marginTop: '24px',
          fontSize: '12px',
          color: '#9ca3af'
        }}>
          Powered by Processive AI
        </p>
      </div>
    </div>
  )
}