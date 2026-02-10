// server.js - Updated Property Bot Backend
require('dotenv').config();
const express = require('express');
const Airtable = require('airtable');
const { google } = require('googleapis');
const handleMessage = require('./handleMessage'); // Import our main code logic

const app = express();
app.use(express.json());

// Configure Airtable
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

// Configure Google Calendar
const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}');
const auth = new google.auth.GoogleAuth({
  credentials: credentials,
  scopes: ['https://www.googleapis.com/auth/calendar']
});
const calendar = google.calendar({ version: 'v3', auth });
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'Property Bot API Running' });
});

// ============================================
// ENDPOINT 1: Handle Incoming Message (Main Logic)
// ============================================
app.post('/api/handle-message', async (req, res) => {
  try {
    // Map all inputs exactly as they come from the webhook (Make.com style)
    const input = {
      message: req.body['1.body'] || '',               // Webhook message
      from: req.body['1.from'] || '',                  // User phone
      lead_id: req.body['5.ID'] || '',                 // Airtable lead record
      lead_stage: req.body['5.conversation_stage'] || '',
      lead_interest: req.body['5.interest'] || '',
      lead_budget: req.body['5.budget'] || '',
      lead_location: req.body['5.location'] || '',
      lead_size: req.body['5.size'] || '',
      tenant_company_name: req.body['75.company'] || '',
      tenant_bot_name: req.body['75.bot_name'] || '',
      tenant_property_types: req.body['75.property_type'] || '',
      tenant_id: req.body['75.ID'] || ''
    };

    // Call our modular logic from handleMessage.js
    const response = await handleMessage(input);

    // Return the response back to the webhook caller
    res.json(response);

  } catch (error) {
    console.error('Error in /api/handle-message:', error);
    res.status(500).json({
      action: 'error',
      replyMessage: 'Oops! Something went wrong. Please try again later.'
    });
  }
});

// ============================================
// ENDPOINT 2: Get Available Locations
// ============================================
app.post('/api/locations', async (req, res) => {
  try {
    const { tenantId, interest } = req.body;
    
    const records = await base('Properties')
      .select({
        filterByFormula: `AND({TenantID} = '${tenantId}', {Type} = '${interest}', {Available} = 1)`,
        fields: ['Location']
      })
      .all();
    
    const locations = [...new Set(records.map(r => r.get('Location')).filter(Boolean))].sort();
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
// ENDPOINT 3: Get Available Sizes
// ============================================
app.post('/api/sizes', async (req, res) => {
  try {
    const { tenantId, interest, location } = req.body;
    
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
      const plots = [...new Set(records.map(r => r.get('Plot Size')).filter(Boolean))];
      options = plots.map(p => `• ${p}`).join('\n');
      nextStage = 'asked_land_size';
    } else {
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
// ENDPOINT 4: Search Properties
// ============================================
app.post('/api/search-properties', async (req, res) => {
  try {
    const { tenantId, interest, location, bedrooms, plotSize, budget } = req.body;
    
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
    
    const records = await base('Properties')
  .select({
    filterByFormula: filter,
    maxRecords: 3,  
    sort: [{ field: 'Price', direction: 'asc' }],
    fields: ['Property Name', 'Price', 'Bedrooms', 'Location', 'Address', 'Plot Size', 'Type', 'Photo URL']  // ← Add this!
  })
  .all();
    
    const properties = records.map((record, index) => ({
      number: index + 1,
      id: record.id,
      name: record.get('Property Name'),
      price: record.get('Price'),
      bedrooms: record.get('Bedrooms'),
      location: record.get('Location'),
      address: record.get('Address'),
      plotSize: record.get('Plot Size'),
      type: record.get('Type'),
      photoUrl: record.get('Photo URL') || ''
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
// ENDPOINT 5: Calculate Available Slots
// ============================================
app.post('/api/available-slots', async (req, res) => {
  try {
    const { propertyId, bookedEvents = [], workStart = 9, workEnd = 17, daysAhead = 7 } = req.body;
    
    const now = new Date();
    const minSlotTime = new Date(now.getTime() + (60 * 60 * 1000));
    const freeSlots = [];
    
    const booked = bookedEvents
      .filter(e => e.propertyId === propertyId)
      .map(e => ({
        start: new Date(e.start),
        end: new Date(e.end)
      }));
    
    const overlaps = (start, end) => {
      return booked.some(b => start < b.end && end > b.start);
    };
    
    for (let i = 0; i < daysAhead && freeSlots.length < 5; i++) {
      const day = new Date(now);
      day.setDate(day.getDate() + i);
      day.setHours(0, 0, 0, 0);
      
      if (day.getDay() === 0 || day.getDay() === 6) continue;
      
      for (let h = workStart; h < workEnd && freeSlots.length < 5; h++) {
        const slotStart = new Date(day);
        slotStart.setHours(h, 0, 0, 0);
        
        const slotEnd = new Date(slotStart);
        slotEnd.setMinutes(slotEnd.getMinutes() + 60);
        
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

// ============================================
// ENDPOINT 5: Get Available Slots (Route 3)
// ============================================
app.post('/api/available-slots-v2', async (req, res) => {
  try {
    const { propertyId, leadId, workStart = 9, workEnd = 17, daysAhead = 7 } = req.body;
    
    // Get property details
    const propertyRecord = await base('Properties').find(propertyId);
    const propertyName = propertyRecord.get('Property Name');
    
    // Search Google Calendar for events with this property ID
    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + daysAhead);
    
    const calendarResponse = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: now.toISOString(),
      timeMax: endDate.toISOString(),
      q: propertyId, // Search for property ID in event
      singleEvents: true,
      orderBy: 'startTime'
    });
    
    const bookedEvents = calendarResponse.data.items || [];
    
    // Convert to simple format
    const booked = bookedEvents.map(event => ({
      start: new Date(event.start.dateTime || event.start.date),
      end: new Date(event.end.dateTime || event.end.date)
    }));
    
    // Calculate free slots
    const minSlotTime = new Date(now.getTime() + (60 * 60 * 1000)); // 1 hour buffer
    const freeSlots = [];
    
    function overlaps(start, end) {
      return booked.some(b => start < b.end && end > b.start);
    }
    
    function isWeekend(d) {
      const day = d.getDay();
      return day === 0 || day === 6;
    }
    
    // Generate slots
    for (let i = 0; i < daysAhead && freeSlots.length < 5; i++) {
      const day = new Date(now);
      day.setDate(day.getDate() + i);
      day.setHours(0, 0, 0, 0);
      
      if (isWeekend(day)) continue;
      
      for (let h = workStart; h < workEnd && freeSlots.length < 5; h++) {
        const slotStart = new Date(day);
        slotStart.setHours(h, 0, 0, 0);
        
        const slotEnd = new Date(slotStart);
        slotEnd.setMinutes(slotEnd.getMinutes() + 60);
        
        if (slotStart <= minSlotTime) continue;
        if (overlaps(slotStart, slotEnd)) continue;
        
        freeSlots.push({
          number: freeSlots.length + 1,
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),
          displayDate: slotStart.toLocaleDateString('en-KE', { 
            weekday: 'short', 
            month: 'short', 
            day: 'numeric' 
          }),
          displayTime: slotStart.toLocaleTimeString('en-KE', { 
            hour: 'numeric', 
            minute: '2-digit',
            hour12: true 
          })
        });
      }
    }
    
    // Create slot map for storage
    const slotMap = {};
    freeSlots.forEach(slot => {
      slotMap[slot.number] = `${slot.start}|${slot.end}`;
    });
    
    // Format message
    const message = freeSlots.length > 0
      ? `📅 Available viewings:\n\n` + 
        freeSlots.map(s => `${s.number}️⃣ ${s.displayDate}, ${s.displayTime}`).join('\n') +
        `\n\nReply with slot number.`
      : 'No available slots in the next 7 days. Please contact our agent.';
    
    res.json({
      success: true,
      slots: freeSlots,
      slotMap: JSON.stringify(slotMap),
      message: message,
      count: freeSlots.length,
      propertyName: propertyName
    });
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINT 6: Create Booking (Route 4)
// ============================================
app.post('/api/create-booking', async (req, res) => {
  try {
    const { leadId, propertyId, slotNumber, slotMap, leadName, leadPhone } = req.body;
    
    // Parse slot map
    const slots = JSON.parse(slotMap);
    const slotData = slots[slotNumber];
    
    if (!slotData) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid slot number' 
      });
    }
    
    const [startTime, endTime] = slotData.split('|');
    const slotStart = new Date(startTime);
    const slotEnd = new Date(endTime);
    
    // Check if slot is still available (collision detection)
    const existingEvents = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: slotStart.toISOString(),
      timeMax: slotEnd.toISOString(),
      q: propertyId,
      singleEvents: true
    });
    
    if (existingEvents.data.items && existingEvents.data.items.length > 0) {
      // Slot is taken! Recalculate new slots
      const recalcResponse = await fetch(`http://localhost:${process.env.PORT || 3000}/api/available-slots-v2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId, leadId })
      });
      
      const newSlots = await recalcResponse.json();
      
      return res.json({
        success: false,
        slotTaken: true,
        newSlots: newSlots.slots,
        newSlotMap: newSlots.slotMap,
        message: newSlots.message
      });
    }
    
    // Get property details
    const propertyRecord = await base('Properties').find(propertyId);
    const propertyName = propertyRecord.get('Property Name');
    const propertyAddress = propertyRecord.get('Address');
    const agentEmail = propertyRecord.get('Agent Email');
    
    // Create Google Calendar event
    const event = {
      summary: `Property Viewing - ${propertyName}`,
      description: `Client: ${leadName}\nPhone: ${leadPhone}\nProperty ID: ${propertyId}`,
      location: propertyAddress,
      start: {
        dateTime: slotStart.toISOString(),
        timeZone: 'Africa/Nairobi'
      },
      end: {
        dateTime: slotEnd.toISOString(),
        timeZone: 'Africa/Nairobi'
      },
      attendees: agentEmail ? [{ email: agentEmail }] : []
    };
    
    const calendarEvent = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      resource: event,
      sendUpdates: 'all'
    });
    
    // Create Airtable booking record
    const bookingRecord = await base('Bookings').create({
      'Lead': [leadId],
      'Property': [propertyId],
      'Scheduled Time': slotStart.toISOString(),
      'Status': 'Scheduled',
      'Google Event ID': calendarEvent.data.id,
      'SlotKey': `${propertyId}_${slotStart.toISOString()}`
    });
    
    // Format confirmation message
    const confirmMessage = `✅ *Viewing Confirmed!*\n\n` +
      `🏠 *Property:* ${propertyName}\n` +
      `📅 *Date:* ${slotStart.toLocaleDateString('en-KE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}\n` +
      `⏰ *Time:* ${slotStart.toLocaleTimeString('en-KE', { hour: 'numeric', minute: '2-digit', hour12: true })}\n` +
      `📍 *Location:* ${propertyAddress}\n\n` +
      `We'll send you a reminder. See you there! 🎉\n\n` +
      `To cancel, reply *CANCEL*`;
    
    res.json({
      success: true,
      slotTaken: false,
      bookingId: bookingRecord.id,
      eventId: calendarEvent.data.id,
      message: confirmMessage,
      agentEmail: agentEmail,
      slotDetails: {
        date: slotStart.toLocaleDateString('en-KE'),
        time: slotStart.toLocaleTimeString('en-KE'),
        property: propertyName,
        address: propertyAddress
      }
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