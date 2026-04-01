import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import Layout from '../components/Layout'
import StatCard from '../components/StatCard'
import { useNavigate } from 'react-router-dom'

export default function Dashboard({ user }) {
  const [stats, setStats] = useState({
    totalLeads: 0,
    hotLeads: 0,
    activeBookings: 0,
    totalBookings: 0,
    availableProperties: 0,
    totalProperties: 0
  })
  const [recentLeads, setRecentLeads] = useState([])
  const [recentBookings, setRecentBookings] = useState([])
  const [loading, setLoading] = useState(true)
  const [companyName, setCompanyName] = useState('')
  const [tenantId, setTenantId] = useState(null)
  const navigate = useNavigate()

  useEffect(() => { fetchData() }, [user])

  async function fetchData() {
    try {
      const { data: tenant } = await supabase
        .from('tenants')
        .select('id, company_name')
        .eq('owner_email', user.email)
        .single()

      if (!tenant) return
      setTenantId(tenant.id)
      setCompanyName(tenant.company_name)

      const [
        leadsRes, hotRes, bookingsRes,
        activeRes, propsRes, availRes,
        recentLeadsRes, recentBookingsRes
      ] = await Promise.all([
        supabase.from('leads').select('id', { count: 'exact' }).eq('tenant_id', tenant.id),
        supabase.from('leads').select('id', { count: 'exact' }).eq('tenant_id', tenant.id).eq('status', 'Hot Lead'),
        supabase.from('bookings').select('id', { count: 'exact' }).eq('tenant_id', tenant.id),
        supabase.from('bookings').select('id', { count: 'exact' }).eq('tenant_id', tenant.id).eq('status', 'Scheduled'),
        supabase.from('properties').select('id', { count: 'exact' }).eq('tenant_id', tenant.id),
        supabase.from('properties').select('id', { count: 'exact' }).eq('tenant_id', tenant.id).eq('available', true),
        supabase.from('leads').select('id, name, phone, interest, status, conversation_stage, created_at').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(6),
        supabase.from('bookings').select('id, date, time, status, agent_name, leads(name), properties(property_name)').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(6)
      ])

      setStats({
        totalLeads: leadsRes.count || 0,
        hotLeads: hotRes.count || 0,
        activeBookings: activeRes.count || 0,
        totalBookings: bookingsRes.count || 0,
        totalProperties: propsRes.count || 0,
        availableProperties: availRes.count || 0
      })

      setRecentLeads(recentLeadsRes.data || [])
      setRecentBookings(recentBookingsRes.data || [])
    } catch (error) {
      console.error('Error:', error)
    } finally {
      setLoading(false)
    }
  }

  const statusConfig = {
    'New': { color: '#6b7280', bg: '#6b728018' },
    'Contacted': { color: '#0088ff', bg: '#0088ff18' },
    'Hot Lead': { color: '#f59e0b', bg: '#f59e0b18' },
    'Not Interested': { color: '#ef4444', bg: '#ef444418' },
    'Cancelled': { color: '#ef4444', bg: '#ef444418' },
    'Scheduled': { color: '#10b981', bg: '#10b98118' },
    'Completed': { color: '#6b7280', bg: '#6b728018' }
  }

  function StatusBadge({ status }) {
    const config = statusConfig[status] || statusConfig['New']
    return (
      <span style={{
        fontSize: '11px',
        fontWeight: '600',
        color: config.color,
        background: config.bg,
        padding: '3px 10px',
        borderRadius: '20px',
        whiteSpace: 'nowrap'
      }}>
        {status || 'New'}
      </span>
    )
  }

  if (loading) {
    return (
      <Layout title="Dashboard" user={user}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '400px',
          flexDirection: 'column',
          gap: '16px'
        }}>
          <div style={{
            width: '36px',
            height: '36px',
            border: '3px solid var(--accent-border)',
            borderTop: '3px solid var(--accent)',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite'
          }} />
          <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
            Loading dashboard...
          </span>
        </div>
      </Layout>
    )
  }

  return (
    <Layout title="Dashboard" user={user}>

      {/* Welcome header */}
      <div className="fade-up" style={{ marginBottom: '28px' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '16px'
        }}>
          <div>
            <h2 style={{
              fontFamily: 'Syne, sans-serif',
              fontSize: '24px',
              fontWeight: '800',
              color: '#ffffff',
              marginBottom: '4px'
            }}>
              Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, {companyName} 👋
            </h2>
            <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
              Here is your real estate assistant overview for today.
            </p>
          </div>

          {/* Quick action buttons */}
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => navigate('/properties')}
              className="glow-btn"
              style={{
                padding: '10px 20px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--accent-border)',
                background: 'var(--accent-dim)',
                color: 'var(--accent)',
                fontSize: '13px',
                fontWeight: '600',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Add Property
            </button>
            <button
              onClick={() => navigate('/leads')}
              style={{
                padding: '10px 20px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--text-secondary)',
                fontSize: '13px',
                fontWeight: '600',
                transition: 'var(--transition)'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'var(--accent-border)'
                e.currentTarget.style.color = '#ffffff'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--border)'
                e.currentTarget.style.color = 'var(--text-secondary)'
              }}
            >
              View Leads
            </button>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '16px',
        marginBottom: '28px'
      }}>
        <StatCard
          title="Total Leads"
          value={stats.totalLeads}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0088ff" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          }
          color="#0088ff"
          subtitle="All time captures"
        />
        <StatCard
          title="Hot Leads"
          value={stats.hotLeads}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
              <path d="M12 6v6l4 2"/>
            </svg>
          }
          color="#f59e0b"
          subtitle="Interested after viewing"
        />
        <StatCard
          title="Scheduled"
          value={stats.activeBookings}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
          }
          color="#10b981"
          subtitle="Upcoming viewings"
        />
        <StatCard
          title="Total Bookings"
          value={stats.totalBookings}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00E5FF" strokeWidth="2">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          }
          color="#00E5FF"
          subtitle="All time bookings"
        />
        <StatCard
          title="Properties"
          value={stats.availableProperties}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          }
          color="#8b5cf6"
          subtitle={`of ${stats.totalProperties} total`}
        />
      </div>

      {/* Recent activity */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '20px'
      }}>

        {/* Recent Leads */}
        <div className="fade-up fade-up-2" style={{
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)',
          overflow: 'hidden'
        }}>
          <div style={{
            padding: '20px 24px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <h3 style={{
              fontFamily: 'Syne, sans-serif',
              fontSize: '15px',
              fontWeight: '700',
              color: '#ffffff'
            }}>
              Recent Leads
            </h3>
            <button
              onClick={() => navigate('/leads')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent)',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              View all →
            </button>
          </div>

          <div style={{ padding: '8px 0' }}>
            {recentLeads.length === 0 ? (
              <div style={{
                padding: '40px 24px',
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: '13px'
              }}>
                No leads yet. Your assistant will capture them automatically.
              </div>
            ) : recentLeads.map((lead, i) => (
              <div
                key={lead.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 24px',
                  transition: 'var(--transition)',
                  cursor: 'default'
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-dim)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px'
                }}>
                  <div style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #00E5FF22, #0088ff22)',
                    border: '1px solid var(--accent-border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '13px',
                    fontWeight: '700',
                    color: 'var(--accent)',
                    flexShrink: 0
                  }}>
                    {lead.name?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                  <div>
                    <div style={{
                      fontSize: '13px',
                      fontWeight: '600',
                      color: '#ffffff',
                      marginBottom: '2px'
                    }}>
                      {lead.name || 'Unknown'}
                    </div>
                    <div style={{
                      fontSize: '11px',
                      color: 'var(--text-muted)'
                    }}>
                      {lead.interest} • {new Date(lead.created_at).toLocaleDateString('en-KE')}
                    </div>
                  </div>
                </div>
                <StatusBadge status={lead.status} />
              </div>
            ))}
          </div>
        </div>

        {/* Recent Bookings */}
        <div className="fade-up fade-up-3" style={{
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)',
          overflow: 'hidden'
        }}>
          <div style={{
            padding: '20px 24px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <h3 style={{
              fontFamily: 'Syne, sans-serif',
              fontSize: '15px',
              fontWeight: '700',
              color: '#ffffff'
            }}>
              Recent Bookings
            </h3>
            <button
              onClick={() => navigate('/bookings')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent)',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              View all →
            </button>
          </div>

          <div style={{ padding: '8px 0' }}>
            {recentBookings.length === 0 ? (
              <div style={{
                padding: '40px 24px',
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: '13px'
              }}>
                No bookings yet. They will appear here automatically.
              </div>
            ) : recentBookings.map((booking, i) => (
              <div
                key={booking.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 24px',
                  transition: 'var(--transition)',
                  cursor: 'default'
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-dim)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px'
                }}>
                  <div style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: 'var(--radius-sm)',
                    background: '#10b98118',
                    border: '1px solid #10b98133',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2">
                      <rect x="3" y="4" width="18" height="18" rx="2"/>
                      <line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                  </div>
                  <div>
                    <div style={{
                      fontSize: '13px',
                      fontWeight: '600',
                      color: '#ffffff',
                      marginBottom: '2px'
                    }}>
                      {booking.properties?.property_name || 'Unknown Property'}
                    </div>
                    <div style={{
                      fontSize: '11px',
                      color: 'var(--text-muted)'
                    }}>
                      {booking.leads?.name} • {booking.date} {booking.time}
                    </div>
                  </div>
                </div>
                <StatusBadge status={booking.status} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  )
}