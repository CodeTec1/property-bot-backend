import { NavLink } from 'react-router-dom'

const navItems = [
  { path: '/', label: 'Dashboard', icon: '▦' },
  { path: '/leads', label: 'Leads', icon: '👥' },
  { path: '/bookings', label: 'Bookings', icon: '📅' },
  { path: '/properties', label: 'Properties', icon: '🏡' },
]

export default function Sidebar() {
  return (
    <aside style={{
      width: '240px',
      minHeight: '100vh',
      background: '#0B0F1A',
      borderRight: '1px solid #00E5FF22',
      display: 'flex',
      flexDirection: 'column',
      position: 'fixed',
      top: 0,
      left: 0,
      zIndex: 100
    }}>

      {/* Logo */}
<div style={{
  padding: '28px 24px',
  borderBottom: '1px solid #00E5FF22',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start'
}}>
  <div style={{
    fontSize: '22px',
    fontWeight: '800',
    letterSpacing: '3px',
    color: '#ffffff'
  }}>
    PROCESSIVE
  </div>
  <div style={{
    fontSize: '15px',
    color: '#00E5FF',
    letterSpacing: '1.5px',
    marginTop: '3px'
  }}>
    FOR REAL ESTATE
  </div>
</div>

      {/* Navigation */}
      <nav style={{ padding: '16px 12px', flex: 1 }}>
        {navItems.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px 16px',
              borderRadius: '10px',
              marginBottom: '4px',
              textDecoration: 'none',
              fontSize: '14px',
              fontWeight: isActive ? '600' : '400',
              color: isActive ? '#00E5FF' : '#C0C4C9',
              background: isActive ? '#00E5FF15' : 'transparent',
              borderLeft: isActive ? '3px solid #00E5FF' : '3px solid transparent',
              transition: 'all 0.2s ease'
            })}
          >
            <span style={{ fontSize: '16px' }}>{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div style={{
        padding: '16px 24px',
        borderTop: '1px solid #00E5FF22',
        fontSize: '11px',
        color: '#6b7280'
      }}>
        Processive v1.0
      </div>
    </aside>
  )
}