// server.js - Simple Property Bot Backend
require('dotenv').config();
const express = require('express');
const Airtable = require('airtable');

const app = express();
app.use(express.json());

// Configure Airtable
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'Property Bot API Running' });
});

// ============================================
// ENDPOINT 1: Get Available Locations
// ============================================
app.post('/api/locations', async (req, res) => {
  try {
    const { tenantId, interest } = req.body;
    
    // Search properties
    const records = await base('Properties')
      .select({
        filterByFormula: `AND({TenantID} = '${tenantId}', {Type} = '${interest}', {Available} = 1)`,
        fields: ['Location']
      })
      .all();
    
    // Get unique locations
    const locations = [...new Set(records.map(r => r.get('Location')).filter(Boolean))].sort();
    
    // Format as bullet list
    const formatted = locations.map(loc => `• ${loc}`).join('\n');
    
    res.json({
      success: true,
      locations: locations,
      formatted: formatted,
      count: locations.length
    });
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINT 2: Get Available Sizes
// ============================================
app.post('/api/sizes', async (req, res) => {
  try {
    const { tenantId, interest, location } = req.body;
    
    // Search properties
    const records = await base('Properties')
      .select({
        filterByFormula: `AND({TenantID} = '${tenantId}', {Type} = '${interest}', {Location} = '${location}', {Available} = 1)`,
        fields: ['Bedrooms', 'Plot Size', 'Type']
      })
      .all();
    
    if (records.length === 0) {
      return res.json({
        success: false,
        message: 'No properties in this location'
      });
    }
    
    let options = '';
    let nextStage = '';
    
    if (interest === 'Land') {
      // Get unique plot sizes
      const plots = [...new Set(records.map(r => r.get('Plot Size')).filter(Boolean))];
      options = plots.map(p => `• ${p}`).join('\n');
      nextStage = 'asked_land_size';
    } else {
      // Get unique bedrooms
      const beds = [...new Set(records.map(r => parseInt(r.get('Bedrooms'))).filter(n => !isNaN(n)))].sort((a,b) => a-b);
      options = beds.map(b => `• ${b} bedroom${b > 1 ? 's' : ''}`).join('\n');
      nextStage = 'asked_size';
    }
    
    res.json({
      success: true,
      options: options,
      nextStage: nextStage,
      count: records.length
    });
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINT 3: Search Properties
// ============================================
app.post('/api/search-properties', async (req, res) => {
  try {
    const { tenantId, interest, location, bedrooms, plotSize, budget } = req.body;
    
    // Build filter formula
    let filter = `AND({TenantID} = '${tenantId}', {Type} = '${interest}', {Location} = '${location}', {Available} = 1`;
    
    if (interest === 'Land') {
      filter += `, {Plot Size} = '${plotSize}'`;
    } else {
      filter += `, {Bedrooms} = ${bedrooms}`;
    }
    
    if (budget) {
      filter += `, {Price} <= ${budget}`;
    }
    
    filter += ')';
    
    // Search
    const records = await base('Properties')
      .select({
        filterByFormula: filter,
        maxRecords: 10,
        sort: [{ field: 'Price', direction: 'asc' }]
      })
      .all();
    
    // Format properties
    const properties = records.map((record, index) => ({
      number: index + 1,
      id: record.id,
      name: record.get('Property Name'),
      price: record.get('Price'),
      bedrooms: record.get('Bedrooms'),
      location: record.get('Location'),
      address: record.get('Address'),
      plotSize: record.get('Plot Size'),
      type: record.get('Type')
    }));
    
    res.json({
      success: true,
      properties: properties,
      count: properties.length
    });
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINT 4: Calculate Available Slots
// ============================================
app.post('/api/available-slots', async (req, res) => {
  try {
    const { propertyId, bookedEvents = [], workStart = 9, workEnd = 17, daysAhead = 7 } = req.body;
    
    const now = new Date();
    const minSlotTime = new Date(now.getTime() + (60 * 60 * 1000)); // 1 hour buffer
    const freeSlots = [];
    
    // Parse booked events
    const booked = bookedEvents
      .filter(e => e.propertyId === propertyId)
      .map(e => ({
        start: new Date(e.start),
        end: new Date(e.end)
      }));
    
    // Check if slot overlaps with any booking
    const overlaps = (start, end) => {
      return booked.some(b => start < b.end && end > b.start);
    };
    
    // Generate slots
    for (let i = 0; i < daysAhead && freeSlots.length < 5; i++) {
      const day = new Date(now);
      day.setDate(day.getDate() + i);
      day.setHours(0, 0, 0, 0);
      
      // Skip weekends
      if (day.getDay() === 0 || day.getDay() === 6) continue;
      
      for (let h = workStart; h < workEnd && freeSlots.length < 5; h++) {
        const slotStart = new Date(day);
        slotStart.setHours(h, 0, 0, 0);
        
        const slotEnd = new Date(slotStart);
        slotEnd.setMinutes(slotEnd.getMinutes() + 60);
        
        // Skip past slots and overlapping slots
        if (slotStart <= minSlotTime) continue;
        if (overlaps(slotStart, slotEnd)) continue;
        
        freeSlots.push({
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),
          displayDate: slotStart.toLocaleDateString('en-KE'),
          displayTime: slotStart.toLocaleTimeString('en-KE', { 
            hour: 'numeric', 
            minute: '2-digit',
            hour12: true 
          })
        });
      }
    }
    
    // Format message
    const message = freeSlots.length > 0
      ? `📅 Available viewings:\n\n` + 
        freeSlots.map((s, i) => `${i+1}️⃣ ${s.displayDate}, ${s.displayTime}`).join('\n') +
        `\n\nReply with slot number.`
      : 'No available slots in the next 7 days.';
    
    res.json({
      success: true,
      slots: freeSlots,
      message: message,
      count: freeSlots.length
    });
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Property Bot API running on port ${PORT}`);
});