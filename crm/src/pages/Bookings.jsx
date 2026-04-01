import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import Layout from '../components/Layout'

const STATUS_CONFIG = {
  'Scheduled': { color: '#10b981', bg: '#10b98118' },
  'Cancelled': { color: '#ef4444', bg: '#ef444418' },
  'Completed': { color: '#6b7280', bg: '#6b728018' }
}

function StatusBadge({ status }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG['Scheduled']
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
      {status || 'Scheduled'}
    </span>
  )
}

export default function Bookings({ user }) {
  const [bookings, setBookings] = useState([])
  const [filtered, setFiltered] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [selectedBooking, setSelectedBooking] = useState(null)

  useEffect(() => { fetchBookings() }, [user])

  useEffect(() => {
    let result = bookings
    if (search) {
      result = result.filter(b =>
        b.properties?.property_name?.toLowerCase().includes(search.toLowerCase()) ||
        b.leads?.name?.toLowerCase().includes(search.toLowerCase()) ||
        b.agent_name?.toLowerCase().includes(search.toLowerCase())
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
          leads (name, phone, interest, budget),
          properties (property_name, location, address, price)
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

  const stats = {
    total: bookings.length,
    scheduled: bookings.filter(b => b.status === 'Scheduled').length,
    completed: bookings.filter(b => b.status === 'Completed').length,
    cancelled: bookings.filter(b => b.status === 'Cancelled').length
  }

  return (
    <Layout title="Bookings" user={user}>

      {/* Header */}
      <div className="fade-up" style={{
        marginBottom: '24px'
      }}>
        <h2 style={{
          fontFamily: 'Syne, sans-serif',
          fontSize: '22px',
          fontWeight: '800',
          color: '#ffffff',
          marginBottom: '4px'
        }}>
          Bookings
        </h2>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          All property viewing appointments
        </p>
      </div>

      {/* Mini stats */}
      <div className="fade-up fade-up-1" style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '12px',
        marginBottom: '24px'
      }}>
        {[
          { label: 'Total', value: stats.total, color: '#00E5FF' },
          { label: 'Scheduled', value: stats.scheduled, color: '#10b981' },
          { label: 'Completed', value: stats.completed, color: '#6b7280' },
          { label: 'Cancelled', value: stats.cancelled, color: '#ef4444' }
        ].map(s => (
          <div key={s.label} style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-md)',
            padding: '16px 20px',
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            transition: 'var(--transition)'
          }}
          onMouseEnter={e => e.currentTarget.style.borderColor = s.color + '44'}
          onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
          >
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              {s.label}
            </span>
            <span style={{
              fontFamily: 'Syne, sans-serif',
              fontSize: '22px',
              fontWeight: '800',
              color: s.color
            }}>
              {s.value}
            </span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="fade-up fade-up-2" style={{
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-md)',
        padding: '16px 20px',
        border: '1px solid var(--border)',
        marginBottom: '16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px'
      }}>
        {/* Search */}
        <div style={{ position: 'relative' }}>
          <svg
            width="14" height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--text-muted)"
            strokeWidth="2"
            style={{
              position: 'absolute',
              left: '12px',
              top: '50%',
              transform: 'translateY(-50%)'
            }}
          >
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            placeholder="Search bookings..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              padding: '9px 16px 9px 36px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              background: 'var(--bg-primary)',
              color: '#ffffff',
              fontSize: '13px',
              width: '240px',
              outline: 'none',
              transition: 'var(--transition)'
            }}
            onFocus={e => e.target.style.borderColor = 'var(--accent)'}
            onBlur={e => e.target.style.borderColor = 'var(--border)'}
          />
        </div>

        {/* Status filters */}
        <div style={{ display: 'flex', gap: '6px' }}>
          {statuses.map(status => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              style={{
                padding: '6px 14px',
                borderRadius: '20px',
                border: statusFilter === status ? 'none' : '1px solid var(--border)',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
                background: statusFilter === status ? 'var(--accent)' : 'transparent',
                color: statusFilter === status ? '#0B0F1A' : 'var(--text-muted)',
                transition: 'var(--transition)'
              }}
            >
              {status}
            </button>
          ))}
        </div>

        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          {filtered.length} results
        </span>
      </div>

      {/* Table */}
      <div className="fade-up fade-up-3" style={{
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)',
        overflow: 'hidden'
      }}>
        {loading ? (
          <div style={{
            padding: '60px',
            textAlign: 'center',
            color: 'var(--text-muted)'
          }}>
            <div style={{
              width: '32px',
              height: '32px',
              border: '3px solid var(--accent-border)',
              borderTop: '3px solid var(--accent)',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 12px'
            }} />
            Loading bookings...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{
            padding: '60px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: '14px'
          }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>📅</div>
            No bookings found.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Property', 'Client', 'Date & Time', 'Agent', 'Status'].map(col => (
                    <th key={col} style={{
                      padding: '12px 20px',
                      textAlign: 'left',
                      fontSize: '11px',
                      fontWeight: '700',
                      color: 'var(--text-muted)',
                      letterSpacing: '0.8px',
                      textTransform: 'uppercase',
                      whiteSpace: 'nowrap',
                      background: 'var(--bg-secondary)'
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
                    onClick={() => setSelectedBooking(booking)}
                    style={{
                      borderBottom: index < filtered.length - 1
                        ? '1px solid var(--border)'
                        : 'none',
                      transition: 'var(--transition)',
                      cursor: 'pointer'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-dim)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '14px 20px' }}>
                      <div style={{
                        fontSize: '13px',
                        fontWeight: '600',
                        color: '#ffffff',
                        marginBottom: '2px'
                      }}>
                        {booking.properties?.property_name || '—'}
                      </div>
                      <div style={{
                        fontSize: '11px',
                        color: 'var(--text-muted)'
                      }}>
                        {booking.properties?.location || ''}
                      </div>
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px'
                      }}>
                        <div style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '50%',
                          background: 'linear-gradient(135deg, var(--accent-dim), #0088ff18)',
                          border: '1px solid var(--accent-border)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '12px',
                          fontWeight: '700',
                          color: 'var(--accent)',
                          flexShrink: 0
                        }}>
                          {booking.leads?.name?.charAt(0)?.toUpperCase() || '?'}
                        </div>
                        <div>
                          <div style={{
                            fontSize: '13px',
                            fontWeight: '600',
                            color: '#ffffff'
                          }}>
                            {booking.leads?.name || '—'}
                          </div>
                          <div style={{
                            fontSize: '11px',
                            color: 'var(--text-muted)'
                          }}>
                            {booking.leads?.phone?.replace('whatsapp:', '') || ''}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      <div style={{
                        fontSize: '13px',
                        fontWeight: '600',
                        color: '#ffffff',
                        marginBottom: '2px'
                      }}>
                        {booking.date || '—'}
                      </div>
                      <div style={{
                        fontSize: '12px',
                        color: 'var(--accent)',
                        fontWeight: '600'
                      }}>
                        {booking.time || '—'}
                      </div>
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      <span style={{
                        fontSize: '13px',
                        color: 'var(--text-secondary)'
                      }}>
                        {booking.agent_name || '—'}
                      </span>
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      <StatusBadge status={booking.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Booking detail modal */}
      {selectedBooking && (
        <div
          onClick={() => setSelectedBooking(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(4px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            animation: 'fadeIn 0.2s ease'
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-xl)',
              border: '1px solid var(--accent-border)',
              padding: '32px',
              width: '100%',
              maxWidth: '520px',
              boxShadow: '0 32px 80px rgba(0,0,0,0.5), var(--shadow-glow)',
              animation: 'fadeUp 0.3s ease'
            }}
          >
            {/* Modal header */}
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              marginBottom: '24px'
            }}>
              <div>
                <h3 style={{
                  fontFamily: 'Syne, sans-serif',
                  fontSize: '18px',
                  fontWeight: '700',
                  color: '#ffffff',
                  marginBottom: '4px'
                }}>
                  Booking Details
                </h3>
                <StatusBadge status={selectedBooking.status} />
              </div>
              <button
                onClick={() => setSelectedBooking(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: '20px',
                  cursor: 'pointer',
                  padding: '4px',
                  lineHeight: 1
                }}
              >
                ×
              </button>
            </div>

            {/* Property section */}
            <div style={{
              background: 'var(--bg-primary)',
              borderRadius: 'var(--radius-md)',
              padding: '16px',
              border: '1px solid var(--border)',
              marginBottom: '16px'
            }}>
              <div style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.8px',
                fontWeight: '700',
                marginBottom: '10px'
              }}>
                Property
              </div>
              <div style={{
                fontSize: '16px',
                fontWeight: '700',
                color: '#ffffff',
                marginBottom: '4px'
              }}>
                {selectedBooking.properties?.property_name || '—'}
              </div>
              <div style={{
                fontSize: '13px',
                color: 'var(--text-muted)'
              }}>
                📍 {selectedBooking.properties?.address || '—'}
              </div>
              {selectedBooking.properties?.price && (
                <div style={{
                  fontSize: '14px',
                  fontWeight: '700',
                  color: 'var(--accent)',
                  marginTop: '8px'
                }}>
                  KES {Number(selectedBooking.properties.price).toLocaleString()}
                </div>
              )}
            </div>

            {/* Details grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '12px',
              marginBottom: '16px'
            }}>
              {[
                { label: 'Client', value: selectedBooking.leads?.name || '—' },
                { label: 'Phone', value: selectedBooking.leads?.phone?.replace('whatsapp:', '') || '—' },
                { label: 'Date', value: selectedBooking.date || '—' },
                { label: 'Time', value: selectedBooking.time || '—' },
                { label: 'Agent', value: selectedBooking.agent_name || '—' },
                { label: 'Agent Phone', value: selectedBooking.agent_phone || '—' }
              ].map(item => (
                <div key={item.label} style={{
                  background: 'var(--bg-primary)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '12px 16px',
                  border: '1px solid var(--border)'
                }}>
                  <div style={{
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    marginBottom: '4px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    fontWeight: '600'
                  }}>
                    {item.label}
                  </div>
                  <div style={{
                    fontSize: '13px',
                    color: '#ffffff',
                    fontWeight: '500'
                  }}>
                    {item.value}
                  </div>
                </div>
              ))}
            </div>

            {/* Client interest and budget */}
            {(selectedBooking.leads?.interest || selectedBooking.leads?.budget) && (
              <div style={{
                background: 'var(--accent-dim)',
                borderRadius: 'var(--radius-sm)',
                padding: '12px 16px',
                border: '1px solid var(--accent-border)',
                display: 'flex',
                gap: '20px'
              }}>
                {selectedBooking.leads?.interest && (
                  <div>
                    <div style={{
                      fontSize: '11px',
                      color: 'var(--accent)',
                      fontWeight: '700',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: '2px'
                    }}>
                      Interest
                    </div>
                    <div style={{
                      fontSize: '13px',
                      color: '#ffffff'
                    }}>
                      {selectedBooking.leads.interest}
                    </div>
                  </div>
                )}
                {selectedBooking.leads?.budget && (
                  <div>
                    <div style={{
                      fontSize: '11px',
                      color: 'var(--accent)',
                      fontWeight: '700',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: '2px'
                    }}>
                      Budget
                    </div>
                    <div style={{
                      fontSize: '13px',
                      color: '#ffffff'
                    }}>
                      KES {Number(selectedBooking.leads.budget).toLocaleString()}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </Layout>
  )
}