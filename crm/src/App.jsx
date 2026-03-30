import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './supabase'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Leads from './pages/Leads'
import Bookings from './pages/Bookings'
import Properties from './pages/Properties'

export default function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#0B0F1A',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: '12px'
      }}>
        <div style={{
          fontSize: '20px',
          fontWeight: '800',
          letterSpacing: '3px',
          color: '#ffffff'
        }}>
          PROCESSIVE
        </div>
        <div style={{
          fontSize: '11px',
          color: '#00E5FF',
          letterSpacing: '2px'
        }}>
          FOR REAL ESTATE
        </div>
        <div style={{
          marginTop: '16px',
          width: '32px',
          height: '32px',
          border: '3px solid #00E5FF33',
          borderTop: '3px solid #00E5FF',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }} />
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={user ? <Navigate to="/" replace /> : <Login />}
        />
        <Route
          path="/"
          element={user ? <Dashboard user={user} /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/leads"
          element={user ? <Leads user={user} /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/bookings"
          element={user ? <Bookings user={user} /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/properties"
          element={user ? <Properties user={user} /> : <Navigate to="/login" replace />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}