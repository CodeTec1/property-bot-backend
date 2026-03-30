import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import Layout from '../components/Layout'

export default function Properties({ user }) {
  const [properties, setProperties] = useState([])
  const [filtered, setFiltered] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('All')
  const [availabilityFilter, setAvailabilityFilter] = useState('All')

  useEffect(() => { fetchProperties() }, [user])

  useEffect(() => {
    let result = properties
    if (search) {
      result = result.filter(p =>
        p.property_name?.toLowerCase().includes(search.toLowerCase()) ||
        p.location?.toLowerCase().includes(search.toLowerCase()) ||
        p.address?.toLowerCase().includes(search.toLowerCase())
      )
    }
    if (typeFilter !== 'All') {
      result = result.filter(p => p.type === typeFilter)
    }
    if (availabilityFilter !== 'All') {
      result = result.filter(p =>
        availabilityFilter === 'Available' ? p.available : !p.available
      )
    }
    setFiltered(result)
  }, [search, typeFilter, availabilityFilter, properties])

  async function fetchProperties() {
    try {
      const { data: tenant } = await supabase
        .from('tenants')
        .select('id')
        .eq('owner_email', user.email)
        .single()

      if (!tenant) return

      const { data } = await supabase
        .from('properties')
        .select(`
          *,
          agents (agent_name, phone)
        `)
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false })

      setProperties(data || [])
      setFiltered(data || [])
    } catch (error) {
      console.error('Error fetching properties:', error)
    } finally {
      setLoading(false)
    }
  }

  const types = ['All', 'Buy', 'Rent', 'Land']
  const availabilities = ['All', 'Available', 'Unavailable']

  return (
    <Layout title="Properties">

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
            All Properties
          </h2>
          <p style={{ fontSize: '13px', color: '#9ca3af' }}>
            {filtered.length} properties found
          </p>
        </div>

        <input
          type="text"
          placeholder="Search by name, location or address..."
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

      {/* Filters */}
      <div style={{
        display: 'flex',
        gap: '16px',
        marginBottom: '24px',
        flexWrap: 'wrap',
        alignItems: 'center'
      }}>
        {/* Type filter */}
        <div style={{ display: 'flex', gap: '8px' }}>
          {types.map(type => (
            <button
              key={type}
              onClick={() => setTypeFilter(type)}
              style={{
                padding: '6px 16px',
                borderRadius: '20px',
                border: typeFilter === type ? 'none' : '1px solid #00E5FF33',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
                background: typeFilter === type ? '#00E5FF' : '#0B0F1A',
                color: typeFilter === type ? '#0B0F1A' : '#9ca3af',
                transition: 'all 0.2s'
              }}
            >
              {type}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div style={{
          width: '1px',
          height: '24px',
          background: '#00E5FF22'
        }} />

        {/* Availability filter */}
        <div style={{ display: 'flex', gap: '8px' }}>
          {availabilities.map(av => (
            <button
              key={av}
              onClick={() => setAvailabilityFilter(av)}
              style={{
                padding: '6px 16px',
                borderRadius: '20px',
                border: availabilityFilter === av ? 'none' : '1px solid #00E5FF33',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
                background: availabilityFilter === av ? '#00E5FF' : '#0B0F1A',
                color: availabilityFilter === av ? '#0B0F1A' : '#9ca3af',
                transition: 'all 0.2s'
              }}
            >
              {av}
            </button>
          ))}
        </div>
      </div>

      {/* Properties grid */}
      {loading ? (
        <div style={{
          padding: '60px',
          textAlign: 'center',
          color: '#9ca3af'
        }}>
          Loading properties...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          padding: '60px',
          textAlign: 'center',
          color: '#9ca3af'
        }}>
          No properties found.
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: '20px'
        }}>
          {filtered.map(property => (
            <div
              key={property.id}
              style={{
                background: '#ffffff',
                borderRadius: '16px',
                overflow: 'hidden',
                boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
                transition: 'transform 0.2s',
                cursor: 'default'
              }}
              onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
              onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
            >
              {/* Property image */}
              <div style={{
                height: '160px',
                background: property.photo_url
                  ? `url(${property.photo_url}) center/cover no-repeat`
                  : 'linear-gradient(135deg, #0B0F1A, #111827)',
                display: property.photo_url ? 'block' : 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '40px',
                position: 'relative'
              }}>
                {!property.photo_url && '🏡'}

                {/* Availability badge */}
                <div style={{
                  position: 'absolute',
                  top: '12px',
                  right: '12px',
                  fontSize: '11px',
                  fontWeight: '700',
                  color: property.available ? '#10b981' : '#ef4444',
                  background: property.available ? '#d1fae5' : '#fee2e2',
                  padding: '4px 10px',
                  borderRadius: '20px'
                }}>
                  {property.available ? 'Available' : 'Unavailable'}
                </div>

                {/* Type badge */}
                <div style={{
                  position: 'absolute',
                  top: '12px',
                  left: '12px',
                  fontSize: '11px',
                  fontWeight: '700',
                  color: '#00E5FF',
                  background: '#dbeafe',
                  padding: '4px 10px',
                  borderRadius: '20px'
                }}>
                  {property.type}
                </div>
              </div>

              {/* Property details */}
              <div style={{ padding: '20px' }}>
                <h3 style={{
                  fontSize: '15px',
                  fontWeight: '700',
                  color: '#0B0F1A',
                  marginBottom: '6px'
                }}>
                  {property.property_name}
                </h3>

                <p style={{
                  fontSize: '12px',
                  color: '#6b7280',
                  marginBottom: '12px'
                }}>
                  📍 {property.location} — {property.address}
                </p>

                {/* Price */}
                <div style={{
                  fontSize: '18px',
                  fontWeight: '800',
                  color: '#0B0F1A',
                  marginBottom: '12px'
                }}>
                  KES {Number(property.price).toLocaleString()}
                </div>

                {/* Details row */}
                <div style={{
                  display: 'flex',
                  gap: '12px',
                  marginBottom: '16px',
                  flexWrap: 'wrap'
                }}>
                  {property.bedrooms && (
                    <span style={{
                      fontSize: '12px',
                      color: '#6b7280',
                      background: '#f3f4f6',
                      padding: '4px 10px',
                      borderRadius: '8px'
                    }}>
                      🛏 {property.bedrooms} Bed{property.bedrooms > 1 ? 's' : ''}
                    </span>
                  )}
                  {property.plot_size && (
                    <span style={{
                      fontSize: '12px',
                      color: '#6b7280',
                      background: '#f3f4f6',
                      padding: '4px 10px',
                      borderRadius: '8px'
                    }}>
                      📐 {property.plot_size}
                    </span>
                  )}
                </div>

                {/* Agent */}
                {property.agents && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '10px',
                    background: '#f9fafb',
                    borderRadius: '8px'
                  }}>
                    <div style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, #00E5FF, #00E5FF)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '11px',
                      fontWeight: '700',
                      color: '#ffffff'
                    }}>
                      {property.agents.agent_name?.charAt(0) || 'A'}
                    </div>
                    <div>
                      <div style={{
                        fontSize: '12px',
                        fontWeight: '600',
                        color: '#0B0F1A'
                      }}>
                        {property.agents.agent_name}
                      </div>
                      <div style={{
                        fontSize: '11px',
                        color: '#9ca3af'
                      }}>
                        {property.agents.phone}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  )
}