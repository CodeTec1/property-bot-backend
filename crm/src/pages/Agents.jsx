import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import Layout from '../components/Layout'

export default function Agents({ user }) {
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(true)
  const [tenantId, setTenantId] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [editAgent, setEditAgent] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  const emptyForm = {
    agent_name: '',
    phone: '',
    email: '',
    active: true
  }
  const [form, setForm] = useState(emptyForm)

  useEffect(() => { fetchAgents() }, [user])

  async function fetchAgents() {
    try {
      const { data: tenant } = await supabase
        .from('tenants')
        .select('id')
        .eq('owner_email', user.email)
        .single()

      if (!tenant) return
      setTenantId(tenant.id)

      const { data } = await supabase
        .from('agents')
        .select(`
          *,
          properties (id)
        `)
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false })

      setAgents(data || [])
    } catch (error) {
      console.error('Error fetching agents:', error)
    } finally {
      setLoading(false)
    }
  }

  function openAdd() {
    setForm(emptyForm)
    setEditAgent(null)
    setShowModal(true)
  }

  function openEdit(agent) {
    setForm({
      agent_name: agent.agent_name || '',
      phone: agent.phone || '',
      email: agent.email || '',
      active: agent.active ?? true
    })
    setEditAgent(agent)
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.agent_name || !form.phone) {
      alert('Please fill in agent name and phone number.')
      return
    }

    setSaving(true)
    try {
      const payload = {
        agent_name: form.agent_name,
        phone: form.phone,
        email: form.email || null,
        active: form.active,
        tenant_id: tenantId
      }

      if (editAgent) {
        const { error } = await supabase
          .from('agents')
          .update(payload)
          .eq('id', editAgent.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('agents')
          .insert(payload)
        if (error) throw error
      }

      await fetchAgents()
      setShowModal(false)
      setForm(emptyForm)
      setEditAgent(null)
    } catch (error) {
      console.error('Save error:', error)
      alert('Failed to save agent. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(agentId) {
    try {
      const { error } = await supabase
        .from('agents')
        .delete()
        .eq('id', agentId)
      if (error) throw error
      await fetchAgents()
      setDeleteConfirm(null)
    } catch (error) {
      console.error('Delete error:', error)
      alert('Failed to delete agent.')
    }
  }

  async function toggleActive(agent) {
    try {
      await supabase
        .from('agents')
        .update({ active: !agent.active })
        .eq('id', agent.id)
      await fetchAgents()
    } catch (error) {
      console.error('Error:', error)
    }
  }

  const activeAgents = agents.filter(a => a.active).length
  const totalProperties = agents.reduce((sum, a) => sum + (a.properties?.length || 0), 0)

  return (
    <Layout title="Agents" user={user}>

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
            Agents
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Manage your real estate agents
          </p>
        </div>

        <button
          onClick={openAdd}
          className="glow-btn"
          style={{
            padding: '10px 20px',
            borderRadius: 'var(--radius-sm)',
            border: 'none',
            background: 'linear-gradient(135deg, #00E5FF, #0088ff)',
            color: '#0B0F1A',
            fontSize: '13px',
            fontWeight: '700',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add Agent
        </button>
      </div>

      {/* Mini stats */}
      <div className="fade-up fade-up-1" style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '12px',
        marginBottom: '24px'
      }}>
        {[
          { label: 'Total Agents', value: agents.length, color: '#00E5FF' },
          { label: 'Active', value: activeAgents, color: '#10b981' },
          { label: 'Properties Assigned', value: totalProperties, color: '#8b5cf6' }
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
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{s.label}</span>
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

      {/* Agents grid */}
      {loading ? (
        <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-muted)' }}>
          <div style={{
            width: '32px', height: '32px',
            border: '3px solid var(--accent-border)',
            borderTop: '3px solid var(--accent)',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 12px'
          }} />
          Loading agents...
        </div>
      ) : agents.length === 0 ? (
        <div style={{
          padding: '80px',
          textAlign: 'center',
          color: 'var(--text-muted)'
        }}>
          <div style={{ fontSize: '40px', marginBottom: '16px' }}>👤</div>
          <div style={{
            fontSize: '16px',
            fontWeight: '600',
            color: '#ffffff',
            marginBottom: '8px'
          }}>
            No agents yet
          </div>
          <div style={{ fontSize: '13px', marginBottom: '24px' }}>
            Add your first agent to assign them to properties
          </div>
          <button
            onClick={openAdd}
            className="glow-btn"
            style={{
              padding: '12px 24px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              background: 'linear-gradient(135deg, #00E5FF, #0088ff)',
              color: '#0B0F1A',
              fontSize: '14px',
              fontWeight: '700'
            }}
          >
            Add First Agent
          </button>
        </div>
      ) : (
        <div className="fade-up fade-up-2" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '16px'
        }}>
          {agents.map(agent => (
            <div
              key={agent.id}
              style={{
                background: 'var(--bg-card)',
                borderRadius: 'var(--radius-lg)',
                border: `1px solid ${agent.active ? 'var(--border)' : '#ef444422'}`,
                padding: '24px',
                transition: 'var(--transition)',
                position: 'relative',
                overflow: 'hidden'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = agent.active ? 'var(--accent-border)' : '#ef444444'
                e.currentTarget.style.transform = 'translateY(-2px)'
                e.currentTarget.style.boxShadow = agent.active ? 'var(--shadow-glow)' : '0 8px 32px #ef444422'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = agent.active ? 'var(--border)' : '#ef444422'
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = 'none'
              }}
            >
              {/* Background glow */}
              <div style={{
                position: 'absolute',
                top: '-30px',
                right: '-30px',
                width: '100px',
                height: '100px',
                borderRadius: '50%',
                background: agent.active ? 'var(--accent)' : '#ef4444',
                opacity: 0.04,
                filter: 'blur(20px)',
                pointerEvents: 'none'
              }} />

              {/* Agent header */}
              <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                marginBottom: '20px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div style={{
                    width: '52px',
                    height: '52px',
                    borderRadius: '50%',
                    background: agent.active
                      ? 'linear-gradient(135deg, #00E5FF, #0088ff)'
                      : 'linear-gradient(135deg, #374151, #1f2937)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'Syne, sans-serif',
                    fontSize: '20px',
                    fontWeight: '800',
                    color: agent.active ? '#0B0F1A' : 'var(--text-muted)',
                    flexShrink: 0,
                    boxShadow: agent.active ? '0 4px 16px #00E5FF33' : 'none'
                  }}>
                    {agent.agent_name?.charAt(0)?.toUpperCase() || 'A'}
                  </div>
                  <div>
                    <div style={{
                      fontFamily: 'Syne, sans-serif',
                      fontSize: '15px',
                      fontWeight: '700',
                      color: '#ffffff',
                      marginBottom: '2px'
                    }}>
                      {agent.agent_name}
                    </div>
                    <span style={{
                      fontSize: '11px',
                      fontWeight: '600',
                      color: agent.active ? '#10b981' : '#ef4444',
                      background: agent.active ? '#10b98118' : '#ef444418',
                      padding: '2px 8px',
                      borderRadius: '20px'
                    }}>
                      {agent.active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Contact details */}
              <div style={{ marginBottom: '16px' }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 12px',
                  background: 'var(--bg-primary)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  marginBottom: '8px'
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.56 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
                  </svg>
                  <span style={{ fontSize: '13px', color: '#ffffff', fontFamily: 'monospace' }}>
                    {agent.phone}
                  </span>
                </div>

                {agent.email && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '10px 12px',
                    background: 'var(--bg-primary)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)'
                  }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                      <polyline points="22,6 12,13 2,6"/>
                    </svg>
                    <span style={{
                      fontSize: '13px',
                      color: '#ffffff',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {agent.email}
                    </span>
                  </div>
                )}
              </div>

              {/* Properties count */}
              <div style={{
                padding: '10px 12px',
                background: 'var(--accent-dim)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--accent-border)',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Properties assigned
                </span>
                <span style={{
                  fontFamily: 'Syne, sans-serif',
                  fontSize: '16px',
                  fontWeight: '800',
                  color: 'var(--accent)'
                }}>
                  {agent.properties?.length || 0}
                </span>
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => toggleActive(agent)}
                  style={{
                    flex: 1,
                    padding: '8px',
                    borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${agent.active ? '#ef444433' : '#10b98133'}`,
                    background: agent.active ? '#ef444418' : '#10b98118',
                    color: agent.active ? '#ef4444' : '#10b981',
                    fontSize: '12px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'var(--transition)'
                  }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                >
                  {agent.active ? 'Deactivate' : 'Activate'}
                </button>
                <button
                  onClick={() => openEdit(agent)}
                  style={{
                    flex: 1,
                    padding: '8px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--accent-border)',
                    background: 'var(--accent-dim)',
                    color: 'var(--accent)',
                    fontSize: '12px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'var(--transition)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#00E5FF33'}
                  onMouseLeave={e => e.currentTarget.style.background = 'var(--accent-dim)'}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                  Edit
                </button>
                <button
                  onClick={() => setDeleteConfirm(agent)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid #ef444433',
                    background: '#ef444418',
                    color: '#ef4444',
                    fontSize: '12px',
                    cursor: 'pointer',
                    transition: 'var(--transition)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#ef444433'}
                  onMouseLeave={e => e.currentTarget.style.background = '#ef444418'}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14H6L5 6"/>
                    <path d="M10 11v6M14 11v6"/>
                    <path d="M9 6V4h6v2"/>
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div
          onClick={() => setShowModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.8)',
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
              boxShadow: '0 32px 80px rgba(0,0,0,0.6), var(--shadow-glow)',
              animation: 'fadeUp 0.3s ease'
            }}
          >
            {/* Modal header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '28px'
            }}>
              <div>
                <h3 style={{
                  fontFamily: 'Syne, sans-serif',
                  fontSize: '18px',
                  fontWeight: '700',
                  color: '#ffffff'
                }}>
                  {editAgent ? 'Edit Agent' : 'Add New Agent'}
                </h3>
                <p style={{
                  fontSize: '13px',
                  color: 'var(--text-muted)',
                  marginTop: '2px'
                }}>
                  {editAgent ? 'Update agent details' : 'Add a new agent to your team'}
                </p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: '22px',
                  cursor: 'pointer',
                  lineHeight: 1,
                  padding: '4px'
                }}
              >
                ×
              </button>
            </div>

            {/* Avatar preview */}
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              marginBottom: '28px'
            }}>
              <div style={{
                width: '72px',
                height: '72px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #00E5FF, #0088ff)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'Syne, sans-serif',
                fontSize: '28px',
                fontWeight: '800',
                color: '#0B0F1A',
                boxShadow: '0 8px 24px #00E5FF33'
              }}>
                {form.agent_name?.charAt(0)?.toUpperCase() || 'A'}
              </div>
            </div>

            {/* Form fields */}
            <div style={{ marginBottom: '20px' }}>
              <label style={agentLabelStyle}>Full Name *</label>
              <input
                type="text"
                placeholder="e.g. Jane Wanjiku"
                value={form.agent_name}
                onChange={e => setForm(prev => ({ ...prev, agent_name: e.target.value }))}
                style={agentInputStyle}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={agentLabelStyle}>Phone Number *</label>
              <input
                type="text"
                placeholder="e.g. +254712345678"
                value={form.phone}
                onChange={e => setForm(prev => ({ ...prev, phone: e.target.value }))}
                style={agentInputStyle}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label style={agentLabelStyle}>Email Address</label>
              <input
                type="email"
                placeholder="e.g. jane@agency.com"
                value={form.email}
                onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))}
                style={agentInputStyle}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
            </div>

            {/* Active toggle */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              marginBottom: '28px',
              padding: '14px 16px',
              background: 'var(--bg-primary)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)'
            }}>
              <button
                type="button"
                onClick={() => setForm(prev => ({ ...prev, active: !prev.active }))}
                style={{
                  width: '44px',
                  height: '24px',
                  borderRadius: '12px',
                  border: 'none',
                  background: form.active ? '#10b981' : '#374151',
                  position: 'relative',
                  cursor: 'pointer',
                  transition: 'var(--transition)',
                  flexShrink: 0
                }}
              >
                <div style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  background: '#ffffff',
                  position: 'absolute',
                  top: '3px',
                  left: form.active ? '23px' : '3px',
                  transition: 'var(--transition)'
                }} />
              </button>
              <div>
                <div style={{
                  fontSize: '13px',
                  fontWeight: '600',
                  color: '#ffffff'
                }}>
                  {form.active ? 'Active' : 'Inactive'}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Only active agents receive booking notifications
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  flex: 1,
                  padding: '13px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'var(--transition)'
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-border)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="glow-btn"
                style={{
                  flex: 2,
                  padding: '13px',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  background: saving
                    ? '#374151'
                    : 'linear-gradient(135deg, #00E5FF, #0088ff)',
                  color: saving ? 'var(--text-muted)' : '#0B0F1A',
                  fontSize: '14px',
                  fontWeight: '700',
                  cursor: saving ? 'not-allowed' : 'pointer'
                }}
              >
                {saving ? 'Saving...' : editAgent ? 'Update Agent' : 'Add Agent'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div
          onClick={() => setDeleteConfirm(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.8)',
            backdropFilter: 'blur(4px)',
            zIndex: 1001,
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
              border: '1px solid #ef444433',
              padding: '32px',
              width: '100%',
              maxWidth: '380px',
              textAlign: 'center',
              animation: 'fadeUp 0.3s ease'
            }}
          >
            <div style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              background: '#ef444418',
              border: '1px solid #ef444433',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px',
              fontSize: '24px'
            }}>
              👤
            </div>
            <h3 style={{
              fontFamily: 'Syne, sans-serif',
              fontSize: '18px',
              fontWeight: '700',
              color: '#ffffff',
              marginBottom: '8px'
            }}>
              Remove Agent?
            </h3>
            <p style={{
              fontSize: '13px',
              color: 'var(--text-muted)',
              marginBottom: '24px',
              lineHeight: 1.6
            }}>
              Are you sure you want to remove <strong style={{ color: '#ffffff' }}>{deleteConfirm.agent_name}</strong>? Properties assigned to this agent will become unassigned.
            </p>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={() => setDeleteConfirm(null)}
                style={{
                  flex: 1,
                  padding: '12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm.id)}
                style={{
                  flex: 1,
                  padding: '12px',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  background: '#ef4444',
                  color: '#ffffff',
                  fontSize: '14px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  transition: 'var(--transition)'
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#dc2626'}
                onMouseLeave={e => e.currentTarget.style.background = '#ef4444'}
              >
                Remove
              </button>
            </div>
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

const agentLabelStyle = {
  display: 'block',
  fontSize: '12px',
  fontWeight: '600',
  color: 'var(--text-muted)',
  marginBottom: '6px',
  textTransform: 'uppercase',
  letterSpacing: '0.5px'
}

const agentInputStyle = {
  width: '100%',
  padding: '11px 14px',
  borderRadius: '8px',
  border: '1px solid var(--border)',
  background: 'var(--bg-primary)',
  color: '#ffffff',
  fontSize: '13px',
  outline: 'none',
  transition: 'border-color 0.2s',
  boxSizing: 'border-box'
} 