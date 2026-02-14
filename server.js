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
// ENDPOINT 5: Get Available Slots - FINAL FIXED VERSION
// ============================================
app.post('/api/available-slots-v2', async (req, res) => {
  try {
    const { propertyId, leadId, tenantId } = req.body;
    
    console.log('========================================');
    console.log('SLOT CALCULATION REQUEST:');
    console.log('propertyId:', propertyId);
    console.log('tenantId:', tenantId);
    
    if (!propertyId || !tenantId) {
      return res.status(400).json({ success: false, error: 'propertyId and tenantId required' });
    }
    
    // 1. GET TENANT CONFIG
    const tenant = await base('Tenants').find(tenantId);
    
    const calendarId = tenant.get('Google Calendar ID');
    const workStart = parseInt(tenant.get('Work Start Hour') || 9);
    const workEnd = parseInt(tenant.get('Work End Hour') || 17);
    const slotDuration = parseInt(tenant.get('Slot Duration') || 60);
    const workingDaysRaw = tenant.get('Working Days') || "Monday, Tuesday, Wednesday, Thursday, Friday";
    const timezone = tenant.get('Time Zone') || 'Africa/Nairobi';
    const daysAhead = parseInt(tenant.get('Days Ahead') || 30);
    
    // Normalize working days
    let workingDaysStr;
    if (Array.isArray(workingDaysRaw)) {
      const dayMap = {
        'Mon': 'Monday', 'Tue': 'Tuesday', 'Wed': 'Wednesday',
        'Thu': 'Thursday', 'Fri': 'Friday', 'Sat': 'Saturday', 'Sun': 'Sunday'
      };
      workingDaysStr = workingDaysRaw.map(d => dayMap[d] || d).join(', ');
    } else {
      workingDaysStr = workingDaysRaw
        .replace(/\bMon\b/g, 'Monday').replace(/\bTue\b/g, 'Tuesday')
        .replace(/\bWed\b/g, 'Wednesday').replace(/\bThu\b/g, 'Thursday')
        .replace(/\bFri\b/g, 'Friday').replace(/\bSat\b/g, 'Saturday')
        .replace(/\bSun\b/g, 'Sunday');
    }
    
    console.log('CONFIG:');
    console.log('  Work: ', workStart + ':00 -', workEnd + ':00');
    console.log('  Duration:', slotDuration, 'min');
    console.log('  Days:', workingDaysStr);
    console.log('  Timezone:', timezone);
    
    // 2. GET PROPERTY
    const propertyRecord = await base('Properties').find(propertyId);
    const propertyName = propertyRecord.get('Property Name');
    
    // 3. GET BOOKED EVENTS
    const now = new Date();
    const searchEnd = new Date(now);
    searchEnd.setDate(searchEnd.getDate() + daysAhead);
    
    const calendarResponse = await calendar.events.list({
      calendarId: calendarId,
      timeMin: now.toISOString(),
      timeMax: searchEnd.toISOString(),
      q: propertyId,
      singleEvents: true,
      orderBy: 'startTime'
    });
    
    const booked = (calendarResponse.data.items || []).map(e => ({
      start: new Date(e.start.dateTime || e.start.date),
      end: new Date(e.end.dateTime || e.end.date)
    }));
    
    console.log('Booked events:', booked.length);
    
    // 4. GENERATE SLOTS
    const minSlotTime = new Date(now.getTime() + (60 * 60 * 1000)); // 1hr buffer
    const freeSlots = [];
    const MAX_SLOTS = 7;
    
    function overlaps(start, end) {
      return booked.some(b => start < b.end && end > b.start);
    }
    
    function isWorkingDay(d) {
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      return workingDaysStr.includes(dayNames[d.getDay()]);
    }
    
    console.log('Generating slots...');
    
    for (let dayOffset = 0; dayOffset < daysAhead && freeSlots.length < MAX_SLOTS; dayOffset++) {
      const day = new Date(now);
      day.setDate(day.getDate() + dayOffset);
      day.setHours(0, 0, 0, 0);
      
      if (!isWorkingDay(day)) {
        continue; // Skip non-working days silently
      }
      
      const dayStr = day.toLocaleDateString('en-KE', { timeZone: timezone });
      console.log(`Checking ${dayStr}...`);
      
      // Get timezone offset (Kenya is UTC+3)
      const KENYA_OFFSET_HOURS = 3;
      
      // Generate slots for this day
      for (let hour = workStart; hour < workEnd && freeSlots.length < MAX_SLOTS; ) {
        // Create slot start - adjust for Kenya timezone
        // If we want 9am in Kenya (UTC+3), that's 6am UTC
        const slotStart = new Date(day);
        slotStart.setUTCHours(hour - KENYA_OFFSET_HOURS, 0, 0, 0);
        
        // Create slot end
        const slotEnd = new Date(slotStart);
        slotEnd.setMinutes(slotEnd.getMinutes() + slotDuration);
        
        // Display in Kenya time
        const startStr = slotStart.toLocaleTimeString('en-KE', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true });
        const endStr = slotEnd.toLocaleTimeString('en-KE', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true });
        
        console.log(`  ${hour}:00 Kenya → UTC ${slotStart.getUTCHours()}:00 → displays as ${startStr}`);
        
        // Skip if in the past
        if (slotStart <= minSlotTime) {
          console.log(`  ${startStr}: PAST`);
          hour++; // Move to next hour
          continue;
        }
        
        // Skip if end time goes beyond work hours
        const endHour = slotEnd.getHours();
        const endMinute = slotEnd.getMinutes();
        if (endHour > workEnd || (endHour === workEnd && endMinute > 0)) {
          console.log(`  ${startStr}: END (${endStr}) beyond work hours`);
          break; // No more slots today
        }
        
        // Skip if overlaps
        if (overlaps(slotStart, slotEnd)) {
          console.log(`  ${startStr}: BOOKED`);
          hour++; // Move to next hour
          continue;
        }
        
        // FREE SLOT!
        console.log(`  ${startStr} - ${endStr}: ✅ FREE`);
        
        freeSlots.push({
          number: freeSlots.length + 1,
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),
          displayDate: slotStart.toLocaleDateString('en-KE', { 
            timeZone: timezone,
            weekday: 'short', 
            month: 'short', 
            day: 'numeric' 
          }),
          displayTime: slotStart.toLocaleTimeString('en-KE', { 
            timeZone: timezone,
            hour: 'numeric', 
            minute: '2-digit',
            hour12: true 
          })
        });
        
        // Move to next slot based on duration
        const nextHour = Math.floor((hour * 60 + slotDuration) / 60);
        hour = nextHour;
      }
    }
    
    console.log('Found', freeSlots.length, 'free slots');
    console.log('========================================');
    
    // 5. CREATE SLOT MAP
    const slotMap = {};
    freeSlots.forEach(slot => {
      slotMap[slot.number] = `${slot.start}|${slot.end}`;
    });
    
    // 6. RETURN
    const message = freeSlots.length > 0
      ? `📅 Available viewings:\n\n` + 
        freeSlots.map(s => `${s.number}️⃣ ${s.displayDate}, ${s.displayTime}`).join('\n') +
        `\n\nReply with slot number.`
      : `No available slots in the next ${daysAhead} days.\n\nOur agent will contact you!`;
    
    res.json({
      success: true,
      slots: freeSlots,
      slotMap: JSON.stringify(slotMap),
      message: message,
      count: freeSlots.length,
      propertyName: propertyName
    });
    
  } catch (error) {
    console.error('ERROR:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINT 6: Create Booking - PRODUCTION VERSION
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
      tenantId
    } = req.body;
    
    console.log('========================================');
    console.log('CREATE BOOKING REQUEST:');
    console.log('Input data:', JSON.stringify(req.body, null, 2));
    
    // Validate
    const missingFields = [];
    if (!leadId) missingFields.push('leadId');
    if (!propertyId) missingFields.push('propertyId');
    if (!slotNumber) missingFields.push('slotNumber');
    if (!slotMap) missingFields.push('slotMap');
    if (!tenantId) missingFields.push('tenantId');
    
    if (missingFields.length > 0) {
      console.log('ERROR: Missing fields:', missingFields.join(', '));
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: ' + missingFields.join(', ')
      });
    }
    
    // 1. GET TENANT CONFIG
    console.log('Fetching tenant config...');
    const tenant = await base('Tenants').find(tenantId);
    
    const calendarId = tenant.get('Google Calendar ID');
    const timezone = tenant.get('Time Zone') || 'Africa/Nairobi';
    const slotDuration = parseInt(tenant.get('Slot Duration') || 60);
    const companyName = tenant.get('Company Name');
    
    console.log('Tenant:', companyName);
    console.log('Calendar ID:', calendarId);
    console.log('Timezone:', timezone);
    
    // 2. PARSE SLOT MAP
    let slots = slotMap;
    if (typeof slotMap === 'string') {
      try {
        slots = JSON.parse(slotMap);
      } catch (err) {
        return res.status(400).json({ success: false, error: 'Invalid slot map format' });
      }
    }
    
    const slotData = slots[slotNumber];
    if (!slotData || !slotData.includes('|')) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid slot number. Available: ' + Object.keys(slots).join(', ')
      });
    }
    
    const [startTime, endTime] = slotData.split('|');
    const slotStart = new Date(startTime);
    const slotEnd = new Date(endTime);
    
    console.log('Selected slot:');
    console.log('  Start:', slotStart.toLocaleString('en-KE', { timeZone: timezone }));
    console.log('  End:', slotEnd.toLocaleString('en-KE', { timeZone: timezone }));
    
    // 3. COLLISION DETECTION - Check if slot is still available
    console.log('Checking for conflicts in database...');
    
    // Check Google Calendar
    const calendarConflicts = await calendar.events.list({
      calendarId: calendarId,
      timeMin: slotStart.toISOString(),
      timeMax: slotEnd.toISOString(),
      q: propertyId,
      singleEvents: true
    });
    
    const calendarHasConflict = calendarConflicts.data.items && calendarConflicts.data.items.length > 0;
    
    // Also check Airtable Bookings table directly
    const airtableConflicts = await base('Bookings')
      .select({
        filterByFormula: `AND(
          SEARCH("${propertyId}", ARRAYJOIN({Property})),
          {Status} != "Cancelled",
          OR(
            AND(
              IS_BEFORE({StartDateTime}, "${slotEnd.toISOString()}"),
              IS_AFTER({EndDateTime}, "${slotStart.toISOString()}")
            )
          )
        )`,
        maxRecords: 1
      })
      .all();
    
    const airtableHasConflict = airtableConflicts.length > 0;
    
    console.log('Calendar conflicts:', calendarHasConflict ? 'YES' : 'NO');
    console.log('Airtable conflicts:', airtableHasConflict ? 'YES' : 'NO');
    
    if (calendarHasConflict || airtableHasConflict) {
      console.log('SLOT TAKEN! Cannot book.');
      return res.json({
        success: false,
        slotTaken: true,
        message: "⚠️ Sorry, that time slot was just taken by another client!\n\nPlease select another time or reply HI to search again."
      });
    }
    
    console.log('Slot is FREE! Proceeding with booking...');
    
    // 4. GET PROPERTY DETAILS
    const propertyRecord = await base('Properties').find(propertyId);
    const propertyName = propertyRecord.get('Property Name');
    const propertyAddress = propertyRecord.get('Address');
    const agentEmailRaw = propertyRecord.get('Agent Email');
    const agentPhoneRaw = propertyRecord.get('Agent Phone');
    const agentNameRaw = propertyRecord.get('Agent Name');
    
    console.log('Property:', propertyName);
    console.log('Agent data (raw):');
    console.log('  Name:', agentNameRaw, '(type:', typeof agentNameRaw, ')');
    console.log('  Phone:', agentPhoneRaw, '(type:', typeof agentPhoneRaw, ')');
    console.log('  Email:', agentEmailRaw, '(type:', typeof agentEmailRaw, ')');
    
    // Handle lookups (they return arrays)
    const agentName = Array.isArray(agentNameRaw) ? agentNameRaw[0] : agentNameRaw;
    const agentPhoneRaw2 = Array.isArray(agentPhoneRaw) ? agentPhoneRaw[0] : agentPhoneRaw;
    const agentEmail = Array.isArray(agentEmailRaw) ? agentEmailRaw[0] : agentEmailRaw;
    
    // Clean phone number - Airtable phone fields are picky
    let agentPhone = agentPhoneRaw2;
    if (agentPhone) {
      // Convert to string and trim
      agentPhone = agentPhone.toString().trim();
      // Remove any extra formatting that might cause issues
      agentPhone = agentPhone.replace(/[^\d+\s()-]/g, '');
    }
    
    console.log('Agent data (cleaned):');
    console.log('  Name:', agentName);
    console.log('  Phone (original):', agentPhoneRaw2);
    console.log('  Phone (cleaned):', agentPhone);
    console.log('  Email:', agentEmail);
    
    // In the create booking endpoint, find this section and replace it:

// 5. CREATE GOOGLE CALENDAR EVENT
console.log('Creating calendar event...');

const event = {
  summary: `${companyName} - Property Viewing`,
  description: `Property: ${propertyName}\nClient: ${leadName}\nPhone: ${leadPhone}\nProperty ID: ${propertyId}\n\nAgent: ${agentName || 'N/A'}\nAgent Phone: ${agentPhone || 'N/A'}`,
  location: propertyAddress,
  start: {
    dateTime: slotStart.toISOString(),
    timeZone: timezone
  },
  end: {
    dateTime: slotEnd.toISOString(),
    timeZone: timezone
  },
};

let calendarEvent;
try {
  calendarEvent = await calendar.events.insert({
    calendarId: calendarId,
    resource: event
    // REMOVED: sendUpdates: 'all' (can't send updates without attendees)
  });
  console.log('Calendar event created:', calendarEvent.data.id);
} catch (calErr) {
  console.error('Calendar creation failed:', calErr.message);
  return res.status(500).json({ 
    success: false, 
    error: 'Failed to create calendar event: ' + calErr.message 
  });
}
    
    // 6. CREATE AIRTABLE BOOKING
    console.log('Creating Airtable booking...');
    
    const bookingData = {
      'Lead': [leadId],
      'Property': [propertyId],
      'StartDateTime': slotStart.toISOString(),
      'EndDateTime': slotEnd.toISOString(),
      'Date': slotStart.toISOString().split('T')[0], // ISO format: 2026-02-13
      'Time': slotStart.toLocaleTimeString('en-KE', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true }),
      'Status': 'Scheduled',
      'Google Event ID': calendarEvent.data.id,
      'Tenant': [tenantId]
    };
    
    // Add agent fields only if they exist (they might be empty)
    if (agentName) {
      bookingData['Agent Name'] = agentName.toString(); // Ensure it's a string
    }
    if (agentPhone) {
      bookingData['Agent Phone'] = agentPhone.toString(); // Ensure it's a string
    }
    
    console.log('Booking data:', JSON.stringify(bookingData, null, 2));
    
    let bookingRecord;
    try {
      bookingRecord = await base('Bookings').create(bookingData);
      console.log('Booking created:', bookingRecord.id);
    } catch (airtableErr) {
      console.error('Airtable booking failed:', airtableErr.message);
      // Cleanup calendar event
      try {
        await calendar.events.delete({
          calendarId: calendarId,
          eventId: calendarEvent.data.id
        });
        console.log('Calendar event deleted (cleanup)');
      } catch {}
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to create booking: ' + airtableErr.message 
      });
    }
    
    // 7. FORMAT MESSAGES
    const slotDurationMinutes = slotDuration;
    const durationText = slotDurationMinutes >= 60 
      ? `${Math.floor(slotDurationMinutes / 60)} hour${slotDurationMinutes > 60 ? 's' : ''}`
      : `${slotDurationMinutes} minutes`;
    
    const confirmMessage = `✅ *VIEWING CONFIRMED!*\n\n` +
      `*Booking Details:*\n` +
      `Property: ${propertyName}\n` +
      `Date: ${slotStart.toLocaleDateString('en-KE', { timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric' })}\n` +
      `Time: ${slotStart.toLocaleTimeString('en-KE', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true })}\n` +
      `*Location:* ${propertyAddress}\n\n` +
      (agentName ? `👤 *Agent:* ${agentName}\n` : '') +
      (agentPhone ? `📱 *Agent Phone:* ${agentPhone}\n\n` : '\n') +
      `See you there! Reply CANCEL if you need to cancel.`;
    
    const agentMessage = `🔔 *NEW VIEWING SCHEDULED*\n\n` +
      `📋 *CLIENT:*\n` +
      `${leadName}\n` +
      `${leadPhone}\n\n` +
      `🏠 *PROPERTY:*\n` +
      `${propertyName}\n` +
      `${propertyAddress}\n\n` +
      `📅 ${slotStart.toLocaleDateString('en-KE', { timeZone: timezone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}\n` +
      `⏰ ${slotStart.toLocaleTimeString('en-KE', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true })}\n` +
      `⏱️ Duration: ${durationText}\n\n` +
      `✅ Added to your calendar`;
    
    console.log('BOOKING SUCCESSFUL!');
    console.log('========================================');
    
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
        date: slotStart.toLocaleDateString('en-KE', { timeZone: timezone }),
        time: slotStart.toLocaleTimeString('en-KE', { timeZone: timezone }),
        property: propertyName,
        address: propertyAddress
      }
    });
    
  } catch (error) {
    console.error('ERROR in create-booking:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINT 7: Cancel Booking - COMPLETELY FIXED
// ============================================
app.post('/api/cancel-booking', async (req, res) => {
  try {
    const { leadId, calendarId } = req.body;
    
    console.log('========================================');
    console.log('CANCEL BOOKING REQUEST:');
    console.log('leadId:', leadId);
    console.log('calendarId:', calendarId);
    
    if (!leadId || !calendarId) {
      return res.status(400).json({ success: false, error: 'leadId and calendarId required' });
    }
    
    // ============================================
    // FIXED: Get ALL scheduled bookings, filter in JavaScript
    // ============================================
    
    console.log('Getting all scheduled bookings...');
    
    const allScheduled = await base('Bookings')
      .select({
        filterByFormula: `{Status} = "Scheduled"`,
        sort: [{ field: 'StartDateTime', direction: 'desc' }]
      })
      .all();
    
    console.log('Total scheduled bookings:', allScheduled.length);
    
    // Filter in JavaScript (more reliable than Airtable formulas for linked fields)
    const bookings = allScheduled.filter(booking => {
      const leadField = booking.get('Lead');
      console.log('Checking booking', booking.id, 'Lead field:', leadField);
      
      // Handle both array and non-array cases
      if (Array.isArray(leadField)) {
        return leadField.includes(leadId);
      }
      return leadField === leadId;
    });
    
    console.log('Bookings matching leadId:', bookings.length);
    
    if (bookings.length === 0) {
      console.log('NO BOOKINGS FOUND for this lead!');
      console.log('========================================');
      return res.json({
        success: false,
        noBooking: true,
        message: "You don't have any active bookings to cancel.\n\nReply HI to search for properties! 🏡"
      });
    }
    
    const booking = bookings[0];
    console.log('Found booking to cancel:', booking.id);
    
    const eventId = booking.get('Google Event ID');
    const propertyIdArray = booking.get('Property');
    const propertyId = Array.isArray(propertyIdArray) ? propertyIdArray[0] : propertyIdArray;
    
    if (!eventId) {
      console.log('No Google Event ID found');
      console.log('========================================');
      return res.json({
        success: false,
        noEvent: true,
        message: "Booking found but no calendar event to delete."
      });
    }
    
    if (!propertyId) {
      console.log('ERROR: No property ID in booking');
      console.log('========================================');
      return res.status(500).json({ 
        success: false, 
        error: 'Booking data incomplete - missing property' 
      });
    }
    
    console.log('Property ID:', propertyId);
    
    // Get property and lead details
    let property, propertyName;
    try {
      property = await base('Properties').find(propertyId);
      propertyName = property.get('Property Name');
      console.log('Property:', propertyName);
    } catch (propErr) {
      console.error('Failed to get property:', propErr.message);
      propertyName = 'Property';
    }
    
    let lead, leadName, leadPhone;
    try {
      lead = await base('Leads').find(leadId);
      leadName = lead.get('Name');
      leadPhone = lead.get('Phone');
      console.log('Lead:', leadName);
    } catch (leadErr) {
      console.error('Failed to get lead:', leadErr.message);
      leadName = 'there';
      leadPhone = '';
    }
    
    const scheduledTime = new Date(booking.get('StartDateTime'));
    
    console.log('Deleting calendar event...');
    
    // Delete Google Calendar event
    try {
      await calendar.events.delete({
        calendarId: calendarId,
        eventId: eventId
      });
      console.log('Calendar event deleted');
    } catch (calErr) {
      console.error('Calendar deletion error:', calErr.message);
    }
    
    // Update booking status
    await base('Bookings').update(booking.id, {
      'Status': 'Cancelled'
    });
    
    // Update lead conversation stage
    await base('Leads').update(leadId, {
      'Conversation Stage': 'booking_cancelled',
      'Status': 'Cancelled'
    });
    
    const userMessage = `❌ *Viewing Cancelled*\n\n` +
      `Your viewing has been cancelled:\n\n` +
      `🏠 *Property:* ${propertyName}\n` +
      `📅 *Was scheduled for:* ${scheduledTime.toLocaleDateString('en-KE')}\n` +
      `⏰ *Time:* ${scheduledTime.toLocaleTimeString('en-KE', { hour: 'numeric', minute: '2-digit', hour12: true })}\n\n` +
      `If you'd like to reschedule, reply *HI* to start over.`;
    
    console.log('Cancellation successful');
    console.log('========================================');
    
    res.json({
      success: true,
      userMessage: userMessage
    });
    
  } catch (error) {
    console.error('ERROR in cancel-booking:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINT 8: Check Reminders AND Follow-Ups (COMBINED)
// ============================================
app.post('/api/check-notifications', async (req, res) => {
  try {
    console.log('========================================');
    console.log('CHECKING FOR NOTIFICATIONS (Reminders + Follow-ups)...');
    
    const now = new Date();
    const allNotifications = [];
    
    // ===================================
    // 1. CHECK REMINDERS (12h and 1h)
    // ===================================
    
    // 12-hour window
    const in12Hours = new Date(now.getTime() + (12 * 60 * 60 * 1000));
    const in11Hours = new Date(now.getTime() + (11 * 60 * 60 * 1000));
    
    const bookings12h = await base('Bookings')
      .select({
        filterByFormula: `AND(
          {Status} = "Scheduled",
          {Reminder12hSent} = FALSE(),
          IS_AFTER({StartDateTime}, "${in11Hours.toISOString()}"),
          IS_BEFORE({StartDateTime}, "${in12Hours.toISOString()}")
        )`,
        fields: ['Lead', 'Property', 'StartDateTime', 'Tenant']
      })
      .all();
    
    for (const booking of bookings12h) {
      const leadId = booking.get('Lead')?.[0];
      const propertyId = booking.get('Property')?.[0];
      const tenantId = booking.get('Tenant')?.[0];
      const startTime = new Date(booking.get('StartDateTime'));
      
      if (!leadId || !propertyId || !tenantId) continue;
      
      const lead = await base('Leads').find(leadId);
      const property = await base('Properties').find(propertyId);
      const tenant = await base('Tenants').find(tenantId);
      
      const agentNameRaw = property.get('Agent Name');
      const agentPhoneRaw = property.get('Agent Phone');
      const agentName = Array.isArray(agentNameRaw) ? agentNameRaw[0] : agentNameRaw;
      const agentPhone = Array.isArray(agentPhoneRaw) ? agentPhoneRaw[0] : agentPhoneRaw;
      
      const timezone = tenant.get('Time Zone') || 'Africa/Nairobi';
      
      const message = `🔔 REMINDER: Viewing Tomorrow!\n\n` +
        `🏠 ${property.get('Property Name')}\n` +
        `📅 ${startTime.toLocaleDateString('en-KE', { timeZone: timezone, weekday: 'long', month: 'short', day: 'numeric' })}\n` +
        `⏰ ${startTime.toLocaleTimeString('en-KE', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true })}\n` +
        `📍 ${property.get('Address')}\n\n` +
        (agentName ? `👤 Agent: ${agentName}\n` : '') +
        (agentPhone ? `📱 ${agentPhone}\n\n` : '\n') +
        `See you there!`;
      
      allNotifications.push({
        type: 'reminder_12h',
        bookingId: booking.id,
        leadPhone: lead.get('Phone'),
        leadName: lead.get('Name'),
        tenantWhatsApp: tenant.get('WhatsApp Number'),
        message: message
      });
    }
    
    // 1-hour window
    const in1Hour = new Date(now.getTime() + (1 * 60 * 60 * 1000));
    const in50Minutes = new Date(now.getTime() + (50 * 60 * 1000));
    
    const bookings1h = await base('Bookings')
      .select({
        filterByFormula: `AND(
          {Status} = "Scheduled",
          {Reminder1hSent} = FALSE(),
          IS_AFTER({StartDateTime}, "${in50Minutes.toISOString()}"),
          IS_BEFORE({StartDateTime}, "${in1Hour.toISOString()}")
        )`,
        fields: ['Lead', 'Property', 'StartDateTime', 'Tenant']
      })
      .all();
    
    for (const booking of bookings1h) {
      const leadId = booking.get('Lead')?.[0];
      const propertyId = booking.get('Property')?.[0];
      const tenantId = booking.get('Tenant')?.[0];
      
      if (!leadId || !propertyId || !tenantId) continue;
      
      const lead = await base('Leads').find(leadId);
      const property = await base('Properties').find(propertyId);
      const tenant = await base('Tenants').find(tenantId);
      
      const message = `⏰ Your viewing starts in 1 HOUR!\n\n` +
        `🏠 ${property.get('Property Name')}\n` +
        `📍 ${property.get('Address')}\n\n` +
        `The agent is ready for you! 🎉`;
      
      allNotifications.push({
        type: 'reminder_1h',
        bookingId: booking.id,
        leadPhone: lead.get('Phone'),
        leadName: lead.get('Name'),
        tenantWhatsApp: tenant.get('WhatsApp Number'),
        message: message
      });
    }
    
    // ===================================
    // 2. CHECK FOLLOW-UPS (3 hours after)
    // ===================================
    
    const twoHalfHoursAgo = new Date(now.getTime() - (2.5 * 60 * 60 * 1000));
    const threeHalfHoursAgo = new Date(now.getTime() - (3.5 * 60 * 60 * 1000));
    
    const followUpBookings = await base('Bookings')
      .select({
        filterByFormula: `AND(
          {Status} = "Scheduled",
          {FollowUpSent} = FALSE(),
          IS_AFTER({EndDateTime}, "${threeHalfHoursAgo.toISOString()}"),
          IS_BEFORE({EndDateTime}, "${twoHalfHoursAgo.toISOString()}")
        )`,
        fields: ['Lead', 'Property', 'EndDateTime', 'Tenant']
      })
      .all();
    
    for (const booking of followUpBookings) {
      const leadId = booking.get('Lead')?.[0];
      const propertyId = booking.get('Property')?.[0];
      const tenantId = booking.get('Tenant')?.[0];
      
      if (!leadId || !propertyId || !tenantId) continue;
      
      const lead = await base('Leads').find(leadId);
      const property = await base('Properties').find(propertyId);
      const tenant = await base('Tenants').find(tenantId);
      
      const message = `Hi ${lead.get('Name')} 👋\n\n` +
        `How was your viewing of ${property.get('Property Name')}?\n\n` +
        `Reply:\n` +
        `1️⃣ Interested\n` +
        `2️⃣ Not Interested\n` +
        `3️⃣ HI – to search another property\n\n` +
        `We're here to help! 🏡`;
      
      allNotifications.push({
        type: 'followup',
        bookingId: booking.id,
        leadId: leadId,
        leadPhone: lead.get('Phone'),
        leadName: lead.get('Name'),
        propertyName: property.get('Property Name'),
        tenantWhatsApp: tenant.get('WhatsApp Number'),
        message: message
      });
    }
    
    console.log('Total notifications:', allNotifications.length);
    console.log('  Reminders 12h:', allNotifications.filter(n => n.type === 'reminder_12h').length);
    console.log('  Reminders 1h:', allNotifications.filter(n => n.type === 'reminder_1h').length);
    console.log('  Follow-ups:', allNotifications.filter(n => n.type === 'followup').length);
    console.log('========================================');
    
    res.json({
      success: true,
      notifications: allNotifications,
      count: allNotifications.length
    });
    
  } catch (error) {
    console.error('ERROR:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINT 9: Mark Notification as Sent
// ============================================
app.post('/api/mark-notification-sent', async (req, res) => {
  try {
    const { bookingId, type } = req.body;
    
    if (!bookingId || !type) {
      return res.status(400).json({ success: false, error: 'bookingId and type required' });
    }
    
    const updateData = {};
    
    if (type === 'reminder_12h') {
      updateData['Reminder12hSent'] = true;
    } else if (type === 'reminder_1h') {
      updateData['Reminder1hSent'] = true;
    } else if (type === 'followup') {
      updateData['FollowUpSent'] = true;
    }
    
    await base('Bookings').update(bookingId, updateData);
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('ERROR:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});



// ============================================
// ENDPOINT 10: Handle Follow-Up Response
// ============================================
app.post('/api/handle-followup-response', async (req, res) => {
  try {
    const { leadId, response } = req.body;
    
    console.log('Follow-up response:', leadId, response);
    
    if (!leadId || !response) {
      return res.status(400).json({ success: false, error: 'leadId and response required' });
    }
    
    const lead = await base('Leads').find(leadId);
    const leadName = lead.get('Name');
    
    if (response === '1' || response.toLowerCase().includes('interested')) {
      // Mark as interested
      await base('Leads').update(leadId, {
        'Status': 'Hot Lead',
        'Conversation Stage': 'interested_after_viewing'
      });
      
      const userMessage = `Great! 🎉\n\nOur agent will contact you shortly to discuss next steps!\n\nReply HI anytime to search for more properties.`;
      
      const agentMessage = `🔥 *HOT LEAD ALERT!*\n\n` +
        `${leadName} is INTERESTED after viewing!\n\n` +
        `📞 Contact them ASAP: ${lead.get('Phone')}\n\n` +
        `Strike while the iron is hot! 🎯`;
      
      res.json({
        success: true,
        userMessage: userMessage,
        agentMessage: agentMessage,
        notifyAgent: true
      });
      
    } else if (response === '2' || response.toLowerCase().includes('not interested')) {
      // Mark as not interested
      await base('Leads').update(leadId, {
        'Status': 'Not Interested',
        'Conversation Stage': 'not_interested_after_viewing'
      });
      
      const userMessage = `Thank you for your feedback! 🙏\n\nIf you change your mind, just reply HI anytime.\n\nWe're always here to help! 🏡`;
      
      res.json({
        success: true,
        userMessage: userMessage,
        notifyAgent: false
      });
      
    } else {
      // Invalid response
      res.json({
        success: false,
        invalidResponse: true,
        userMessage: `Please reply:\n1️⃣ Interested\n2️⃣ Not Interested\n3️⃣ HI – to search another property`
      });
    }
    
  } catch (error) {
    console.error('ERROR in handle-followup-response:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINT 11: Mark awaiting-followup
// ============================================
app.post('/api/mark-awaiting-followup', async (req, res) => {
  try {
    const { leadId, awaiting } = req.body;
    
    await base('Leads').update(leadId, {
      'AwaitingFollowUpResponse': awaiting
    });
    
    res.json({ success: true });
  } catch (error) {
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
  console.log(`   - POST /api/check-notifications`);
  console.log(`   - POST /api/mark-notification-sent`);
  console.log(`   - POST /api/handle-followup-response`);
  console.log(`   - POST /api/mark-awaiting-followup`);
});