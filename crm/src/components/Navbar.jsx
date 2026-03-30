export default function Navbar({ title }) {
  return (
    <header style={{
      height: '64px',
      background: '#111827',
      borderBottom: '1px solid #00E5FF22',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 32px',
      position: 'sticky',
      top: 0,
      zIndex: 99
    }}>
      {/* Page Title */}
      <h1 style={{
        fontSize: '18px',
        fontWeight: '700',
        color: '#ffffff',
        letterSpacing: '0.5px'
      }}>
        {title}
      </h1>

      {/* Right side */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '16px'
      }}>
        {/* Live indicator */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '12px',
          color: '#00E5FF'
        }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: '#00E5FF',
            boxShadow: '0 0 6px #00E5FF',
            animation: 'pulse 2s infinite'
          }} />
          Assistant Active
        </div>

        {/* User avatar */}
        <div style={{
          width: '36px',
          height: '36px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #00E5FF, #00E5FF)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '14px',
          fontWeight: '700',
          color: '#0B0F1A',
          cursor: 'pointer'
        }}>
          A
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </header>
  )
}