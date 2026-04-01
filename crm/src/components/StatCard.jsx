import { useEffect, useState } from 'react'

function useCountUp(target, duration = 1000) {
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (target === 0) { setCount(0); return }
    let start = 0
    const increment = target / (duration / 16)
    const timer = setInterval(() => {
      start += increment
      if (start >= target) {
        setCount(target)
        clearInterval(timer)
      } else {
        setCount(Math.floor(start))
      }
    }, 16)
    return () => clearInterval(timer)
  }, [target])

  return count
}

export default function StatCard({ title, value, icon, color, subtitle, trend }) {
  const animatedValue = useCountUp(typeof value === 'number' ? value : 0)

  return (
    <div
      className="fade-up"
      style={{
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)',
        padding: '24px',
        border: '1px solid var(--border)',
        position: 'relative',
        overflow: 'hidden',
        transition: 'var(--transition)',
        cursor: 'default'
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = color || 'var(--accent)'
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.boxShadow = `0 8px 32px ${color || '#00E5FF'}22`
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--border)'
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      {/* Background glow */}
      <div style={{
        position: 'absolute',
        top: '-40px',
        right: '-40px',
        width: '120px',
        height: '120px',
        borderRadius: '50%',
        background: color || 'var(--accent)',
        opacity: 0.06,
        filter: 'blur(30px)',
        pointerEvents: 'none'
      }} />

      {/* Top row */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        marginBottom: '16px'
      }}>
        <span style={{
          fontSize: '12px',
          fontWeight: '600',
          color: 'var(--text-muted)',
          letterSpacing: '0.5px',
          textTransform: 'uppercase'
        }}>
          {title}
        </span>

        <div style={{
          width: '40px',
          height: '40px',
          borderRadius: 'var(--radius-sm)',
          background: `${color || 'var(--accent)'}18`,
          border: `1px solid ${color || 'var(--accent)'}33`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '18px',
          flexShrink: 0
        }}>
          {icon}
        </div>
      </div>

      {/* Value */}
      <div style={{
        fontFamily: 'Syne, sans-serif',
        fontSize: '36px',
        fontWeight: '800',
        color: '#ffffff',
        lineHeight: 1,
        marginBottom: '8px',
        animation: 'countUp 0.4s ease both'
      }}>
        {typeof value === 'number' ? animatedValue.toLocaleString() : value}
      </div>

      {/* Subtitle and trend */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        {subtitle && (
          <span style={{
            fontSize: '12px',
            color: 'var(--text-muted)'
          }}>
            {subtitle}
          </span>
        )}

        {trend !== undefined && (
          <span style={{
            fontSize: '12px',
            fontWeight: '600',
            color: trend >= 0 ? 'var(--success)' : 'var(--danger)',
            background: trend >= 0 ? '#10b98115' : '#ef444415',
            padding: '2px 8px',
            borderRadius: '20px'
          }}>
            {trend >= 0 ? '↑' : '↓'} {Math.abs(trend)}%
          </span>
        )}
      </div>

      {/* Bottom accent line */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: '2px',
        background: `linear-gradient(90deg, ${color || 'var(--accent)'}, transparent)`,
        borderRadius: '0 0 var(--radius-lg) var(--radius-lg)'
      }} />
    </div>
  )
}