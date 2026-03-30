import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import Layout from '../components/Layout'

const STATUS_COLORS = {
  'Scheduled': { bg: '#d1fae5', text: '#10b981' },
  'Cancelled': { bg: '#fee2e2', text: '#ef4444' },
  'Completed': { bg: '#f3f4f6', text: '#6b7280' }
}

export default function Bookings({ user }) {
  const [bookings, setBookings] = useState([])
  const [filtered, setFiltered] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')

  useEffect(() => { fetchBookings() }, [user])

  useEffect(() => {
    let result = bookings
    if (search) {
      result = result.filter(b =>
        b.properties?.property_name?.toLowerCase().includes(search.toLowerCase()) ||
        b.leads?.name?.toLowerCase().includes(search.toLowerCase())
      )
    }
    if (statusFilter !== 'All') {
      result = result.filter(b => b.status === statusFilter)
    }
    setFiltered(result)
  }, [search, statusFilter, bookings])

  async function fetchBookings() {
    try {
      const { data: tenant } = await supabase
        .from('tenants')
        .select('id')
        .eq('owner_email', user.email)
        .single()

      if (!tenant) return

      const { data } = await supabase
        .from('bookings')
        .select(`
          *,
          leads (name, phone),
          properties (property_name, location, address)
        `)
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false })

      setBookings(data || [])
      setFiltered(data || [])
    } catch (error) {
      console.error('Error fetching bookings:', error)
    } finally {
      setLoading(false)
    }
  }

  const statuses = ['All', 'Scheduled', 'Cancelled', 'Completed']

  return (
    <Layout title="Bookings">

      {/* Header row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '24px',
        flexWrap: 'wrap',
        gap: '16px'
      }}>
        <div>
          <h2 style={{
            fontSize: '20px',
            fontWeight: '700',
            color: '#ffffff',
            marginBottom: '4px'
          }}>
            All Bookings
          </h2>
          <p style={{ fontSize: '13px', color: '#9ca3af' }}>
            {filtered.length} bookings found
          </p>
        </div>

        <input
          type="text"
          placeholder="Search by property or client..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            padding: '10px 16px',
            borderRadius: '10px',
            border: '1.5px solid #00E5FF33',
            background: '#0B0F1A',
            color: '#ffffff',
            fontSize: '13px',
            width: '280px',
            outline: 'none'
          }}
        />
      </div>

      {/* Status filters */}
      <div style={{
        display: 'flex',
        gap: '8px',
        marginBottom: '24px',
        flexWrap: 'wrap'
      }}>
        {statuses.map(status => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            style={{
              padding: '6px 16px',
              borderRadius: '20px',
              border: statusFilter === status ? 'none' : '1px solid #00E5FF33',
              fontSize: '12px',
              fontWeight: '600',
              cursor: 'pointer',
              background: statusFilter === status ? '#00E5FF' : '#0B0F1A',
              color: statusFilter === status ? '#0B0F1A' : '#9ca3af',
              transition: 'all 0.2s'
            }}
          >
            {status}
          </button>
        ))}
      </div>

      {/* Table */}
      <div style={{
        background: '#ffffff',
        borderRadius: '16px',
        overflow: 'hidden',
        boxShadow: '0 4px 24px rgba(0,0,0,0.15)'
      }}>
        {loading ? (
          <div style={{
            padding: '60px',
            textAlign: 'center',
            color: '#9ca3af'
          }}>
            Loading bookings...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{
            padding: '60px',
            textAlign: 'center',
            color: '#9ca3af'
          }}>
            No bookings found.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                {['Property', 'Client', 'Phone', 'Date', 'Time', 'Agent', 'Status', 'Reminders'].map(col => (
                  <th key={col} style={{
                    padding: '14px 20px',
                    textAlign: 'left',
                    fontSize: '11px',
                    fontWeight: '700',
                    color: '#6b7280',
                    letterSpacing: '0.5px',
                    textTransform: 'uppercase',
                    borderBottom: '1px solid #f3f4f6'
                  }}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((booking, index) => (
                <tr
                  key={booking.id}
                  style={{
                    borderBottom: index < filtered.length - 1 ? '1px solid #f3f4f6' : 'none',
                    transition: 'background 0.15s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ padding: '16px 20px' }}>
                    <div style={{
                      fontSize: '13px',
                      fontWeight: '600',
                      color: '#0B0F1A'
                    }}>
                      {booking.properties?.property_name || '—'}
                    </div>
                    <div style={{
                      fontSize: '11px',
                      color: '#9ca3af',
                      marginTop: '2px'
                    }}>
                      {booking.properties?.location || ''}
                    </div>
                  </td>
                  <td style={{ padding: '16px 20px' }}>
                    <div style={{
                      fontSize: '13px',
                      fontWeight: '600',
                      color: '#0B0F1A'
                    }}>
                      {booking.leads?.name || '—'}
                    </div>
                  </td>
                  <td style={{ padding: '16px 20px' }}>
                    <div style={{
                      fontSize: '12px',
                      color: '#6b7280',
                      fontFamily: 'monospace'
                    }}>
                      {booking.leads?.phone?.replace('whatsapp:', '') || '—'}
                    </div>
                  </td>
                  <td style={{ padding: '16px 20px' }}>
                    <div style={{ fontSize: '13px', color: '#0B0F1A' }}>
                      {booking.date || '—'}
                    </div>
                  </td>
                  <td style={{ padding: '16px 20px' }}>
                    <div style={{
                      fontSize: '13px',
                      color: '#0B0F1A',
                      fontWeight: '600'
                    }}>
                      {booking.time || '—'}
                    </div>
                  </td>
                  <td style={{ padding: '16px 20px' }}>
                    <div style={{ fontSize: '13px', color: '#6b7280' }}>
                      {booking.agent_name || '—'}
                    </div>
                  </td>
                  <td style={{ padding: '16px 20px' }}>
                    <span style={{
                      fontSize: '11px',
                      fontWeight: '600',
                      color: STATUS_COLORS[booking.status]?.text || '#6b7280',
                      background: STATUS_COLORS[booking.status]?.bg || '#f3f4f6',
                      padding: '3px 10px',
                      borderRadius: '20px'
                    }}>
                      {booking.status || '—'}
                    </span>
                  </td>
                  <td style={{ padding: '16px 20px' }}>
                    <div style={{
                      display: 'flex',
                      gap: '6px',
                      alignItems: 'center'
                    }}>
                      <span style={{
                        fontSize: '10px',
                        padding: '2px 8px',
                        borderRadius: '10px',
                        background: booking.reminder_12h_sent ? '#d1fae5' : '#f3f4f6',
                        color: booking.reminder_12h_sent ? '#10b981' : '#9ca3af',
                        fontWeight: '600'
                      }}>
                        12h
                      </span>
                      <span style={{
                        fontSize: '10px',
                        padding: '2px 8px',
                        borderRadius: '10px',
                        background: booking.reminder_1h_sent ? '#d1fae5' : '#f3f4f6',
                        color: booking.reminder_1h_sent ? '#10b981' : '#9ca3af',
                        fontWeight: '600'
                      }}>
                        1h
                      </span>
                      <span style={{
                        fontSize: '10px',
                        padding: '2px 8px',
                        borderRadius: '10px',
                        background: booking.followup_sent ? '#d1fae5' : '#f3f4f6',
                        color: booking.followup_sent ? '#10b981' : '#9ca3af',
                        fontWeight: '600'
                      }}>
                        FU
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  )
}