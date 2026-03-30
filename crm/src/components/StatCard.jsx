export default function StatCard({ title, value, icon, color, subtitle }) {
  return (
    <div style={{
      background: '#ffffff',
      borderRadius: '16px',
      padding: '24px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      position: 'relative',
      overflow: 'hidden',
      boxShadow: '0 4px 24px rgba(0,0,0,0.15)'
    }}>
      {/* Background accent */}
      <div style={{
        position: 'absolute',
        top: '-20px',
        right: '-20px',
        width: '80px',
        height: '80px',
        borderRadius: '50%',
        background: color || '#00E5FF',
        opacity: 0.08
      }} />

      {/* Icon and title */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <span style={{
          fontSize: '12px',
          fontWeight: '600',
          color: '#6b7280',
          letterSpacing: '0.5px',
          textTransform: 'uppercase'
        }}>
          {title}
        </span>
        <div style={{
          width: '40px',
          height: '40px',
          borderRadius: '10px',
          background: color ? `${color}18` : '#00E5FF18',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '18px'
        }}>
          {icon}
        </div>
      </div>

      {/* Value */}
      <div style={{
        fontSize: '32px',
        fontWeight: '800',
        color: '#0B0F1A',
        lineHeight: 1
      }}>
        {value}
      </div>

      {/* Subtitle */}
      {subtitle && (
        <div style={{
          fontSize: '12px',
          color: '#6b7280'
        }}>
          {subtitle}
        </div>
      )}

      {/* Bottom accent line */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: '3px',
        background: color || '#00E5FF',
        borderRadius: '0 0 16px 16px'
      }} />
    </div>
  )
}