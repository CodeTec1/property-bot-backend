// server.js - Complete Multi-Tenant Property Bot Backend
require('dotenv').config();
const express = require('express');
const Airtable = require('airtable');
const { google } = require('googleapis');
const handleMessage = require('./handleMessage');

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

// Tenant cache (in-memory, expires after 1 hour)
const tenantCache = {};
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

function getCachedTenant(tenantId) {
  const cached = tenantCache[tenantId];
  if (cached && (Date.now() - cached.timestamp < CACHE_DURATION)) {
    return cached.data;
  }
  return null;
}

function cacheTenant(tenantId, data) {
  tenantCache[tenantId] = {
    data: data,
    timestamp: Date.now()
  };
}

// ============================================
// Health Check
// ============================================
app.get('/', (req, res) => {
  res.json({ 
    status: 'Property Bot API Running',
    version: '2.0.0',
    endpoints: [
      '/api/handle-message',
      '/api/locations',
      '/api/sizes',
      '/api/search-properties',
      '/api/available-slots-v2',
      '/api/create-booking',
      '/api/cancel-booking'
    ]
  });
});

// ============================================
// ENDPOINT 1: Handle Conversation Logic
// ============================================
app.post('/api/handle-message', async (req, res) => {
  try {
    const result = await handleMessage(req.body);
    res.json(result);
  } catch (error) {
    console.error('Error in handle-message:', error);
    res.status(500).json({ 
      action: "error",
      replyMessage: "Sorry, something went wrong. Please try again or send HI to restart."
    });
  }
});

// ============================================
// ENDPOINT 2: Get Available Locations
// ============================================
app.post('/api/locations', async (req, res) => {
  try {
    const { tenantId, interest } = req.body;
    
    if (!tenantId || !interest) {
      return res.status(400).json({ 
        success: false, 
        error: 'tenantId and interest are required' 
      });
    }
    
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
      formatted: formatted || "• No locations available",
      count: locations.length
    });
    
  } catch (error) {
    console.error('Error in locations:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINT 3: Get Available Sizes
// ============================================
app.post('/api/sizes', async (req, res) => {
  try {
    const { tenantId, interest, location } = req.body;
    
    if (!tenantId || !interest || !location) {
      return res.status(400).json({ 
        success: false, 
        error: 'tenantId, interest, and location are required' 
      });
    }
    
    const records = await base('Properties')
      .select({
        filterByFormula: `AND({TenantID} = '${tenantId}', {Type} = '${interest}', {Location} = '${location}', {Available} = 1)`,
        fields: ['Bedrooms', 'Plot Size', 'Type']
      })
      .all();
    
    if (records.length === 0) {
      return res.json({
        success: false,
        hasOptions: false,
        options: "• No properties available in this location",
        nextStage: interest === 'Land' ? 'asked_land_size' : 'asked_size',
        message: `Sorry, we don't have any ${interest.toLowerCase()} properties in ${location} right now.`
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
      hasOptions: true,
      options: options,
      nextStage: nextStage,
      count: records.length
    });
    
  } catch (error) {
    console.error('Error in sizes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINT 4: Search Properties
// ============================================
app.post('/api/search-properties', async (req, res) => {
  try {
    const { tenantId, interest, location, bedrooms, plotSize, budget } = req.body;
    
    if (!tenantId || !interest || !location) {
      return res.status(400).json({ 
        success: false, 
        error: 'tenantId, interest, and location are required' 
      });
    }
    
    // Build filter - EXACTLY matching the working Airtable formula
    let filter;
    
    if (interest === 'Land') {
      // Land search with LOWER() for fuzzy matching
      filter = `AND(
        {Type} = "Land",
        {Location} = "${location}",
        FIND(LOWER("${plotSize}"), LOWER({Plot Size})),
        {Available} = TRUE(),
        {TenantID} = "${tenantId}"
      )`;
    } else {
      // House/Apartment search
      let bedroomNumber = bedrooms;
      if (typeof bedrooms === 'string') {
        const match = bedrooms.match(/\d+/);
        bedroomNumber = match ? parseInt(match[0]) : bedrooms;
      }
      
      filter = `AND(
        {Type} = "${interest}",
        {Bedrooms} = ${parseInt(bedroomNumber)},
        {Location} = "${location}",
        {Available} = TRUE(),
        {TenantID} = "${tenantId}"
      )`;
    }
    
    // Add budget filter if provided
    if (budget) {
      // Wrap existing filter in another AND with budget
      filter = `AND(${filter}, {Price} <= ${budget})`;
    }
    
    console.log('Search filter:', filter); // DEBUG LOG
    
    const records = await base('Properties')
      .select({
        filterByFormula: filter,
        maxRecords: 3,
        sort: [{ field: 'Price', direction: 'asc' }],
        fields: ['Property Name', 'Price', 'Bedrooms', 'Location', 'Address', 'Plot Size', 'Type', 'Photo URL']
      })
      .all();
    
    // Sort again to be absolutely sure (Airtable sometimes doesn't respect sort)
    const sortedRecords = records.sort((a, b) => {
      const priceA = a.get('Price') || 0;
      const priceB = b.get('Price') || 0;
      return priceA - priceB;
    });
    
    const properties = sortedRecords.map((record, index) => ({
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
    console.error('Error in search-properties:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINT 5: Get Available Slots (Multi-Tenant)
// ============================================
app.post('/api/available-slots-v2', async (req, res) => {
  try {
    const { 
      propertyId, 
      leadId, 
      calendarId,
      workStart = 9, 
      workEnd = 17, 
      daysAhead = 7,
      workingDays = "Monday, Tuesday, Wednesday, Thursday, Friday"
    } = req.body;
    
    // Validate
    if (!propertyId) {
      return res.status(400).json({ success: false, error: 'Property ID is required' });
    }
    if (!calendarId) {
      return res.status(400).json({ success: false, error: 'Calendar ID is required' });
    }
    
    // Get property details
    let propertyRecord;
    try {
      propertyRecord = await base('Properties').find(propertyId);
    } catch (err) {
      return res.status(404).json({ success: false, error: `Property not found: ${propertyId}` });
    }
    
    const propertyName = propertyRecord.get('Property Name');
    
    // Search Google Calendar for booked events
    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + daysAhead);
    
    const calendarResponse = await calendar.events.list({
      calendarId: calendarId,
      timeMin: now.toISOString(),
      timeMax: endDate.toISOString(),
      q: propertyId,
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
    const MAX_SEARCH_DAYS = 30; // Keep searching for up to 30 days
    
    function overlaps(start, end) {
      return booked.some(b => start < b.end && end > b.start);
    }
    
    function isWorkingDay(d, workingDaysStr) {
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const dayName = dayNames[d.getDay()];
      return workingDaysStr.includes(dayName);
    }
    
    // Generate slots - keep searching until we have 5 slots OR reach max days
    for (let i = 0; i < MAX_SEARCH_DAYS && freeSlots.length < 5; i++) {
      const day = new Date(now);
      day.setDate(day.getDate() + i);
      day.setHours(0, 0, 0, 0);
      
      if (!isWorkingDay(day, workingDays)) continue;
      
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
      : `Sorry, no available slots found in the next ${MAX_SEARCH_DAYS} days.\n\nOur agent will contact you to arrange a viewing!\n\nReply HI to search for more properties.`;
    
    console.log(`Slot search: Found ${freeSlots.length} slots for property ${propertyId}`); // DEBUG
    
    res.json({
      success: true,
      slots: freeSlots,
      slotMap: JSON.stringify(slotMap),
      message: message,
      count: freeSlots.length,
      propertyName: propertyName
    });
    
  } catch (error) {
    console.error('Error in available-slots-v2:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINT 6: Create Booking (Multi-Tenant)
// ============================================
app.post('/api/create-booking', async (req, res) => {
  try {
    const { 
      leadId, 
      propertyId, 
      slotNumber, 
      slotMap, 
      leadName, 
      leadPhone,
      calendarId 
    } = req.body;
    
    // Validate
    if (!leadId || !propertyId || !slotNumber || !slotMap || !calendarId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields' 
      });
    }
    
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
      calendarId: calendarId,
      timeMin: slotStart.toISOString(),
      timeMax: slotEnd.toISOString(),
      q: propertyId,
      singleEvents: true
    });
    
    if (existingEvents.data.items && existingEvents.data.items.length > 0) {
      // Slot is taken! Recalculate new slots
      return res.json({
        success: false,
        slotTaken: true,
        message: "⚠️ Sorry, that time slot was just taken by another client!\n\nLet me show you the updated available times..."
      });
    }
    
    // Get property details
    const propertyRecord = await base('Properties').find(propertyId);
    const propertyName = propertyRecord.get('Property Name');
    const propertyAddress = propertyRecord.get('Address');
    const agentEmail = propertyRecord.get('Agent Email');
    const agentPhone = propertyRecord.get('Agent Phone');
    const agentName = propertyRecord.get('Agent Name');
    
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
      calendarId: calendarId,
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
    
    const agentMessage = `🔔 *NEW VIEWING SCHEDULED*\n\n` +
      `📋 *CLIENT DETAILS:*\n` +
      `Name: ${leadName}\n` +
      `Phone: ${leadPhone}\n\n` +
      `🏠 *PROPERTY:*\n` +
      `${propertyName}\n` +
      `${propertyAddress}\n\n` +
      `📅 *SCHEDULED FOR:*\n` +
      `${slotStart.toLocaleDateString('en-KE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}\n` +
      `⏰ ${slotStart.toLocaleTimeString('en-KE', { hour: 'numeric', minute: '2-digit', hour12: true })}\n\n` +
      `✅ Added to your calendar`;
    
    res.json({
      success: true,
      slotTaken: false,
      bookingId: bookingRecord.id,
      eventId: calendarEvent.data.id,
      message: confirmMessage,
      agentMessage: agentMessage,
      agentEmail: agentEmail,
      agentPhone: agentPhone,
      agentName: agentName,
      slotDetails: {
        date: slotStart.toLocaleDateString('en-KE'),
        time: slotStart.toLocaleTimeString('en-KE'),
        property: propertyName,
        address: propertyAddress
      }
    });
    
  } catch (error) {
    console.error('Error in create-booking:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINT 7: Cancel Booking (Multi-Tenant)
// ============================================
app.post('/api/cancel-booking', async (req, res) => {
  try {
    const { leadId, calendarId } = req.body;
    
    // Validate
    if (!leadId) {
      return res.status(400).json({ success: false, error: 'Lead ID is required' });
    }
    if (!calendarId) {
      return res.status(400).json({ success: false, error: 'Calendar ID is required' });
    }
    
    // Search for active booking for this lead
    const bookings = await base('Bookings')
      .select({
        filterByFormula: `AND(SEARCH("${leadId}", ARRAYJOIN({Lead})), {Status} != "Cancelled")`,
        maxRecords: 1
      })
      .all();
    
    if (bookings.length === 0) {
      return res.json({
        success: false,
        noBooking: true,
        message: "You don't have any active bookings to cancel.\n\nReply HI to search for properties! 🏡"
      });
    }
    
    const booking = bookings[0];
    const eventId = booking.get('Google Event ID');
    const propertyId = booking.get('Property')[0];
    
    // Check if Google event exists
    if (!eventId) {
      return res.json({
        success: false,
        noEvent: true,
        message: "Booking found but no calendar event to delete."
      });
    }
    
    // Get property details
    const property = await base('Properties').find(propertyId);
    const propertyName = property.get('Property Name');
    const agentEmail = property.get('Agent Email');
    const agentPhone = property.get('Agent Phone');
    const agentName = property.get('Agent Name');
    
    // Get lead details
    const lead = await base('Leads').find(leadId);
    const leadName = lead.get('Name');
    const leadPhone = lead.get('Phone');
    
    // Get booking time
    const scheduledTime = new Date(booking.get('Scheduled Time'));
    
    // Delete Google Calendar event
    try {
      await calendar.events.delete({
        calendarId: calendarId,
        eventId: eventId
      });
    } catch (calErr) {
      console.error('Calendar deletion error:', calErr);
      // Continue anyway - update Airtable even if calendar fails
    }
    
    // Update booking status in Airtable
    await base('Bookings').update(booking.id, {
      'Status': 'Cancelled'
    });
    
    // Update lead conversation stage
    await base('Leads').update(leadId, {
      'Conversation Stage': 'booking_cancelled',
      'Status': 'Cancelled'
    });
    
    // Format messages
    const userMessage = `❌ *Viewing Cancelled*\n\n` +
      `Your viewing has been cancelled:\n\n` +
      `🏠 *Property:* ${propertyName}\n` +
      `📅 *Was scheduled for:* ${scheduledTime.toLocaleDateString('en-KE', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      })}\n` +
      `⏰ *Time:* ${scheduledTime.toLocaleTimeString('en-KE', { 
        hour: 'numeric', 
        minute: '2-digit', 
        hour12: true 
      })}\n\n` +
      `If you'd like to reschedule, reply *HI* to start over.`;
    
    const agentMessage = `🔔 *BOOKING CANCELLATION*\n\n` +
      `A viewing has been cancelled.\n\n` +
      `📋 *CLIENT DETAILS:*\n` +
      `Name: ${leadName}\n` +
      `Phone: ${leadPhone}\n\n` +
      `🏠 *PROPERTY:*\n` +
      `${propertyName}\n\n` +
      `📅 *Was scheduled for:*\n` +
      `${scheduledTime.toLocaleDateString('en-KE')} at ${scheduledTime.toLocaleTimeString('en-KE', { 
        hour: 'numeric', 
        minute: '2-digit' 
      })}\n\n` +
      `⏰ Cancelled at: ${new Date().toLocaleString('en-KE')}`;
    
    res.json({
      success: true,
      userMessage: userMessage,
      agentMessage: agentMessage,
      agentPhone: agentPhone,
      agentEmail: agentEmail,
      agentName: agentName,
      bookingDetails: {
        propertyName: propertyName,
        scheduledDate: scheduledTime.toLocaleDateString('en-KE'),
        scheduledTime: scheduledTime.toLocaleTimeString('en-KE'),
        leadName: leadName,
        leadPhone: leadPhone
      }
    });
    
  } catch (error) {
    console.error('Error in cancel-booking:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// Start Server
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Property Bot API running on port ${PORT}`);
  console.log(`📡 Endpoints ready:`);
  console.log(`   - POST /api/handle-message`);
  console.log(`   - POST /api/locations`);
  console.log(`   - POST /api/sizes`);
  console.log(`   - POST /api/search-properties`);
  console.log(`   - POST /api/available-slots-v2`);
  console.log(`   - POST /api/create-booking`);
  console.log(`   - POST /api/cancel-booking`);
});