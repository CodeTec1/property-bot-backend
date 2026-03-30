import Sidebar from './Sidebar'
import Navbar from './Navbar'

export default function Layout({ children, title }) {
  return (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      background: '#111827'
    }}>
      {/* Sidebar */}
      <Sidebar />

      {/* Main content */}
      <div style={{
        marginLeft: '240px',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh'
      }}>
        <Navbar title={title} />

        {/* Page content */}
        <main style={{
          flex: 1,
          padding: '32px',
          background: '#111827'
        }}>
          {children}
        </main>
      </div>
    </div>
  )
}