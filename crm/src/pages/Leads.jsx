import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import Layout from '../components/Layout'

const STATUS_CONFIG = {
  'New': { color: '#6b7280', bg: '#6b728018' },
  'Contacted': { color: '#0088ff', bg: '#0088ff18' },
  'Hot Lead': { color: '#f59e0b', bg: '#f59e0b18' },
  'Not Interested': { color: '#ef4444', bg: '#ef444418' },
  'Cancelled': { color: '#ef4444', bg: '#ef444418' },
  'Completed': { color: '#10b981', bg: '#10b98118' }
}

function StatusBadge({ status }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG['New']
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

export default function Leads({ user }) {
  const [leads, setLeads] = useState([])
  const [filtered, setFiltered] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [selectedLead, setSelectedLead] = useState(null)

  useEffect(() => { fetchLeads() }, [user])

  useEffect(() => {
    let result = leads
    if (search) {
      result = result.filter(l =>
        l.name?.toLowerCase().includes(search.toLowerCase()) ||
        l.phone?.includes(search) ||
        l.location?.toLowerCase().includes(search.toLowerCase()) ||
        l.interest?.toLowerCase().includes(search.toLowerCase())
      )
    }
    if (statusFilter !== 'All') {
      result = result.filter(l => l.status === statusFilter)
    }
    setFiltered(result)
  }, [search, statusFilter, leads])

  async function fetchLeads() {
    try {
      const { data: tenant } = await supabase
        .from('tenants')
        .select('id')
        .eq('owner_email', user.email)
        .single()

      if (!tenant) return

      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false })

      setLeads(data || [])
      setFiltered(data || [])
    } catch (error) {
      console.error('Error fetching leads:', error)
    } finally {
      setLoading(false)
    }
  }

  const statuses = ['All', 'New', 'Contacted', 'Hot Lead', 'Not Interested', 'Cancelled']

  const stats = {
    total: leads.length,
    hot: leads.filter(l => l.status === 'Hot Lead').length,
    new: leads.filter(l => l.status === 'New').length,
    contacted: leads.filter(l => l.status === 'Contacted').length
  }

  return (
    <Layout title="Leads" user={user}>

      {/* Header */}
      <div className="fade-up" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '24px',
        flexWrap: 'wrap',
        gap: '16px'
      }}>
        <div>
          <h2 style={{
            fontFamily: 'Syne, sans-serif',
            fontSize: '22px',
            fontWeight: '800',
            color: '#ffffff',
            marginBottom: '4px'
          }}>
            Leads
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            All leads captured by your WhatsApp assistant
          </p>
        </div>
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
          { label: 'New', value: stats.new, color: '#6b7280' },
          { label: 'Contacted', value: stats.contacted, color: '#0088ff' },
          { label: 'Hot Leads', value: stats.hot, color: '#f59e0b' }
        ].map(s => (
          <div key={s.label} style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-md)',
            padding: '16px 20px',
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <span style={{
              fontSize: '13px',
              color: 'var(--text-muted)'
            }}>
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
            placeholder="Search leads..."
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
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {statuses.map(status => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              style={{
                padding: '6px 14px',
                borderRadius: '20px',
                border: statusFilter === status
                  ? 'none'
                  : '1px solid var(--border)',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
                background: statusFilter === status
                  ? 'var(--accent)'
                  : 'transparent',
                color: statusFilter === status
                  ? '#0B0F1A'
                  : 'var(--text-muted)',
                transition: 'var(--transition)'
              }}
            >
              {status}
            </button>
          ))}
        </div>

        <span style={{
          fontSize: '13px',
          color: 'var(--text-muted)'
        }}>
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
            Loading leads...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{
            padding: '60px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: '14px'
          }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>👥</div>
            No leads found. Your assistant captures leads automatically when users message you.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Lead', 'Phone', 'Interest', 'Budget', 'Location', 'Size', 'Status', 'Stage', 'Date'].map(col => (
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
                {filtered.map((lead, index) => (
                  <tr
                    key={lead.id}
                    onClick={() => setSelectedLead(lead)}
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
                          {lead.name?.charAt(0)?.toUpperCase() || '?'}
                        </div>
                        <span style={{
                          fontSize: '13px',
                          fontWeight: '600',
                          color: '#ffffff',
                          whiteSpace: 'nowrap'
                        }}>
                          {lead.name || '—'}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      <span style={{
                        fontSize: '12px',
                        color: 'var(--text-muted)',
                        fontFamily: 'monospace'
                      }}>
                        {lead.phone?.replace('whatsapp:', '') || '—'}
                      </span>
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      <span style={{
                        fontSize: '12px',
                        fontWeight: '600',
                        color: '#0088ff',
                        background: '#0088ff18',
                        padding: '3px 10px',
                        borderRadius: '20px'
                      }}>
                        {lead.interest || '—'}
                      </span>
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      <span style={{
                        fontSize: '13px',
                        color: '#ffffff',
                        whiteSpace: 'nowrap'
                      }}>
                        {lead.budget
                          ? `KES ${Number(lead.budget).toLocaleString()}`
                          : '—'}
                      </span>
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      <span style={{
                        fontSize: '13px',
                        color: 'var(--text-secondary)'
                      }}>
                        {lead.location || '—'}
                      </span>
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      <span style={{
                        fontSize: '13px',
                        color: 'var(--text-secondary)'
                      }}>
                        {lead.size || '—'}
                      </span>
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      <StatusBadge status={lead.status} />
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      <span style={{
                        fontSize: '11px',
                        color: 'var(--text-muted)',
                        maxWidth: '130px',
                        display: 'block',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        {lead.conversation_stage?.replace(/_/g, ' ') || '—'}
                      </span>
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      <span style={{
                        fontSize: '12px',
                        color: 'var(--text-muted)',
                        whiteSpace: 'nowrap'
                      }}>
                        {lead.created_at
                          ? new Date(lead.created_at).toLocaleDateString('en-KE')
                          : '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Lead detail modal */}
      {selectedLead && (
        <div
          onClick={() => setSelectedLead(null)}
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
              maxWidth: '480px',
              boxShadow: '0 32px 80px rgba(0,0,0,0.5), var(--shadow-glow)',
              animation: 'fadeUp 0.3s ease'
            }}
          >
            {/* Modal header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '24px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, var(--accent-dim), #0088ff18)',
                  border: '1px solid var(--accent-border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '18px',
                  fontWeight: '800',
                  color: 'var(--accent)'
                }}>
                  {selectedLead.name?.charAt(0)?.toUpperCase() || '?'}
                </div>
                <div>
                  <h3 style={{
                    fontFamily: 'Syne, sans-serif',
                    fontSize: '18px',
                    fontWeight: '700',
                    color: '#ffffff'
                  }}>
                    {selectedLead.name || 'Unknown Lead'}
                  </h3>
                  <p style={{
                    fontSize: '13px',
                    color: 'var(--text-muted)'
                  }}>
                    {selectedLead.phone?.replace('whatsapp:', '')}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedLead(null)}
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

            {/* Lead details grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '12px',
              marginBottom: '20px'
            }}>
              {[
                { label: 'Status', value: <StatusBadge status={selectedLead.status} /> },
                { label: 'Interest', value: selectedLead.interest || '—' },
                { label: 'Budget', value: selectedLead.budget ? `KES ${Number(selectedLead.budget).toLocaleString()}` : '—' },
                { label: 'Location', value: selectedLead.location || '—' },
                { label: 'Size', value: selectedLead.size || '—' },
                { label: 'Date Added', value: selectedLead.created_at ? new Date(selectedLead.created_at).toLocaleDateString('en-KE') : '—' }
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
                    marginBottom: '6px',
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

            {/* Conversation stage */}
            <div style={{
              background: 'var(--bg-primary)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px 16px',
              border: '1px solid var(--border)'
            }}>
              <div style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
                marginBottom: '6px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                fontWeight: '600'
              }}>
                Conversation Stage
              </div>
              <div style={{
                fontSize: '13px',
                color: 'var(--accent)',
                fontWeight: '500'
              }}>
                {selectedLead.conversation_stage?.replace(/_/g, ' ') || '—'}
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </Layout>
  )
}