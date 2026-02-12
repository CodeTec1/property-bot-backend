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
// ENDPOINT 4: Search Properties (WITH DEBUG LOGGING)
// ============================================
app.post('/api/search-properties', async (req, res) => {
  try {
    const { tenantId, interest, location, bedrooms, plotSize, budget } = req.body;
    
    console.log('========================================');
    console.log('PROPERTY SEARCH REQUEST:');
    console.log('Input data:', JSON.stringify(req.body, null, 2));
    console.log('tenantId:', tenantId);
    console.log('interest:', interest);
    console.log('location:', location);
    console.log('bedrooms:', bedrooms, typeof bedrooms);
    console.log('plotSize:', plotSize, typeof plotSize);
    console.log('budget:', budget);
    
    if (!tenantId || !interest || !location) {
      console.log('ERROR: Missing required fields');
      return res.status(400).json({ 
        success: false, 
        error: 'tenantId, interest, and location are required' 
      });
    }
    
    // Build filter - Match on Type, Location, Size, Available ONLY (no budget!)
    let filter;
    
    console.log('Building filter for interest:', interest);
    
    if (interest === 'Land') {
      console.log('LAND SEARCH - Using plotSize:', plotSize);
      // Land search - flexible matching for plot size (strips spaces, case insensitive)
      // Matches: "1/4" → "1/4 Acre", "50x100" → "50 x 100", etc.
      const cleanPlotSize = plotSize.replace(/\s+/g, '').toLowerCase();
      console.log('Cleaned plot size for search:', cleanPlotSize);
      
      filter = `AND(
        {Type} = "Land",
        {Location} = "${location}",
        FIND("${cleanPlotSize}", LOWER(SUBSTITUTE({Plot Size}, " ", ""))),
        {Available} = TRUE(),
        SEARCH("${tenantId}", ARRAYJOIN({TenantID}))
      )`;
    } else {
      console.log('HOUSE SEARCH - Using bedrooms:', bedrooms);
      // House/Apartment search
      let bedroomNumber = bedrooms;
      if (typeof bedrooms === 'string') {
        const match = bedrooms.match(/\d+/);
        bedroomNumber = match ? parseInt(match[0]) : bedrooms;
      }
      
      console.log('Extracted bedroom number:', bedroomNumber);
      
      filter = `AND(
        {Type} = "${interest}",
        {Bedrooms} = ${parseInt(bedroomNumber)},
        {Location} = "${location}",
        {Available} = TRUE(),
        SEARCH("${tenantId}", ARRAYJOIN({TenantID}))
      )`;
    }
    
    // NO BUDGET FILTER! Just return all matching properties sorted by price
    
    console.log('FINAL FILTER:');
    console.log(filter);
    console.log('========================================');
    
    const records = await base('Properties')
      .select({
        filterByFormula: filter,
        maxRecords: 3, // Return up to 10 properties (not limited by budget anymore)
        sort: [{ field: 'Price', direction: 'asc' }], // Cheapest first!
        fields: ['Property Name', 'Price', 'Bedrooms', 'Location', 'Address', 'Plot Size', 'Type', 'Photo URL']
      })
      .all();
    
    console.log('Airtable returned', records.length, 'records');
    
    if (records.length > 0) {
      console.log('First record:', {
        id: records[0].id,
        name: records[0].get('Property Name'),
        price: records[0].get('Price'),
        type: records[0].get('Type'),
        location: records[0].get('Location'),
        bedrooms: records[0].get('Bedrooms'),
        plotSize: records[0].get('Plot Size')
      });
    } else {
      console.log('NO RECORDS FOUND!');
      console.log('Filter used:', filter);
    }
    
    // Sort again to be absolutely sure (Airtable sometimes doesn't respect sort)
    const sortedRecords = records.sort((a, b) => {
      const priceA = a.get('Price') || 0;
      const priceB = b.get('Price') || 0;
      return priceA - priceB;
    });
    
    console.log('After sorting, order is:');
    sortedRecords.forEach((r, i) => {
      console.log(`  ${i+1}. ${r.get('Property Name')} - ${r.get('Price')}`);
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
    
    console.log('RESPONSE:');
    console.log('Returning', properties.length, 'properties');
    console.log('Properties:', JSON.stringify(properties, null, 2));
    console.log('========================================');
    
    res.json({
      success: true,
      properties: properties,
      count: properties.length
    });
    
  } catch (error) {
    console.error('ERROR in search-properties:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINT 5: Get Available Slots (Multi-Tenant) WITH DEBUG
// ============================================

app.post('/api/available-slots-v2', async (req, res) => {
  try {
    const { 
      propertyId, 
      leadId, 
      calendarId,
      workStart,      // Airtable datetime string
      workEnd,        // Airtable datetime string
      daysAhead,      // number from tenant table
      workingDays     // string like "Mon, Tue, Wed, Sat"
    } = req.body;

    console.log('========================================');
    console.log('SLOT CALCULATION REQUEST:');
    console.log('Input data:', JSON.stringify(req.body, null, 2));
    console.log('propertyId:', propertyId);
    console.log('calendarId:', calendarId);
    console.log('workStart:', workStart, 'workEnd:', workEnd);
    console.log('daysAhead:', daysAhead);
    console.log('workingDays:', workingDays);

    // Validate required fields
    if (!propertyId) return res.status(400).json({ success: false, error: 'Property ID is required' });
    if (!calendarId) return res.status(400).json({ success: false, error: 'Calendar ID is required' });

    // Fetch property record
    let propertyRecord;
    try {
      propertyRecord = await base('Properties').find(propertyId);
      console.log('Property found:', propertyRecord.get('Property Name'));
    } catch (err) {
      return res.status(404).json({ success: false, error: `Property not found: ${propertyId}` });
    }
    const propertyName = propertyRecord.get('Property Name');

    // Parse workStart/workEnd to hours
    const workStartHour = workStart ? new Date(workStart).getHours() : 9;
    const workEndHour = workEnd ? new Date(workEnd).getHours() : 17;

    // Parse workingDays into lowercase 3-letter abbreviations
    const workingDaysArray = workingDays
      ? workingDays.split(',').map(d => d.trim().slice(0,3).toLowerCase())
      : ['mon','tue','wed','thu','fri'];

    // Fetch booked events from Google Calendar
    const now = new Date();
    const searchEnd = new Date(now);
    searchEnd.setDate(searchEnd.getDate() + Number(daysAhead || 7));

    console.log('Current time (Kenya):', now.toLocaleString('en-KE'));
    console.log('Searching calendar from:', now.toISOString());
    console.log('Searching calendar to:', searchEnd.toISOString());
    console.log('Calendar ID:', calendarId);

    let calendarResponse;
    try {
      calendarResponse = await calendar.events.list({
        calendarId,
        timeMin: now.toISOString(),
        timeMax: searchEnd.toISOString(),
        q: propertyId,
        singleEvents: true,
        orderBy: 'startTime'
      });
      console.log('Calendar API response received');
    } catch (calErr) {
      console.error('Calendar API ERROR:', calErr.message);
      return res.status(500).json({ success: false, error: 'Failed to access calendar: ' + calErr.message });
    }

    const bookedEvents = calendarResponse.data.items || [];
    console.log('Booked events found:', bookedEvents.length);

    const booked = bookedEvents.map(event => ({
      start: new Date(event.start.dateTime || event.start.date),
      end: new Date(event.end.dateTime || event.end.date)
    }));

    const minSlotTime = new Date(now.getTime() + 60*60*1000); // 1 hour buffer
    const freeSlots = [];
    const MAX_SEARCH_DAYS = 30;

    console.log('Starting slot generation...');
    console.log('Work hours:', workStartHour, 'to', workEndHour);
    console.log('Working days:', workingDaysArray.join(', '));

    const overlaps = (start, end) => booked.some(b => start < b.end && end > b.start);

    const dayNameMap = ['sun','mon','tue','wed','thu','fri','sat'];

    let daysChecked = 0, slotsSkippedPast = 0, slotsSkippedWeekend = 0, slotsSkippedOverlap = 0;

    for (let i = 0; i < MAX_SEARCH_DAYS && freeSlots.length < 5; i++) {
      const day = new Date(now);
      day.setDate(day.getDate() + i);
      day.setHours(0,0,0,0);
      daysChecked++;

      const dayAbbr = dayNameMap[day.getDay()];
      if (!workingDaysArray.includes(dayAbbr)) {
        console.log(`Day ${i+1} (${dayAbbr}): Skipped - not a working day`);
        slotsSkippedWeekend++;
        continue;
      }

      console.log(`Day ${i+1} (${day.toDateString()}): Checking slots...`);
      for (let h = workStartHour; h < workEndHour && freeSlots.length < 5; h++) {
        const slotStart = new Date(day);
        slotStart.setHours(h,0,0,0);
        const slotEnd = new Date(slotStart);
        slotEnd.setMinutes(slotEnd.getMinutes() + 60);

        if (slotStart <= minSlotTime) {
          slotsSkippedPast++;
          continue;
        }

        if (overlaps(slotStart, slotEnd)) {
          slotsSkippedOverlap++;
          continue;
        }

        freeSlots.push({
          number: freeSlots.length + 1,
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),
          displayDate: slotStart.toLocaleDateString('en-KE', { weekday:'short', month:'short', day:'numeric' }),
          displayTime: slotStart.toLocaleTimeString('en-KE', { hour:'numeric', minute:'2-digit', hour12:true })
        });
      }
    }

    console.log('Slot generation complete:');
    console.log('Days checked:', daysChecked);
    console.log('Slots skipped (past):', slotsSkippedPast);
    console.log('Slots skipped (non-working):', slotsSkippedWeekend);
    console.log('Slots skipped (overlapping):', slotsSkippedOverlap);
    console.log('FREE SLOTS FOUND:', freeSlots.length);

    const slotMap = {};
    freeSlots.forEach(slot => {
      slotMap[slot.number] = `${slot.start}|${slot.end}`;
    });

    const message = freeSlots.length > 0
      ? `📅 Available viewings:\n\n` +
        freeSlots.map(s => `${s.number}️⃣ ${s.displayDate}, ${s.displayTime}`).join('\n') +
        `\n\nReply with slot number.`
      : `Sorry, no available slots found in the next ${MAX_SEARCH_DAYS} days.\n\nOur agent will contact you to arrange a viewing!\n\nReply HI to search for more properties.`;

    res.json({
      success: true,
      slots: freeSlots,
      slotMap: JSON.stringify(slotMap),
      message,
      count: freeSlots.length,
      propertyName
    });

  } catch (error) {
    console.error('ERROR in available-slots-v2:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({ success: false, error: error.message });
  }
});


// ============================================
// ENDPOINT 6: Create Booking (Multi-Tenant) WITH DEBUG
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
    
    console.log('========================================');
    console.log('CREATE BOOKING REQUEST:');
    console.log('Input data:', JSON.stringify(req.body, null, 2));
    console.log('leadId:', leadId, '(type:', typeof leadId, ')');
    console.log('propertyId:', propertyId, '(type:', typeof propertyId, ')');
    console.log('slotNumber:', slotNumber, '(type:', typeof slotNumber, ')');
    console.log('slotMap:', slotMap ? 'Present' : 'MISSING', '(type:', typeof slotMap, ')');
    console.log('leadName:', leadName, '(type:', typeof leadName, ')');
    console.log('leadPhone:', leadPhone, '(type:', typeof leadPhone, ')');
    console.log('calendarId:', calendarId, '(type:', typeof calendarId, ')');
    
    // Validate required fields
    const missingFields = [];
    if (!leadId) missingFields.push('leadId');
    if (!propertyId) missingFields.push('propertyId');
    if (!slotNumber) missingFields.push('slotNumber');
    if (!slotMap) missingFields.push('slotMap');
    if (!calendarId) missingFields.push('calendarId');
    
    if (missingFields.length > 0) {
      console.log('ERROR: Missing fields:', missingFields.join(', '));
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: ' + missingFields.join(', ')
      });
    }
    
    console.log('All required fields present ✓');
    
    // ============================================
    // SAFE SLOT MAP HANDLING (UPDATED)
    // ============================================
    console.log('Processing slot map...');
    let slots = slotMap;

    // If Make sends string → parse
    if (typeof slotMap === 'string') {
      try {
        slots = JSON.parse(slotMap);
        console.log('Slot map parsed from string ✓');
      } catch (err) {
        console.log('ERROR: Failed to parse slotMap string');
        console.log('slotMap value:', slotMap);
        console.log('Parse error:', err.message);
        return res.status(400).json({ 
          success: false, 
          error: 'Invalid slot map format' 
        });
      }
    }

    // Validate final structure
    if (typeof slots !== 'object' || Array.isArray(slots)) {
      console.log('ERROR: slotMap is not a valid object');
      return res.status(400).json({ 
        success: false, 
        error: 'slotMap must be a valid object' 
      });
    }

    console.log('Available slot numbers:', Object.keys(slots).join(', '));

    const slotData = slots[slotNumber];

    if (!slotData) {
      console.log('ERROR: Invalid slot number');
      console.log('Requested slot:', slotNumber);
      console.log('Available slots:', Object.keys(slots).join(', '));
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid slot number. Available: ' + Object.keys(slots).join(', ')
      });
    }

    if (!slotData.includes('|')) {
      console.log('ERROR: Invalid slot format at slot', slotNumber);
      return res.status(400).json({
        success: false,
        error: 'Invalid slot format'
      });
    }

    console.log('Slot data found:', slotData);

    const [startTime, endTime] = slotData.split('|');
    const slotStart = new Date(startTime);
    const slotEnd = new Date(endTime);

    console.log('Slot time:', slotStart.toLocaleString('en-KE'), 'to', slotEnd.toLocaleString('en-KE'));

    // ============================================
    // Continue with your original logic
    // ============================================

    console.log('Checking for booking conflicts...');
    console.log('Calendar ID:', calendarId);
    
    let existingEvents;
    try {
      existingEvents = await calendar.events.list({
        calendarId: calendarId,
        timeMin: slotStart.toISOString(),
        timeMax: slotEnd.toISOString(),
        q: propertyId,
        singleEvents: true
      });
      console.log('Calendar checked - found', existingEvents.data.items?.length || 0, 'conflicting events');
    } catch (calErr) {
      console.error('Calendar API ERROR:', calErr.message);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to check calendar: ' + calErr.message 
      });
    }
    
    if (existingEvents.data.items && existingEvents.data.items.length > 0) {
      console.log('SLOT TAKEN!');
      return res.json({
        success: false,
        slotTaken: true,
        message: "⚠️ Sorry, that time slot was just taken by another client!\n\nLet me show you the updated available times..."
      });
    }
    
    console.log('Slot is free! Proceeding with booking...');
    
    const propertyRecord = await base('Properties').find(propertyId);
    const propertyName = propertyRecord.get('Property Name');
    const propertyAddress = propertyRecord.get('Address');
    const agentEmail = propertyRecord.get('Agent Email');
    const agentPhone = propertyRecord.get('Agent Phone');
    const agentName = propertyRecord.get('Agent Name');
    
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
    
    let calendarEvent;
    try {
      calendarEvent = await calendar.events.insert({
        calendarId: calendarId,
        resource: event,
        sendUpdates: 'all'
      });
    } catch (calErr) {
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to create calendar event: ' + calErr.message 
      });
    }
    
    let bookingRecord;
    try {
      bookingRecord = await base('Bookings').create({
  'Lead': [leadId],
  'Property': [propertyId],
  'StartDateTime': slotStart.toISOString(),
  'EndDateTime': slotEnd.toISOString(),
  'Status': 'Scheduled',
  'Google Event ID': calendarEvent.data.id
});

    } catch (airtableErr) {
      try {
        await calendar.events.delete({
          calendarId: calendarId,
          eventId: calendarEvent.data.id
        });
      } catch {}
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to create booking: ' + airtableErr.message 
      });
    }
    
    res.json({
      success: true,
      slotTaken: false,
      bookingId: bookingRecord.id,
      eventId: calendarEvent.data.id
    });
    
  } catch (error) {
    console.error('ERROR in create-booking:', error);
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