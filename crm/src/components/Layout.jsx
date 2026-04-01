import { useState } from 'react'
import Sidebar from './Sidebar'
import Navbar from './Navbar'

export default function Layout({ children, title, user }) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      background: 'var(--bg-primary)'
    }}>
      {/* Sidebar */}
      <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />

      {/* Main content */}
      <div style={{
        marginLeft: collapsed ? '72px' : '240px',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        transition: 'margin-left 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
      }}>
        <Navbar title={title} user={user} />

        {/* Page content */}
        <main style={{
          flex: 1,
          padding: '28px 32px',
          background: 'var(--bg-primary)',
          animation: 'fadeIn 0.3s ease'
        }}>
          {children}
        </main>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}