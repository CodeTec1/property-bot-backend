import { useEffect, useState, useRef } from 'react'
import { supabase } from '../supabase'
import Layout from '../components/Layout'

const TYPE_COLORS = {
  'Buy': { color: '#0088ff', bg: '#0088ff18' },
  'Rent': { color: '#10b981', bg: '#10b98118' },
  'Land': { color: '#f59e0b', bg: '#f59e0b18' }
}

export default function Properties({ user }) {
  const [properties, setProperties] = useState([])
  const [filtered, setFiltered] = useState([])
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('All')
  const [availFilter, setAvailFilter] = useState('All')
  const [showModal, setShowModal] = useState(false)
  const [editProperty, setEditProperty] = useState(null)
  const [tenantId, setTenantId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const fileInputRef = useRef(null)

  const emptyForm = {
    property_name: '',
    type: 'Buy',
    price: '',
    bedrooms: '',
    plot_size: '',
    location: '',
    address: '',
    photo_url: '',
    available: true,
    description: '',
    amenities: '',
    completion_date: '',
    is_offplan: false,
    sqm: '',
    agent_id: ''
  }
  const [form, setForm] = useState(emptyForm)

  useEffect(() => { fetchData() }, [user])

  useEffect(() => {
    let result = properties
    if (search) {
      result = result.filter(p =>
        p.property_name?.toLowerCase().includes(search.toLowerCase()) ||
        p.location?.toLowerCase().includes(search.toLowerCase()) ||
        p.address?.toLowerCase().includes(search.toLowerCase())
      )
    }
    if (typeFilter !== 'All') result = result.filter(p => p.type === typeFilter)
    if (availFilter === 'Available') result = result.filter(p => p.available)
    if (availFilter === 'Unavailable') result = result.filter(p => !p.available)
    setFiltered(result)
  }, [search, typeFilter, availFilter, properties])

  async function fetchData() {
    try {
      const { data: tenant } = await supabase
        .from('tenants')
        .select('id')
        .eq('owner_email', user.email)
        .single()

      if (!tenant) return
      setTenantId(tenant.id)

      const [propsRes, agentsRes] = await Promise.all([
        supabase
          .from('properties')
          .select('*, agents(agent_name, phone)')
          .eq('tenant_id', tenant.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('agents')
          .select('id, agent_name, phone')
          .eq('tenant_id', tenant.id)
          .eq('active', true)
      ])

      setProperties(propsRes.data || [])
      setFiltered(propsRes.data || [])
      setAgents(agentsRes.data || [])
    } catch (error) {
      console.error('Error:', error)
    } finally {
      setLoading(false)
    }
  }

  function openAdd() {
    setForm(emptyForm)
    setEditProperty(null)
    setShowModal(true)
  }

  function openEdit(property) {
    setForm({
      property_name: property.property_name || '',
      type: property.type || 'Buy',
      price: property.price || '',
      bedrooms: property.bedrooms || '',
      plot_size: property.plot_size || '',
      location: property.location || '',
      address: property.address || '',
      photo_url: property.photo_url || '',
      available: property.available ?? true,
      description: property.description || '',
      amenities: property.amenities || '',
      completion_date: property.completion_date || '',
      is_offplan: property.is_offplan || false,
      sqm: property.sqm || '',
      agent_id: property.agent_id || ''
    })
    setEditProperty(property)
    setShowModal(true)
  }

  async function handlePhotoUpload(e) {
    const file = e.target.files[0]
    if (!file) return

    setUploading(true)
    try {
      const fileExt = file.name.split('.').pop()
      const fileName = `${tenantId}/${Date.now()}.${fileExt}`

      const { error: uploadError } = await supabase.storage
        .from('property-images')
        .upload(fileName, file, { upsert: true })

      if (uploadError) throw uploadError

      const { data } = supabase.storage
        .from('property-images')
        .getPublicUrl(fileName)

      setForm(prev => ({ ...prev, photo_url: data.publicUrl }))
    } catch (error) {
      console.error('Upload error:', error)
      alert('Failed to upload image. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  async function handleSave() {
    if (!form.property_name || !form.type || !form.location) {
      alert('Please fill in property name, type and location.')
      return
    }

    setSaving(true)
    try {
      const payload = {
        property_name: form.property_name,
        type: form.type,
        price: form.price ? parseFloat(form.price) : null,
        bedrooms: form.bedrooms ? parseInt(form.bedrooms) : null,
        plot_size: form.plot_size || null,
        location: form.location,
        address: form.address || null,
        photo_url: form.photo_url || null,
        available: form.available,
        description: form.description || null,
        amenities: form.amenities || null,
        completion_date: form.completion_date || null,
        is_offplan: form.is_offplan,
        sqm: form.sqm ? parseFloat(form.sqm) : null,
        agent_id: form.agent_id || null,
        tenant_id: tenantId
      }

      if (editProperty) {
        const { error } = await supabase
          .from('properties')
          .update(payload)
          .eq('id', editProperty.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('properties')
          .insert(payload)
        if (error) throw error
      }

      await fetchData()
      setShowModal(false)
      setForm(emptyForm)
      setEditProperty(null)
    } catch (error) {
      console.error('Save error:', error)
      alert('Failed to save property. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(propertyId) {
    try {
      const { error } = await supabase
        .from('properties')
        .delete()
        .eq('id', propertyId)
      if (error) throw error
      await fetchData()
      setDeleteConfirm(null)
    } catch (error) {
      console.error('Delete error:', error)
      alert('Failed to delete property.')
    }
  }

  async function toggleAvailability(property) {
    try {
      await supabase
        .from('properties')
        .update({ available: !property.available })
        .eq('id', property.id)
      await fetchData()
    } catch (error) {
      console.error('Error:', error)
    }
  }

  const types = ['All', 'Buy', 'Rent', 'Land']
  const avails = ['All', 'Available', 'Unavailable']

  const stats = {
    total: properties.length,
    available: properties.filter(p => p.available).length,
    buy: properties.filter(p => p.type === 'Buy').length,
    rent: properties.filter(p => p.type === 'Rent').length,
    land: properties.filter(p => p.type === 'Land').length
  }

  return (
    <Layout title="Properties" user={user}>

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
            Properties
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Manage your property listings
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
          Add Property
        </button>
      </div>

      {/* Mini stats */}
      <div className="fade-up fade-up-1" style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: '12px',
        marginBottom: '24px'
      }}>
        {[
          { label: 'Total', value: stats.total, color: '#00E5FF' },
          { label: 'Available', value: stats.available, color: '#10b981' },
          { label: 'Buy', value: stats.buy, color: '#0088ff' },
          { label: 'Rent', value: stats.rent, color: '#10b981' },
          { label: 'Land', value: stats.land, color: '#f59e0b' }
        ].map(s => (
          <div key={s.label} style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-md)',
            padding: '14px 18px',
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            transition: 'var(--transition)'
          }}
          onMouseEnter={e => e.currentTarget.style.borderColor = s.color + '44'}
          onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
          >
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{s.label}</span>
            <span style={{
              fontFamily: 'Syne, sans-serif',
              fontSize: '20px',
              fontWeight: '800',
              color: s.color
            }}>{s.value}</span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="fade-up fade-up-2" style={{
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-md)',
        padding: '14px 20px',
        border: '1px solid var(--border)',
        marginBottom: '20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px'
      }}>
        <div style={{ position: 'relative' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2"
            style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }}>
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            placeholder="Search properties..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              padding: '9px 16px 9px 36px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              background: 'var(--bg-primary)',
              color: '#ffffff',
              fontSize: '13px',
              width: '220px',
              outline: 'none',
              transition: 'var(--transition)'
            }}
            onFocus={e => e.target.style.borderColor = 'var(--accent)'}
            onBlur={e => e.target.style.borderColor = 'var(--border)'}
          />
        </div>

        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {types.map(t => (
            <button key={t} onClick={() => setTypeFilter(t)} style={{
              padding: '6px 14px',
              borderRadius: '20px',
              border: typeFilter === t ? 'none' : '1px solid var(--border)',
              fontSize: '12px',
              fontWeight: '600',
              cursor: 'pointer',
              background: typeFilter === t ? 'var(--accent)' : 'transparent',
              color: typeFilter === t ? '#0B0F1A' : 'var(--text-muted)',
              transition: 'var(--transition)'
            }}>
              {t}
            </button>
          ))}

          <div style={{ width: '1px', background: 'var(--border)', margin: '0 4px' }} />

          {avails.map(a => (
            <button key={a} onClick={() => setAvailFilter(a)} style={{
              padding: '6px 14px',
              borderRadius: '20px',
              border: availFilter === a ? 'none' : '1px solid var(--border)',
              fontSize: '12px',
              fontWeight: '600',
              cursor: 'pointer',
              background: availFilter === a ? 'var(--accent)' : 'transparent',
              color: availFilter === a ? '#0B0F1A' : 'var(--text-muted)',
              transition: 'var(--transition)'
            }}>
              {a}
            </button>
          ))}
        </div>

        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          {filtered.length} properties
        </span>
      </div>

      {/* Properties grid */}
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
          Loading properties...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          padding: '80px',
          textAlign: 'center',
          color: 'var(--text-muted)'
        }}>
          <div style={{ fontSize: '40px', marginBottom: '16px' }}>🏡</div>
          <div style={{ fontSize: '16px', fontWeight: '600', color: '#ffffff', marginBottom: '8px' }}>
            No properties yet
          </div>
          <div style={{ fontSize: '13px', marginBottom: '24px' }}>
            Add your first property to get started
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
            Add First Property
          </button>
        </div>
      ) : (
        <div className="fade-up fade-up-3" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: '20px'
        }}>
          {filtered.map(property => (
            <div
              key={property.id}
              style={{
                background: 'var(--bg-card)',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--border)',
                overflow: 'hidden',
                transition: 'var(--transition)'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'var(--accent-border)'
                e.currentTarget.style.transform = 'translateY(-2px)'
                e.currentTarget.style.boxShadow = 'var(--shadow-glow)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--border)'
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = 'none'
              }}
            >
              {/* Property image */}
              <div style={{
                height: '180px',
                background: property.photo_url
                  ? `url(${property.photo_url}) center/cover no-repeat`
                  : 'linear-gradient(135deg, #0d1117, #111827)',
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                {!property.photo_url && (
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ffffff22" strokeWidth="1.5">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                    <polyline points="9 22 9 12 15 12 15 22"/>
                  </svg>
                )}

                {/* Badges */}
                <div style={{
                  position: 'absolute',
                  top: '12px',
                  left: '12px',
                  display: 'flex',
                  gap: '6px'
                }}>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: '700',
                    color: TYPE_COLORS[property.type]?.color || '#fff',
                    background: TYPE_COLORS[property.type]?.bg || '#ffffff22',
                    padding: '3px 10px',
                    borderRadius: '20px',
                    backdropFilter: 'blur(8px)'
                  }}>
                    {property.type}
                  </span>
                  {property.is_offplan && (
                    <span style={{
                      fontSize: '11px',
                      fontWeight: '700',
                      color: '#f59e0b',
                      background: '#f59e0b22',
                      padding: '3px 10px',
                      borderRadius: '20px',
                      backdropFilter: 'blur(8px)'
                    }}>
                      Off-Plan
                    </span>
                  )}
                </div>

                {/* Availability toggle */}
                <div style={{
                  position: 'absolute',
                  top: '12px',
                  right: '12px'
                }}>
                  <button
                    onClick={() => toggleAvailability(property)}
                    title="Toggle availability"
                    style={{
                      fontSize: '11px',
                      fontWeight: '700',
                      color: property.available ? '#10b981' : '#ef4444',
                      background: property.available ? '#10b98122' : '#ef444422',
                      border: 'none',
                      padding: '3px 10px',
                      borderRadius: '20px',
                      cursor: 'pointer',
                      backdropFilter: 'blur(8px)',
                      transition: 'var(--transition)'
                    }}
                  >
                    {property.available ? 'Available' : 'Unavailable'}
                  </button>
                </div>
              </div>

              {/* Property details */}
              <div style={{ padding: '20px' }}>
                <h3 style={{
                  fontFamily: 'Syne, sans-serif',
                  fontSize: '15px',
                  fontWeight: '700',
                  color: '#ffffff',
                  marginBottom: '6px'
                }}>
                  {property.property_name}
                </h3>

                <p style={{
                  fontSize: '12px',
                  color: 'var(--text-muted)',
                  marginBottom: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                    <circle cx="12" cy="10" r="3"/>
                  </svg>
                  {property.location}{property.address ? ` — ${property.address}` : ''}
                </p>

                <div style={{
                  fontFamily: 'Syne, sans-serif',
                  fontSize: '20px',
                  fontWeight: '800',
                  color: 'var(--accent)',
                  marginBottom: '12px'
                }}>
                  KES {Number(property.price || 0).toLocaleString()}
                </div>

                {/* Details pills */}
                <div style={{
                  display: 'flex',
                  gap: '8px',
                  flexWrap: 'wrap',
                  marginBottom: '12px'
                }}>
                  {(property.bedrooms !== null && property.bedrooms !== undefined) && (
  <span style={{
    fontSize: '12px',
    color: 'var(--text-secondary)',
    background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
    padding: '3px 10px',
    borderRadius: '6px'
  }}>
    🛏 {property.bedrooms === 0 ? 'Studio' : `${property.bedrooms} Bed${property.bedrooms > 1 ? 's' : ''}`}
  </span>
)}
                  {property.plot_size && (
                    <span style={{
                      fontSize: '12px',
                      color: 'var(--text-secondary)',
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border)',
                      padding: '3px 10px',
                      borderRadius: '6px'
                    }}>
                      📐 {property.plot_size}
                    </span>
                  )}
                  {property.completion_date && (
                    <span style={{
                      fontSize: '12px',
                      color: '#f59e0b',
                      background: '#f59e0b18',
                      border: '1px solid #f59e0b33',
                      padding: '3px 10px',
                      borderRadius: '6px'
                    }}>
                      🏗 {property.completion_date}
                    </span>
                  )}
                </div>

                {/* Description preview */}
                {property.description && (
                  <p style={{
                    fontSize: '12px',
                    color: 'var(--text-muted)',
                    marginBottom: '12px',
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    lineHeight: 1.5
                  }}>
                    {property.description}
                  </p>
                )}

                {/* Agent */}
                {property.agents && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 12px',
                    background: 'var(--bg-primary)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    marginBottom: '16px'
                  }}>
                    <div style={{
                      width: '26px',
                      height: '26px',
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, #00E5FF, #0088ff)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '11px',
                      fontWeight: '700',
                      color: '#0B0F1A',
                      flexShrink: 0
                    }}>
                      {property.agents.agent_name?.charAt(0) || 'A'}
                    </div>
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: '600', color: '#ffffff' }}>
                        {property.agents.agent_name}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {property.agents.phone}
                      </div>
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => openEdit(property)}
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
                    onClick={() => setDeleteConfirm(property)}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid #ef444433',
                      background: '#ef444418',
                      color: '#ef4444',
                      fontSize: '12px',
                      fontWeight: '600',
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
              width: '100%',
              maxWidth: '680px',
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 32px 80px rgba(0,0,0,0.6), var(--shadow-glow)',
              animation: 'fadeUp 0.3s ease'
            }}
          >
            {/* Modal header */}
            <div style={{
              padding: '24px 32px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              position: 'sticky',
              top: 0,
              background: 'var(--bg-card)',
              zIndex: 10,
              borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0'
            }}>
              <div>
                <h3 style={{
                  fontFamily: 'Syne, sans-serif',
                  fontSize: '18px',
                  fontWeight: '700',
                  color: '#ffffff'
                }}>
                  {editProperty ? 'Edit Property' : 'Add New Property'}
                </h3>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {editProperty ? 'Update property details' : 'Fill in the property details below'}
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

            {/* Modal body */}
            <div style={{ padding: '28px 32px' }}>

              {/* Photo upload */}
              <div style={{ marginBottom: '24px' }}>
                <label style={labelStyle}>Property Photo</label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    height: '160px',
                    borderRadius: 'var(--radius-md)',
                    border: '2px dashed var(--accent-border)',
                    background: form.photo_url
                      ? `url(${form.photo_url}) center/cover no-repeat`
                      : 'var(--bg-primary)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'var(--transition)',
                    position: 'relative',
                    overflow: 'hidden'
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--accent-border)'}
                >
                  {uploading ? (
                    <div style={{ textAlign: 'center', color: 'var(--accent)' }}>
                      <div style={{
                        width: '28px', height: '28px',
                        border: '3px solid var(--accent-border)',
                        borderTop: '3px solid var(--accent)',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite',
                        margin: '0 auto 8px'
                      }} />
                      Uploading...
                    </div>
                  ) : form.photo_url ? (
                    <div style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'rgba(0,0,0,0.5)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#fff'
                    }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="17 8 12 3 7 8"/>
                        <line x1="12" y1="3" x2="12" y2="15"/>
                      </svg>
                      <span style={{ fontSize: '12px', marginTop: '6px' }}>Click to change photo</span>
                    </div>
                  ) : (
                    <>
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" style={{ marginBottom: '8px' }}>
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                        <circle cx="8.5" cy="8.5" r="1.5"/>
                        <polyline points="21 15 16 10 5 21"/>
                      </svg>
                      <span style={{ fontSize: '13px', color: 'var(--accent)', fontWeight: '600' }}>
                        Click to upload photo
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                        JPG, PNG, WEBP up to 50MB
                      </span>
                    </>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoUpload}
                  style={{ display: 'none' }}
                />

                {/* Or paste URL */}
                <div style={{ marginTop: '8px' }}>
                  <input
                    type="text"
                    placeholder="Or paste image URL directly..."
                    value={form.photo_url}
                    onChange={e => setForm(prev => ({ ...prev, photo_url: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
              </div>

              {/* Row 1 — Name and Type */}
              <div style={rowStyle}>
                <div style={{ flex: 2 }}>
                  <label style={labelStyle}>Property Name *</label>
                  <input
                    type="text"
                    placeholder="e.g. Modern 3-Bedroom Apartment"
                    value={form.property_name}
                    onChange={e => setForm(prev => ({ ...prev, property_name: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Type *</label>
                  <select
                    value={form.type}
                    onChange={e => setForm(prev => ({ ...prev, type: e.target.value }))}
                    style={inputStyle}
                  >
                    <option value="Buy">Buy</option>
                    <option value="Rent">Rent</option>
                    <option value="Land">Land</option>
                  </select>
                </div>
              </div>

              {/* Row 2 — Price and Bedrooms */}
              <div style={rowStyle}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Price (KES)</label>
                  <input
                    type="number"
                    placeholder="e.g. 5000000"
                    value={form.price}
                    onChange={e => setForm(prev => ({ ...prev, price: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
                {form.type !== 'Land' ? (
                  <div style={{ flex: 1 }}>
  <label style={labelStyle}>Bedrooms</label>
  <select
    value={form.bedrooms}
    onChange={e => setForm(prev => ({ ...prev, bedrooms: e.target.value }))}
    style={inputStyle}
  >
    <option value="">Select...</option>
    <option value="0">Studio</option>
    <option value="1">1 Bedroom</option>
    <option value="2">2 Bedrooms</option>
    <option value="3">3 Bedrooms</option>
    <option value="4">4 Bedrooms</option>
    <option value="5">5 Bedrooms</option>
    <option value="6">6 Bedrooms</option>
    <option value="7">7 Bedrooms</option>
  </select>
</div>
                ) : (
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Plot Size</label>
                    <input
                      type="text"
                      placeholder="e.g. 50x100 or 1/4 Acre"
                      value={form.plot_size}
                      onChange={e => setForm(prev => ({ ...prev, plot_size: e.target.value }))}
                      style={inputStyle}
                    />
                  </div>
                )}
              </div>

              {/* Row 3 — Location and Address */}
              <div style={rowStyle}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Location/Area *</label>
                  <input
                    type="text"
                    placeholder="e.g. Westlands"
                    value={form.location}
                    onChange={e => setForm(prev => ({ ...prev, location: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Full Address</label>
                  <input
                    type="text"
                    placeholder="e.g. Matundu Close, Westlands"
                    value={form.address}
                    onChange={e => setForm(prev => ({ ...prev, address: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
              </div>

              {/* Row 4 — Agent and SQM */}
              <div style={rowStyle}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Assign Agent</label>
                  <select
                    value={form.agent_id}
                    onChange={e => setForm(prev => ({ ...prev, agent_id: e.target.value }))}
                    style={inputStyle}
                  >
                    <option value="">Select agent...</option>
                    {agents.map(agent => (
                      <option key={agent.id} value={agent.id}>
                        {agent.agent_name} — {agent.phone}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Size (SQM)</label>
                  <input
                    type="number"
                    placeholder="e.g. 120"
                    value={form.sqm}
                    onChange={e => setForm(prev => ({ ...prev, sqm: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
              </div>

              {/* Off-plan toggle */}
              <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button
                  type="button"
                  onClick={() => setForm(prev => ({ ...prev, is_offplan: !prev.is_offplan }))}
                  style={{
                    width: '44px',
                    height: '24px',
                    borderRadius: '12px',
                    border: 'none',
                    background: form.is_offplan ? 'var(--accent)' : '#374151',
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
                    left: form.is_offplan ? '23px' : '3px',
                    transition: 'var(--transition)'
                  }} />
                </button>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: '#ffffff' }}>
                    Off-Plan Project
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Enable for developments under construction
                  </div>
                </div>
              </div>

              {/* Completion date (only for off-plan) */}
              {form.is_offplan && (
                <div style={{ marginBottom: '20px' }}>
                  <label style={labelStyle}>Completion Date</label>
                  <input
                    type="text"
                    placeholder="e.g. December 2027"
                    value={form.completion_date}
                    onChange={e => setForm(prev => ({ ...prev, completion_date: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
              )}

              {/* Amenities */}
              <div style={{ marginBottom: '20px' }}>
                <label style={labelStyle}>Amenities</label>
                <input
                  type="text"
                  placeholder="e.g. Swimming Pool, Gym, Parking, Generator"
                  value={form.amenities}
                  onChange={e => setForm(prev => ({ ...prev, amenities: e.target.value }))}
                  style={inputStyle}
                />
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Separate with commas
                </div>
              </div>

              {/* Description */}
              <div style={{ marginBottom: '20px' }}>
                <label style={labelStyle}>Property Description</label>
                <textarea
                  placeholder="Enter the full property description that will be sent to potential buyers/renters on WhatsApp..."
                  value={form.description}
                  onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                  rows={6}
                  style={{
                    ...inputStyle,
                    resize: 'vertical',
                    minHeight: '120px',
                    lineHeight: 1.6
                  }}
                />
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  This description will be sent to users on WhatsApp along with the property photo
                </div>
              </div>

              {/* Availability toggle */}
              <div style={{ marginBottom: '28px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button
                  type="button"
                  onClick={() => setForm(prev => ({ ...prev, available: !prev.available }))}
                  style={{
                    width: '44px',
                    height: '24px',
                    borderRadius: '12px',
                    border: 'none',
                    background: form.available ? '#10b981' : '#374151',
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
                    left: form.available ? '23px' : '3px',
                    transition: 'var(--transition)'
                  }} />
                </button>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: '#ffffff' }}>
                    {form.available ? 'Available for viewing' : 'Not available'}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Only available properties are shown to WhatsApp users
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  onClick={() => setShowModal(false)}
                  style={{
                    flex: 1,
                    padding: '14px',
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
                    padding: '14px',
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    background: saving
                      ? '#374151'
                      : 'linear-gradient(135deg, #00E5FF, #0088ff)',
                    color: saving ? 'var(--text-muted)' : '#0B0F1A',
                    fontSize: '14px',
                    fontWeight: '700',
                    cursor: saving ? 'not-allowed' : 'pointer',
                    transition: 'var(--transition)'
                  }}
                >
                  {saving ? 'Saving...' : editProperty ? 'Update Property' : 'Add Property'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
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
              maxWidth: '400px',
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
              🗑
            </div>
            <h3 style={{
              fontFamily: 'Syne, sans-serif',
              fontSize: '18px',
              fontWeight: '700',
              color: '#ffffff',
              marginBottom: '8px'
            }}>
              Delete Property?
            </h3>
            <p style={{
              fontSize: '13px',
              color: 'var(--text-muted)',
              marginBottom: '24px',
              lineHeight: 1.6
            }}>
              Are you sure you want to delete <strong style={{ color: '#ffffff' }}>{deleteConfirm.property_name}</strong>? This action cannot be undone.
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
                Delete
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
        select option { background: #111827; color: #ffffff; }
        textarea::placeholder { color: #6b728088; }
      `}</style>
    </Layout>
  )
}

const labelStyle = {
  display: 'block',
  fontSize: '12px',
  fontWeight: '600',
  color: 'var(--text-muted)',
  marginBottom: '6px',
  textTransform: 'uppercase',
  letterSpacing: '0.5px'
}

const inputStyle = {
  width: '100%',
  padding: '11px 14px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--bg-primary)',
  color: '#ffffff',
  fontSize: '13px',
  outline: 'none',
  transition: 'border-color 0.2s',
  boxSizing: 'border-box'
}

const rowStyle = {
  display: 'flex',
  gap: '16px',
  marginBottom: '20px'
}