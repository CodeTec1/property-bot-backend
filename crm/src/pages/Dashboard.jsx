import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import Layout from '../components/Layout'
import StatCard from '../components/StatCard'

export default function Dashboard({ user }) {
  const [stats, setStats] = useState({
    totalLeads: 0,
    totalBookings: 0,
    activeBookings: 0,
    hotLeads: 0,
    totalProperties: 0,
    availableProperties: 0
  })
  const [recentLeads, setRecentLeads] = useState([])
  const [recentBookings, setRecentBookings] = useState([])
  const [loading, setLoading] = useState(true)
  const [tenantId, setTenantId] = useState(null)
  const [companyName, setCompanyName] = useState('')

  useEffect(() => {
    fetchData()
  }, [user])

  async function fetchData() {
    try {
      // Get tenant for this user
      const { data: tenant } = await supabase
        .from('tenants')
        .select('id, company_name')
        .eq('owner_email', user.email)
        .single()

      if (!tenant) return

      setTenantId(tenant.id)
      setCompanyName(tenant.company_name)

      // Fetch all stats in parallel
      const [
        leadsRes,
        bookingsRes,
        activeBookingsRes,
        hotLeadsRes,
        propertiesRes,
        availableRes,
        recentLeadsRes,
        recentBookingsRes
      ] = await Promise.all([
        supabase.from('leads').select('id', { count: 'exact' }).eq('tenant_id', tenant.id),
        supabase.from('bookings').select('id', { count: 'exact' }).eq('tenant_id', tenant.id),
        supabase.from('bookings').select('id', { count: 'exact' }).eq('tenant_id', tenant.id).eq('status', 'Scheduled'),
        supabase.from('leads').select('id', { count: 'exact' }).eq('tenant_id', tenant.id).eq('status', 'Hot Lead'),
        supabase.from('properties').select('id', { count: 'exact' }).eq('tenant_id', tenant.id),
        supabase.from('properties').select('id', { count: 'exact' }).eq('tenant_id', tenant.id).eq('available', true),
        supabase.from('leads').select('name, phone, interest, status, created_at').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(5),
        supabase.from('bookings').select('id, date, time, status, leads(name), properties(property_name)').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(5)
      ])

      setStats({
        totalLeads: leadsRes.count || 0,
        totalBookings: bookingsRes.count || 0,
        activeBookings: activeBookingsRes.count || 0,
        hotLeads: hotLeadsRes.count || 0,
        totalProperties: propertiesRes.count || 0,
        availableProperties: availableRes.count || 0
      })

      setRecentLeads(recentLeadsRes.data || [])
      setRecentBookings(recentBookingsRes.data || [])

    } catch (error) {
      console.error('Error fetching dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  function getStatusColor(status) {
    const colors = {
      'New': '#6b7280',
      'Contacted': '#00E5FF',
      'Hot Lead': '#f59e0b',
      'Not Interested': '#ef4444',
      'Scheduled': '#10b981',
      'Cancelled': '#ef4444',
      'Completed': '#6b7280'
    }
    return colors[status] || '#6b7280'
  }

  if (loading) {
    return (
      <Layout title="Dashboard">
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '400px',
          color: '#00E5FF',
          fontSize: '16px'
        }}>
          Loading dashboard...
        </div>
      </Layout>
    )
  }

  return (
    <Layout title="Dashboard">

      {/* Welcome message */}
      <div style={{ marginBottom: '32px' }}>
        <h2 style={{
          fontSize: '22px',
          fontWeight: '700',
          color: '#ffffff',
          marginBottom: '4px'
        }}>
          Welcome back, {companyName} 👋
        </h2>
        <p style={{ fontSize: '14px', color: '#9ca3af' }}>
          Here is what is happening with your assistant today.
        </p>
      </div>

      {/* Stats grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '20px',
        marginBottom: '40px'
      }}>
        <StatCard
          title="Total Leads"
          value={stats.totalLeads}
          icon="👥"
          color="#00E5FF"
          subtitle="All time captures"
        />
        <StatCard
          title="Hot Leads"
          value={stats.hotLeads}
          icon="🔥"
          color="#f59e0b"
          subtitle="Interested after viewing"
        />
        <StatCard
          title="Active Bookings"
          value={stats.activeBookings}
          icon="📅"
          color="#10b981"
          subtitle="Scheduled viewings"
        />
        <StatCard
          title="Total Bookings"
          value={stats.totalBookings}
          icon="✅"
          color="#00E5FF"
          subtitle="All time bookings"
        />
        <StatCard
          title="Properties"
          value={stats.availableProperties}
          icon="🏡"
          color="#8b5cf6"
          subtitle={`${stats.availableProperties} of ${stats.totalProperties} available`}
        />
      </div>

      {/* Recent activity */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '24px'
      }}>

        {/* Recent Leads */}
        <div style={{
          background: '#ffffff',
          borderRadius: '16px',
          padding: '24px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.15)'
        }}>
          <h3 style={{
            fontSize: '15px',
            fontWeight: '700',
            color: '#0B0F1A',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            👥 Recent Leads
          </h3>

          {recentLeads.length === 0 ? (
            <p style={{ color: '#9ca3af', fontSize: '13px' }}>No leads yet.</p>
          ) : (
            recentLeads.map((lead, index) => (
              <div key={index} style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 0',
                borderBottom: index < recentLeads.length - 1 ? '1px solid #f3f4f6' : 'none'
              }}>
                <div>
                  <div style={{
                    fontSize: '13px',
                    fontWeight: '600',
                    color: '#0B0F1A'
                  }}>
                    {lead.name || 'Unknown'}
                  </div>
                  <div style={{
                    fontSize: '11px',
                    color: '#9ca3af',
                    marginTop: '2px'
                  }}>
                    {lead.interest} • {new Date(lead.created_at).toLocaleDateString('en-KE')}
                  </div>
                </div>
                <span style={{
                  fontSize: '11px',
                  fontWeight: '600',
                  color: getStatusColor(lead.status),
                  background: `${getStatusColor(lead.status)}18`,
                  padding: '3px 10px',
                  borderRadius: '20px'
                }}>
                  {lead.status}
                </span>
              </div>
            ))
          )}
        </div>

        {/* Recent Bookings */}
        <div style={{
          background: '#ffffff',
          borderRadius: '16px',
          padding: '24px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.15)'
        }}>
          <h3 style={{
            fontSize: '15px',
            fontWeight: '700',
            color: '#0B0F1A',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            📅 Recent Bookings
          </h3>

          {recentBookings.length === 0 ? (
            <p style={{ color: '#9ca3af', fontSize: '13px' }}>No bookings yet.</p>
          ) : (
            recentBookings.map((booking, index) => (
              <div key={index} style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 0',
                borderBottom: index < recentBookings.length - 1 ? '1px solid #f3f4f6' : 'none'
              }}>
                <div>
                  <div style={{
                    fontSize: '13px',
                    fontWeight: '600',
                    color: '#0B0F1A'
                  }}>
                    {booking.properties?.property_name || 'Unknown'}
                  </div>
                  <div style={{
                    fontSize: '11px',
                    color: '#9ca3af',
                    marginTop: '2px'
                  }}>
                    {booking.leads?.name} • {booking.date} {booking.time}
                  </div>
                </div>
                <span style={{
                  fontSize: '11px',
                  fontWeight: '600',
                  color: getStatusColor(booking.status),
                  background: `${getStatusColor(booking.status)}18`,
                  padding: '3px 10px',
                  borderRadius: '20px'
                }}>
                  {booking.status}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </Layout>
  )
}