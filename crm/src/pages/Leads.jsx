import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import Layout from '../components/Layout'

const STATUS_COLORS = {
  'New': { bg: '#f3f4f6', text: '#6b7280' },
  'Contacted': { bg: '#dbeafe', text: '#00E5FF' },
  'Hot Lead': { bg: '#fef3c7', text: '#f59e0b' },
  'Not Interested': { bg: '#fee2e2', text: '#ef4444' },
  'Cancelled': { bg: '#fee2e2', text: '#ef4444' },
  'Completed': { bg: '#d1fae5', text: '#10b981' }
}

export default function Leads({ user }) {
  const [leads, setLeads] = useState([])
  const [filtered, setFiltered] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [tenantId, setTenantId] = useState(null)

  useEffect(() => { fetchLeads() }, [user])

  useEffect(() => {
    let result = leads
    if (search) {
      result = result.filter(l =>
        l.name?.toLowerCase().includes(search.toLowerCase()) ||
        l.phone?.includes(search) ||
        l.location?.toLowerCase().includes(search.toLowerCase())
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
      setTenantId(tenant.id)

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

  return (
    <Layout title="Leads">

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
            All Leads
          </h2>
          <p style={{ fontSize: '13px', color: '#9ca3af' }}>
            {filtered.length} leads found
          </p>
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search by name, phone or location..."
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
              border: 'none',
              fontSize: '12px',
              fontWeight: '600',
              cursor: 'pointer',
              background: statusFilter === status ? '#00E5FF' : '#0B0F1A',
              color: statusFilter === status ? '#0B0F1A' : '#9ca3af',
              border: statusFilter === status ? 'none' : '1px solid #00E5FF33',
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
            Loading leads...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{
            padding: '60px',
            textAlign: 'center',
            color: '#9ca3af'
          }}>
            No leads found.
          </div>
        ) : (
          <table style={{
            width: '100%',
            borderCollapse: 'collapse'
          }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                {['Name', 'Phone', 'Interest', 'Budget', 'Location', 'Status', 'Stage', 'Date'].map(col => (
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
              {filtered.map((lead, index) => (
                <tr
                  key={lead.id}
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
                      {lead.name || '—'}
                    </div>
                  </td>
                  <td style={{ padding: '16px 20px' }}>
                    <div style={{
                      fontSize: '13px',
                      color: '#6b7280',
                      fontFamily: 'monospace'
                    }}>
                      {lead.phone?.replace('whatsapp:', '') || '—'}
                    </div>
                  </td>
                  <td style={{ padding: '16px 20px' }}>
                    <span style={{
                      fontSize: '12px',
                      fontWeight: '600',
                      color: '#00E5FF',
                      background: '#dbeafe',
                      padding: '3px 10px',
                      borderRadius: '20px'
                    }}>
                      {lead.interest || '—'}
                    </span>
                  </td>
                  <td style={{ padding: '16px 20px' }}>
                    <div style={{ fontSize: '13px', color: '#0B0F1A' }}>
                      {lead.budget ? `KES ${Number(lead.budget).toLocaleString()}` : '—'}
                    </div>
                  </td>
                  <td style={{ padding: '16px 20px' }}>
                    <div style={{ fontSize: '13px', color: '#6b7280' }}>
                      {lead.location || '—'}
                    </div>
                  </td>
                  <td style={{ padding: '16px 20px' }}>
                    <span style={{
                      fontSize: '11px',
                      fontWeight: '600',
                      color: STATUS_COLORS[lead.status]?.text || '#6b7280',
                      background: STATUS_COLORS[lead.status]?.bg || '#f3f4f6',
                      padding: '3px 10px',
                      borderRadius: '20px'
                    }}>
                      {lead.status || 'New'}
                    </span>
                  </td>
                  <td style={{ padding: '16px 20px' }}>
                    <div style={{
                      fontSize: '11px',
                      color: '#9ca3af',
                      maxWidth: '140px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {lead.conversation_stage?.replace(/_/g, ' ') || '—'}
                    </div>
                  </td>
                  <td style={{ padding: '16px 20px' }}>
                    <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                      {lead.created_at
                        ? new Date(lead.created_at).toLocaleDateString('en-KE')
                        : '—'}
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