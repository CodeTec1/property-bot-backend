import { useState, useEffect } from 'react'
import { supabase } from '../supabase'

export default function Navbar({ title, user }) {
  const [companyName, setCompanyName] = useState('')
  const [currentTime, setCurrentTime] = useState(new Date())

  useEffect(() => {
    fetchCompany()
    const timer = setInterval(() => setCurrentTime(new Date()), 60000)
    return () => clearInterval(timer)
  }, [user])

  async function fetchCompany() {
    if (!user?.email) return
    const { data } = await supabase
      .from('tenants')
      .select('company_name')
      .eq('owner_email', user.email)
      .single()
    if (data) setCompanyName(data.company_name)
  }

  const timeStr = currentTime.toLocaleTimeString('en-KE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Africa/Nairobi'
  })

  const dateStr = currentTime.toLocaleDateString('en-KE', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'Africa/Nairobi'
  })

  return (
    <header style={{
      height: '64px',
      background: 'linear-gradient(90deg, #0d1117 0%, #0B0F1A 100%)',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 28px',
      position: 'sticky',
      top: 0,
      zIndex: 99,
      backdropFilter: 'blur(12px)'
    }}>

      {/* Left — page title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <h1 style={{
          fontFamily: 'Syne, sans-serif',
          fontSize: '18px',
          fontWeight: '700',
          color: '#ffffff',
          letterSpacing: '0.3px'
        }}>
          {title}
        </h1>
      </div>

      {/* Right — status, time, user */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '20px'
      }}>

        {/* Assistant status */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 14px',
          borderRadius: '20px',
          background: 'var(--accent-dim)',
          border: '1px solid var(--accent-border)'
        }}>
          <div style={{
            width: '7px',
            height: '7px',
            borderRadius: '50%',
            background: 'var(--accent)',
            boxShadow: '0 0 8px var(--accent)',
            animation: 'pulse 2s infinite'
          }} />
          <span style={{
            fontSize: '12px',
            fontWeight: '600',
            color: 'var(--accent)',
            letterSpacing: '0.3px'
          }}>
            Assistant Active
          </span>
        </div>

        {/* Time */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end'
        }}>
          <span style={{
            fontSize: '13px',
            fontWeight: '600',
            color: '#ffffff',
            fontVariantNumeric: 'tabular-nums'
          }}>
            {timeStr}
          </span>
          <span style={{
            fontSize: '11px',
            color: 'var(--text-muted)'
          }}>
            {dateStr}
          </span>
        </div>

        {/* Divider */}
        <div style={{
          width: '1px',
          height: '32px',
          background: 'var(--border)'
        }} />

        {/* User avatar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          cursor: 'pointer'
        }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{
              fontSize: '13px',
              fontWeight: '600',
              color: '#ffffff'
            }}>
              {companyName || 'Agency'}
            </div>
            <div style={{
              fontSize: '11px',
              color: 'var(--text-muted)'
            }}>
              {user?.email}
            </div>
          </div>
          <div style={{
            width: '38px',
            height: '38px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #00E5FF, #0088ff)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '14px',
            fontWeight: '800',
            color: '#0B0F1A',
            flexShrink: 0,
            border: '2px solid var(--accent-border)',
            boxShadow: '0 0 12px #00E5FF22'
          }}>
            {companyName?.charAt(0) || user?.email?.charAt(0)?.toUpperCase() || 'A'}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 8px var(--accent); }
          50% { opacity: 0.5; box-shadow: 0 0 4px var(--accent); }
        }
      `}</style>
    </header>
  )
}