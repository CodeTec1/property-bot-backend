// server.js - Complete Multi-Tenant Property Bot Backend
require('dotenv').config();
const express = require('express');
const supabase = require('./supabase');
const { google } = require('googleapis');
const handleMessage = require('./handleMessage');
const cron = require('node-cron');
const { runNotifications } = require('./notifications');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

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
// Auto Lookup Tenant and Lead
// ============================================
async function getTenantAndLead(to, from) {
  try {
    // Clean the phone numbers
    const toNumber = to.replace('whatsapp:', '').trim();
    const fromNumber = from.trim();

    // Check cache first
    const cached = getCachedTenant(toNumber);
    let tenant = cached;

    // If not cached, look up tenant by WhatsApp number
    if (!tenant) {
      const { data, error } = await supabase
        .from('tenants')
        .select('*')
        .or(`whatsapp_number.eq.${to},whatsapp_number.eq.whatsapp:${toNumber}`)
        .eq('active', true)
        .single();

      if (error || !data) {
        console.error('Tenant not found for number:', to);
        return { tenant: null, lead: null };
      }

      tenant = data;
      cacheTenant(toNumber, tenant);
    }

    // Look up lead by phone number and tenant
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', fromNumber)
      .eq('tenant_id', tenant.id)
      .single();

    // Lead might not exist yet (new user) - that is okay
    return {
      tenant: tenant,
      lead: leadError ? null : lead
    };

  } catch (error) {
    console.error('Error in getTenantAndLead:', error);
    return { tenant: null, lead: null };
  }
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
// WhatsApp Webhook
// ============================================
app.use('/api/webhook', require('./webhook'));


// ============================================
// ENDPOINT 1: Handle Conversation Logic
// ============================================
app.post('/api/handle-message', async (req, res) => {
  try {
    const { message, from, to } = req.body;

    if (!message || !from || !to) {
      return res.status(400).json({
        action: "error",
        replyMessage: "Missing required fields."
      });
    }

    // Look up tenant and lead automatically
    const { tenant, lead } = await getTenantAndLead(to, from);

    if (!tenant) {
      return res.status(404).json({
        action: "error",
        replyMessage: "Sorry, this service is not available on this number."
      });
    }

    // Build the input object for handleMessage
    const input = {
      message: message,
      from: from,
      lead_id: lead?.id || null,
      lead_stage: lead?.conversation_stage || null,
      lead_interest: lead?.interest || null,
      lead_budget: lead?.budget || null,
      lead_location: lead?.location || null,
      lead_size: lead?.size || null,
      lead_name: lead?.name || null,
      lead_whatsapp: lead?.phone || null,
      last_viewed_property: lead?.last_viewed_property || null,
      awaiting_followup_response: lead?.awaiting_followup_response || false,
      tenant_id: tenant.id,
      tenant_company_name: tenant.company_name,
      tenant_bot_name: tenant.bot_name,
      tenant_property_types: tenant.property_types,
      tenant_whatsapp: tenant.whatsapp_number
    };

    const result = await handleMessage(input);

    // -----------------------------------------------
    // If action is create, create the lead in Supabase
    // -----------------------------------------------
    if (result.action === 'create') {
      const { data: newLead, error: createError } = await supabase
        .from('leads')
        .insert({
          phone: from,
          tenant_id: tenant.id,
          status: result.updateFields?.Status || 'New',
          conversation_stage: result.updateFields?.['Conversation Stage'] || 'asked_buy_or_rent'
        })
        .select()
        .single();

      if (createError) {
        console.error('Error creating lead:', createError);
      }
    }

    // -----------------------------------------------
    // If action is update, update the lead in Supabase
    // -----------------------------------------------
    if (result.action === 'update' && lead) {
      const updateData = {};

      if (result.updateFields?.['Conversation Stage']) {
        updateData.conversation_stage = result.updateFields['Conversation Stage'];
      }
      if (result.updateFields?.Name) {
        updateData.name = result.updateFields.Name;
      }
      if (result.updateFields?.Interest) {
        updateData.interest = result.updateFields.Interest;
      }
      if (result.updateFields?.Budget) {
        updateData.budget = result.updateFields.Budget;
      }
      if (result.updateFields?.Location) {
        updateData.location = result.updateFields.Location;
      }
      if (result.updateFields?.Size) {
        updateData.size = result.updateFields.Size;
      }
      if (result.updateFields?.Status) {
        updateData.status = result.updateFields.Status;
      }
      if (result.updateFields?.['Selected Property Number']) {
        updateData.selected_property_number = result.updateFields['Selected Property Number'];
      }
      if (result.updateFields?.['Available Slots']) {
        updateData.available_slots = result.updateFields['Available Slots'];
      }

      if (Object.keys(updateData).length > 0) {
        const { error: updateError } = await supabase
          .from('leads')
          .update(updateData)
          .eq('id', lead.id);

        if (updateError) {
          console.error('Error updating lead:', updateError);
        }
      }
    }

    // -----------------------------------------------
    // If action is fetch_locations, update lead budget
    // and conversation stage
    // -----------------------------------------------
    if (result.action === 'fetch_locations' && lead) {
      const { error: updateError } = await supabase
        .from('leads')
        .update({
          budget: result.updateFields?.Budget,
          conversation_stage: 'fetching_locations'
        })
        .eq('id', lead.id);

      if (updateError) {
        console.error('Error updating lead for fetch_locations:', updateError);
      }
    }

    // -----------------------------------------------
    // If action is fetch_sizes, update lead location
    // and conversation stage
    // -----------------------------------------------
    if (result.action === 'fetch_sizes' && lead) {
      const { error: updateError } = await supabase
        .from('leads')
        .update({
          location: result.location,
          conversation_stage: 'fetching_sizes'
        })
        .eq('id', lead.id);

      if (updateError) {
        console.error('Error updating lead for fetch_sizes:', updateError);
      }
    }

    // -----------------------------------------------
// If action is booking, save selected property
// number and return actual property ID
// -----------------------------------------------
if (result.action === 'booking' && lead) {
  // Save selected property number to Supabase
  const { error: bookingUpdateError } = await supabase
    .from('leads')
    .update({
      selected_property_number: result.propertyNumber,
      conversation_stage: 'awaiting_time_slot'
    })
    .eq('id', lead.id);

  if (bookingUpdateError) {
    console.error('Error updating lead for booking:', bookingUpdateError);
  }

  // Fetch the actual property ID using the same
  // search criteria as the original property search
  const { data: properties } = await supabase
    .from('properties')
    .select('id')
    .eq('tenant_id', tenant.id)
    .eq('type', lead.interest)
    .eq('location', lead.location)
    .eq('available', true)
    .order('price', { ascending: true })
    .limit(result.propertyNumber);

  if (properties && properties.length >= result.propertyNumber) {
    result.propertyId = properties[result.propertyNumber - 1].id;
  }

  // Enrich result with lead and tenant data for next steps
  result.lead_id = lead.id;
  result.lead_name = lead.name;
  result.tenant_id = tenant.id;
}

    // -----------------------------------------------
// If action is create_booking, save selected
// time slot to Supabase and enrich result
// -----------------------------------------------
if (result.action === 'create_booking' && lead) {
  const { error: updateError } = await supabase
    .from('leads')
    .update({
      conversation_stage: 'booking_confirmed'
    })
    .eq('id', lead.id);

  if (updateError) {
    console.error('Error updating lead for create_booking:', updateError);
  }

  // Enrich result with all data needed for booking
  result.lead_id = lead.id;
  result.lead_name = lead.name;
  result.from = lead.phone ? lead.phone.replace('whatsapp:', '').trim() : null;
  result.tenant_id = tenant.id;

  // Get property ID using selected property number
  const { data: properties } = await supabase
    .from('properties')
    .select('id')
    .eq('tenant_id', tenant.id)
    .eq('type', lead.interest)
    .eq('location', lead.location)
    .eq('available', true)
    .order('price', { ascending: true })
    .limit(lead.selected_property_number);

  if (properties && properties.length >= lead.selected_property_number) {
    result.propertyId = properties[lead.selected_property_number - 1].id;
  }

  // Get available slots from leads table
  result.slotMap = lead.available_slots || '{}';
}

    // -----------------------------------------------
// If action is cancel_booking, update lead stage
// -----------------------------------------------
if (result.action === 'cancel_booking' && lead) {
  const { error: updateError } = await supabase
    .from('leads')
    .update({
      conversation_stage: 'booking_cancelled',
      status: 'Cancelled'
    })
    .eq('id', lead.id);

  if (updateError) {
    console.error('Error updating lead for cancel_booking:', updateError);
  }

  // Enrich result with data needed for cancellation
  result.lead_id = lead.id;
  result.tenant_calendar_id = tenant.google_calendar_id;
}

    // Enrich every response with lead and tenant
// details so Make can access them in all routes
if (lead) {
  result.lead_id = result.lead_id || lead.id;
  result.lead_name = result.lead_name || lead.name;
  result.lead_phone = lead.phone ? lead.phone.replace('whatsapp:', '').trim() : null;
  result.lead_budget = lead.budget;
  result.lead_interest = lead.interest;       
  result.lead_location = lead.location;  
  result.last_viewed_property = lead.last_viewed_property || null;
  result.tenant_id = result.tenant_id || tenant.id;
  result.tenant_calendar_id = tenant.google_calendar_id;
}

// Get agent details for this tenant
const { data: agentData } = await supabase
  .from('agents')
  .select('agent_name, phone, email')
  .eq('tenant_id', tenant.id)
  .eq('active', true)
  .single();

if (agentData) {
  result.agent_name = agentData.agent_name;
  result.agent_phone = agentData.phone;
  result.agent_email = agentData.email;
}

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
    const { tenantId, interest, leadId } = req.body;

    if (!tenantId || !interest) {
      return res.status(400).json({ 
        success: false, 
        error: 'tenantId and interest are required' 
      });
    }

    // Capitalize first letter to match database format
// Handles: rent → Rent, buy → Buy, land → Land
const normalizedInterest = interest.charAt(0).toUpperCase() + interest.slice(1).toLowerCase();

const { data, error } = await supabase
  .from('properties')
  .select('location')
  .eq('tenant_id', tenantId)
  .ilike('type', normalizedInterest)
  .eq('available', true);

if (error) throw error;

const locations = [...new Set(data.map(r => r.location).filter(Boolean))].sort();
const formatted = locations.map(loc => `• ${loc}`).join('\n');

// Update lead conversation stage to asked_location
// so handleMessage knows to expect a location next
if (leadId) {
  const { error: updateError } = await supabase
    .from('leads')
    .update({ conversation_stage: 'asked_location' })
    .eq('id', leadId);

  if (updateError) {
    console.error('Error updating lead stage:', updateError);
  }
}

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
    const { tenantId, interest, location, leadId } = req.body;

    if (!tenantId || !interest || !location) {
      return res.status(400).json({ 
        success: false, 
        error: 'tenantId, interest, and location are required' 
      });
    }

    const normalizedInterest = interest.charAt(0).toUpperCase() + interest.slice(1).toLowerCase();

const { data, error } = await supabase
  .from('properties')
  .select('bedrooms, plot_size, type')
  .eq('tenant_id', tenantId)
  .ilike('type', normalizedInterest)
  .eq('location', location)
  .eq('available', true);
  
    if (error) throw error;

    if (data.length === 0) {
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
      const plots = [...new Set(data.map(r => r.plot_size).filter(Boolean))];
      options = plots.map(p => `• ${p}`).join('\n');
      nextStage = 'asked_land_size';
    } else {
      const beds = [...new Set(data.map(r => parseInt(r.bedrooms)).filter(n => !isNaN(n)))].sort((a, b) => a - b);
options = beds.map(b => {
  if (b === 0) return `• Studio`;
  return `• ${b} Bedroom${b > 1 ? 's' : ''}`;
}).join('\n');
nextStage = 'asked_size';
    }

    // Update lead conversation stage
if (leadId) {
  const nextStage = interest === 'Land' ? 'asked_land_size' : 'asked_size';
  const { error: updateError } = await supabase
    .from('leads')
    .update({ conversation_stage: nextStage })
    .eq('id', leadId);

  if (updateError) {
    console.error('Error updating lead stage:', updateError);
  }
}

    res.json({
      success: true,
      hasOptions: true,
      options: options,
      nextStage: nextStage,
      count: data.length
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
    const { tenantId, interest, location, bedrooms, plotSize } = req.body;

    if (!tenantId || !interest || !location) {
      return res.status(400).json({ 
        success: false, 
        error: 'tenantId, interest, and location are required' 
      });
    }

    // Normalize interest and location to handle case differences
    const normalizedInterest = interest.charAt(0).toUpperCase() + interest.slice(1).toLowerCase();
    const normalizedLocation = location.charAt(0).toUpperCase() + location.slice(1).toLowerCase();

    let query = supabase
      .from('properties')
      .select('id, property_name, type, price, bedrooms, plot_size, location, address, photo_url, description, completion_date, is_offplan, sqm, project_name')
      .eq('tenant_id', tenantId)
      .ilike('type', normalizedInterest)
      .ilike('location', normalizedLocation)
      .eq('available', true)
      .order('price', { ascending: true })
      .limit(7);

    if (normalizedInterest === 'Land') {
      const cleanPlotSize = plotSize.replace(/\s+/g, '').toLowerCase();
      query = query.ilike('plot_size', `%${cleanPlotSize}%`);
    } else {
      let bedroomNumber = bedrooms;
      if (typeof bedrooms === 'string') {
        const match = bedrooms.match(/\d+/);
        bedroomNumber = match ? parseInt(match[0]) : null;
      }
      query = query.eq('bedrooms', parseInt(bedroomNumber));
    }

    const { data, error } = await query;

    if (error) throw error;

    if (data.length === 0) {
      // Get agent details for this tenant
      const { data: agent } = await supabase
        .from('agents')
        .select('agent_name, phone')
        .eq('tenant_id', tenantId)
        .eq('active', true)
        .single();

      return res.json({
        success: false,
        properties: [],
        count: 0,
        message: `Sorry, no ${normalizedInterest.toLowerCase()} properties found in ${normalizedLocation} matching your criteria.`,
        agentName: agent?.agent_name || null,
        agentPhone: agent?.phone || null
      });
    }

    const properties = data.map((record, index) => ({
      number: index + 1,
      id: record.id,
      name: record.property_name,
      price: record.price,
      bedrooms: record.bedrooms,
      location: record.location,
      address: record.address,
      plotSize: record.plot_size,
      type: record.type,
      photoUrl: record.photo_url || ''
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
// ENDPOINT 5: Get Available Slots
// ============================================
app.post('/api/available-slots-v2', async (req, res) => {
  try {
    const { propertyId, tenantId } = req.body;

    if (!propertyId || !tenantId) {
      return res.status(400).json({ success: false, error: 'propertyId and tenantId required' });
    }

    // 1. GET TENANT CONFIG
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('*')
      .eq('id', tenantId)
      .single();

    if (tenantError) throw tenantError;

    const calendarId = tenant.google_calendar_id;
    const workStart = parseInt(tenant.work_start_hour || 9);
    const workEnd = parseInt(tenant.work_end_hour || 17);
    const slotDuration = parseInt(tenant.slot_duration || 60);
    const timezone = tenant.timezone || 'Africa/Nairobi';
    const daysAhead = parseInt(tenant.days_ahead || 30);
    const workingDaysStr = tenant.working_days || 'Monday, Tuesday, Wednesday, Thursday, Friday';

    // 2. GET PROPERTY
    const { data: property, error: propertyError } = await supabase
      .from('properties')
      .select('property_name')
      .eq('id', propertyId)
      .single();

    if (propertyError) throw propertyError;

    const propertyName = property.property_name;

    // 3. GET BOOKED EVENTS FROM GOOGLE CALENDAR
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

    // 4. GENERATE FREE SLOTS
    const minSlotTime = new Date(now.getTime() + (4 * 60 * 60 * 1000));
    const freeSlots = [];
    const MAX_SLOTS = 7;
    const KENYA_OFFSET_HOURS = 3;

    function overlaps(start, end) {
      return booked.some(b => start < b.end && end > b.start);
    }

    function isWorkingDay(d) {
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      return workingDaysStr.includes(dayNames[d.getDay()]);
    }

    for (let dayOffset = 0; dayOffset < daysAhead && freeSlots.length < MAX_SLOTS; dayOffset++) {
      const day = new Date(now);
      day.setDate(day.getDate() + dayOffset);
      day.setHours(0, 0, 0, 0);

      if (!isWorkingDay(day)) continue;

      for (let hour = workStart; hour < workEnd && freeSlots.length < MAX_SLOTS;) {
        const slotStart = new Date(day);
        slotStart.setUTCHours(hour - KENYA_OFFSET_HOURS, 0, 0, 0);

        const slotEnd = new Date(slotStart);
        slotEnd.setMinutes(slotEnd.getMinutes() + slotDuration);

        // Skip if in the past
        if (slotStart <= minSlotTime) {
          hour++;
          continue;
        }

        // Skip if beyond work hours
        const endHour = slotEnd.getHours();
        const endMinute = slotEnd.getMinutes();
        if (endHour > workEnd || (endHour === workEnd && endMinute > 0)) break;

        // Skip if overlaps with booked event
        if (overlaps(slotStart, slotEnd)) {
          hour++;
          continue;
        }

        // FREE SLOT
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

        hour = Math.floor((hour * 60 + slotDuration) / 60);
      }
    }

    // 5. CREATE SLOT MAP
    const slotMap = {};
    freeSlots.forEach(slot => {
      slotMap[slot.number] = `${slot.start}|${slot.end}`;
    });

    // 6. RETURN RESPONSE
    const message = freeSlots.length > 0
      ? `📅 Available viewings:\n\n` +
        freeSlots.map(s => `${s.number}️⃣ ${s.displayDate}, ${s.displayTime}`).join('\n') +
        `\n\nReply with slot number.`
      : `No available slots in the next ${daysAhead} days.\n\nOur agent will contact you!`;

    // Save slot map to leads table for use in create_booking
if (req.body.leadId) {
  const { error: slotSaveError } = await supabase
    .from('leads')
    .update({
      available_slots: JSON.stringify(slotMap)
    })
    .eq('id', req.body.leadId);

  if (slotSaveError) {
    console.error('Error saving slot map:', slotSaveError);
  }
}

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
// ENDPOINT 6: Create Booking
// ============================================
app.post('/api/create-booking', async (req, res) => {
  try {
    console.log('========================================');
    console.log('CREATE BOOKING REQUEST RECEIVED');
    console.log('Body:', JSON.stringify(req.body, null, 2));

    const { leadId, propertyId, slotNumber, slotMap, leadName, leadPhone, tenantId } = req.body;

    // Validate required fields
    const missingFields = [];
    if (!leadId) missingFields.push('leadId');
    if (!propertyId) missingFields.push('propertyId');
    if (!slotNumber) missingFields.push('slotNumber');
    if (!slotMap) missingFields.push('slotMap');
    if (!tenantId) missingFields.push('tenantId');

    if (missingFields.length > 0) {
      console.log('Missing fields:', missingFields);
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: ' + missingFields.join(', ')
      });
    }

    // 1. GET TENANT CONFIG
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('*')
      .eq('id', tenantId)
      .single();

    if (tenantError) {
      console.error('Tenant fetch error:', tenantError);
      throw tenantError;
    }

    const calendarId = tenant.google_calendar_id;
    const timezone = tenant.timezone || 'Africa/Nairobi';
    const slotDuration = parseInt(tenant.slot_duration || 60);
    const companyName = tenant.company_name;

    console.log('Tenant found:', companyName);
    console.log('Slot number received:', slotNumber);
    console.log('Slot map received:', slotMap);

    // 2. PARSE SLOT MAP
    let slots = slotMap;
    if (typeof slotMap === 'string') {
      try {
        slots = JSON.parse(slotMap);
        console.log('Slot map parsed successfully');
        console.log('Available slot keys:', Object.keys(slots));
      } catch (err) {
        console.error('Failed to parse slot map:', err.message);
        return res.status(400).json({ success: false, error: 'Invalid slot map format' });
      }
    }

    // Convert slotNumber to string for lookup
    const slotKey = slotNumber.toString();
    console.log('Looking up slot key:', slotKey);

    const slotData = slots[slotKey];
    console.log('Slot data found:', slotData);

    if (!slotData || !slotData.includes('|')) {
      console.error('Invalid slot. Available keys:', Object.keys(slots));
      return res.status(400).json({
        success: false,
        error: 'Invalid slot number. Available: ' + Object.keys(slots).join(', ')
      });
    }

    const [startTime, endTime] = slotData.split('|');
    const slotStart = new Date(startTime);
    const slotEnd = new Date(endTime);

    console.log('Slot start UTC:', slotStart.toISOString());
    console.log('Slot end UTC:', slotEnd.toISOString());
    console.log('Slot start Kenya:', slotStart.toLocaleTimeString('en-KE', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true }));

    // 3. COLLISION DETECTION
    console.log('Checking for conflicts...');

    const calendarConflicts = await calendar.events.list({
      calendarId: calendarId,
      timeMin: slotStart.toISOString(),
      timeMax: slotEnd.toISOString(),
      q: propertyId,
      singleEvents: true
    });

    const calendarHasConflict = calendarConflicts.data.items &&
      calendarConflicts.data.items.length > 0;

    const { data: conflictingBookings, error: conflictError } = await supabase
      .from('bookings')
      .select('id')
      .eq('property_id', propertyId)
      .neq('status', 'Cancelled')
      .lt('start_datetime', slotEnd.toISOString())
      .gt('end_datetime', slotStart.toISOString())
      .limit(1);

    if (conflictError) throw conflictError;

    const supabaseHasConflict = conflictingBookings.length > 0;

    console.log('Calendar conflict:', calendarHasConflict);
    console.log('Supabase conflict:', supabaseHasConflict);

    if (calendarHasConflict || supabaseHasConflict) {
      console.log('Slot is taken');
      return res.json({
        success: false,
        slotTaken: true,
        message: "Sorry, that time slot was just taken by another client.\n\nPlease select another time or reply HI to search again."
      });
    }

    console.log('Slot is free, proceeding...');

    // ============================================
// GET ASSIGNED AGENT (ROUND ROBIN)
// ============================================
const { data: leadData, error: leadFetchError } = await supabase
  .from('leads')
  .select('assigned_agent_id')
  .eq('id', leadId)
  .single();

if (leadFetchError) {
  console.error('Failed to fetch lead:', leadFetchError);
  throw leadFetchError;
}

let agentName = null;
let agentPhone = null;
let agentEmail = null;

if (leadData?.assigned_agent_id) {
  const { data: assignedAgent, error: agentError } = await supabase
    .from('agents')
    .select('agent_name, phone, email')
    .eq('id', leadData.assigned_agent_id)
    .single();

  if (agentError) {
    console.error('Failed to fetch assigned agent:', agentError);
  }

  agentName = assignedAgent?.agent_name || null;
  agentPhone = assignedAgent?.phone || null;
  agentEmail = assignedAgent?.email || null;

  console.log('✅ Using ROUND ROBIN agent:', agentName, agentEmail);
} else {
  console.log('⚠️ No assigned agent found on lead');
}

    // 4. GET PROPERTY AND AGENT DETAILS
    const { data: property, error: propertyError } = await supabase
      .from('properties')
      .select(`
  property_name,
  address,
  price
`)
      .eq('id', propertyId)
      .single();

    if (propertyError) {
      console.error('Property fetch error:', propertyError);
      throw propertyError;
    }

    const propertyName = property.property_name;
    const propertyAddress = property.address;
    

    console.log('Property found:', propertyName);

// ============================================
// 5. CREATE GOOGLE CALENDAR EVENT
// ============================================
console.log('Creating calendar event...');

// ✅ Enhance agent email if missing or unreliable
let agentDisplayName = agentName;

try {
  if (!agentEmail && agentName) {
    const { data: agentRecord, error: agentError } = await supabase
      .from('agents')
      .select('email, agent_name')
      .eq('tenant_id', tenantId)
      .ilike('agent_name', agentName)
      .single();

    if (agentError) {
      console.error('Agent fetch error:', agentError.message);
    }

    if (agentRecord?.email) {
      agentEmail = agentRecord.email;
      agentDisplayName = agentRecord.agent_name;
      console.log('✅ Agent email fetched from agents table:', agentEmail);
    } else {
      console.log('⚠️ No agent email found for:', agentName);
    }
  } else {
    console.log('✅ Using agent email from property relation:', agentEmail);
  }
} catch (err) {
  console.error('Failed to fetch agent email:', err.message);
}

// ✅ Create event
const event = {
  summary: `${companyName} - Property Viewing`,

  description:
    `Property: ${propertyName}\n` +
    `Client: ${leadName}\n` +
    `Phone: ${leadPhone}\n` +
    `Location: ${propertyAddress}\n\n` +
    `Agent: ${agentName || 'N/A'}\n` +
    `Agent Phone: ${agentPhone || 'N/A'}`,

  location: propertyAddress,

  start: {
    dateTime: slotStart.toISOString(),
    timeZone: timezone
  },

  end: {
    dateTime: slotEnd.toISOString(),
    timeZone: timezone
  },

  sendUpdates: 'all',

  reminders: {
    useDefault: false,
    overrides: [
      { method: 'email', minutes: 24 * 60 },
      { method: 'popup', minutes: 60 }
    ]
  }
};

// ✅ Create calendar event
let calendarEvent;
try {
  calendarEvent = await calendar.events.insert({
    calendarId: calendarId,
    resource: event,
    sendUpdates: 'all'
  });

  console.log('✅ Calendar event created:', calendarEvent.data.id);

} catch (calErr) {
  console.error('❌ Calendar creation failed:', calErr.message);
  return res.status(500).json({
    success: false,
    error: 'Failed to create calendar event: ' + calErr.message
  });
}

    // 6. CREATE SUPABASE BOOKING
    console.log('Creating Supabase booking...');
    console.log('Booking time being saved:', slotStart.toLocaleTimeString('en-KE', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }));

    const { data: bookingRecord, error: bookingError } = await supabase
      .from('bookings')
      .insert({
        lead_id: leadId,
        property_id: propertyId,
        tenant_id: tenantId,
        start_datetime: slotStart.toISOString(),
        end_datetime: slotEnd.toISOString(),
        date: slotStart.toISOString().split('T')[0],
        time: slotStart.toLocaleTimeString('en-KE', {
          timeZone: timezone,
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        }),
        status: 'Scheduled',
        google_event_id: calendarEvent.data.id,
        agent_name: agentName || null,
        agent_phone: agentPhone || null
      })
      .select()
      .single();

    if (bookingError) {
      console.error('Supabase booking error:', bookingError);
      // Cleanup calendar event if booking fails
      await calendar.events.delete({
        calendarId: calendarId,
        eventId: calendarEvent.data.id
      });
      throw bookingError;
    }

    console.log('Booking created successfully:', bookingRecord.id);
    console.log('========================================');

    // 7. FORMAT MESSAGES
    const durationText = slotDuration >= 60
      ? `${Math.floor(slotDuration / 60)} hour${slotDuration > 60 ? 's' : ''}`
      : `${slotDuration} minutes`;

    const confirmMessage =
      `✅ Viewing Confirmed!\n\n` +
      `Property: ${propertyName}\n` +
      `Date: ${slotStart.toLocaleDateString('en-KE', {
        timeZone: timezone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric'
      })}\n` +
      `Time: ${slotStart.toLocaleTimeString('en-KE', {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      })}\n` +
      `Location: ${propertyAddress}\n\n` +
      (agentName ? `Agent: ${agentName}\n` : '') +
      (agentPhone ? `Agent Phone: ${agentPhone}\n\n` : '\n') +
      `See you there! Reply CANCEL if you need to cancel.`;

    const agentMessage =
      `New Viewing Scheduled\n\n` +
      `Client: ${leadName}\n` +
      `Phone: ${leadPhone}\n\n` +
      `Property: ${propertyName}\n` +
      `Address: ${propertyAddress}\n\n` +
      `Date: ${slotStart.toLocaleDateString('en-KE', {
        timeZone: timezone,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })}\n` +
      `Time: ${slotStart.toLocaleTimeString('en-KE', {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      })}\n` +
      `Duration: ${durationText}\n\n` +
      `Added to your calendar.`;

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
        time: slotStart.toLocaleTimeString('en-KE', {
          timeZone: timezone,
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        }),
        property: propertyName,
        address: propertyAddress,
        price: property.price
      }
    });

  } catch (error) {
    console.error('Error in create-booking:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINT 7: Cancel Booking
// ============================================
app.post('/api/cancel-booking', async (req, res) => {
  try {
    const { leadId, calendarId } = req.body;

    if (!leadId || !calendarId) {
      return res.status(400).json({ success: false, error: 'leadId and calendarId required' });
    }

    // 1. FIND ACTIVE BOOKING FOR THIS LEAD
    const { data: bookings, error: bookingError } = await supabase
  .from('bookings')
  .select(`
    id,
    google_event_id,
    start_datetime,
    end_datetime,
    property_id,
    properties (
      property_name,
      address,
      agents (agent_name, phone)
    )
  `)
  .eq('lead_id', leadId)
  .eq('status', 'Scheduled')
  .order('created_at', { ascending: false })
  .limit(1);

    if (bookingError) throw bookingError;

    if (!bookings || bookings.length === 0) {
      return res.json({
        success: false,
        noBooking: true,
        message: "You don't have any active bookings to cancel.\n\nReply HI to search for properties."
      });
    }

    const booking = bookings[0];
    const eventId = booking.google_event_id;

    if (!eventId) {
      return res.json({
        success: false,
        noEvent: true,
        message: "Booking found but no calendar event to delete."
      });
    }

    const propertyName = booking.properties?.property_name || 'the property';
    const agentPhone = booking.properties?.agents?.phone || null;
    const scheduledTime = new Date(booking.start_datetime);

    // 2. GET LEAD NAME
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('name')
      .eq('id', leadId)
      .single();

    if (leadError) throw leadError;

    const leadName = lead.name || 'there';

    // 3. DELETE GOOGLE CALENDAR EVENT
    try {
      await calendar.events.delete({
        calendarId: calendarId,
        eventId: eventId
      });
    } catch (calErr) {
      console.error('Calendar deletion error:', calErr.message);
    }

    // 4. UPDATE BOOKING STATUS IN SUPABASE
    const { error: updateBookingError } = await supabase
      .from('bookings')
      .update({ status: 'Cancelled' })
      .eq('id', booking.id);

    if (updateBookingError) throw updateBookingError;

    // 5. UPDATE LEAD CONVERSATION STAGE
    const { error: updateLeadError } = await supabase
      .from('leads')
      .update({ conversation_stage: 'booking_cancelled' })
      .eq('id', leadId);

    if (updateLeadError) throw updateLeadError;

    // 6. FORMAT MESSAGES
    const userMessage =
  `Viewing Cancelled\n\n` +
  `Property: ${propertyName}\n` +
  `Was scheduled for: ${scheduledTime.toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi' })}\n` +
  `Time: ${scheduledTime.toLocaleTimeString('en-KE', { timeZone: 'Africa/Nairobi', hour: 'numeric', minute: '2-digit', hour12: true })}\n\n` +
  `Reply HI to search for another property.`;

    const agentMessage =
      `Viewing Cancelled\n\n` +
      `A viewing has been cancelled.\n\n` +
      `Client: ${leadName}\n` +
      `Property: ${propertyName}\n` +
      `Was scheduled for: ${scheduledTime.toLocaleDateString('en-KE')} at ${scheduledTime.toLocaleTimeString('en-KE', { hour: 'numeric', minute: '2-digit', hour12: true })}\n\n` +
      `The calendar event has been removed.`;

    res.json({
      success: true,
      userMessage: userMessage,
      agentNotification: {
        agentPhone: agentPhone,
        message: agentMessage,
        propertyName: propertyName,
        leadName: leadName,
        scheduledDate: scheduledTime.toLocaleDateString('en-KE'),
        scheduledTime: scheduledTime.toLocaleTimeString('en-KE', { hour: 'numeric', minute: '2-digit', hour12: true })
      }
    });

  } catch (error) {
    console.error('Error in cancel-booking:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINT 8: Check Reminders AND Follow-Ups
// ============================================
app.post('/api/check-notifications', async (req, res) => {
  try {
    const now = new Date();
    const allNotifications = [];

    // ===================================
    // 1. CHECK 12-HOUR REMINDERS
    // ===================================
    const in12Hours = new Date(now.getTime() + (12 * 60 * 60 * 1000));
    const in11Hours = new Date(now.getTime() + (11 * 60 * 60 * 1000));

    const { data: bookings12h, error: error12h } = await supabase
      .from('bookings')
      .select(`
        id,
        start_datetime,
        lead_id,
        tenant_id,
        leads (name, phone),
        properties (
          property_name,
          address,
          agents (agent_name, phone)
        ),
        tenants (timezone, whatsapp_number)
      `)
      .eq('status', 'Scheduled')
      .eq('reminder_12h_sent', false)
      .gt('start_datetime', in11Hours.toISOString())
      .lt('start_datetime', in12Hours.toISOString());

    if (error12h) throw error12h;

    for (const booking of bookings12h) {
      const timezone = booking.tenants?.timezone || 'Africa/Nairobi';
      const startTime = new Date(booking.start_datetime);
      const leadName = booking.leads?.name;
      const leadPhone = booking.leads?.phone;
      const propertyName = booking.properties?.property_name;
      const propertyAddress = booking.properties?.address;
      const agentName = booking.properties?.agents?.agent_name || null;
      const agentPhone = booking.properties?.agents?.phone || null;

      const formattedDate = startTime.toLocaleDateString('en-KE', {
        timeZone: timezone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric'
      });
      const formattedTime = startTime.toLocaleTimeString('en-KE', {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });

      const message =
        `Reminder: Viewing Coming Up!\n\n` +
        `Property: ${propertyName}\n` +
        `Date: ${startTime.toLocaleDateString('en-KE', { timeZone: timezone, weekday: 'long', month: 'short', day: 'numeric' })}\n` +
        `Time: ${formattedTime}\n` +
        `Address: ${propertyAddress}\n\n` +
        (agentName ? `Agent: ${agentName}\n` : '') +
        (agentPhone ? `Agent Phone: ${agentPhone}\n\n` : '\n') +
        `See you there!`;

      const agentMessage =
        `Upcoming Viewing Reminder\n\n` +
        `Client: ${leadName}\n` +
        `Phone: ${leadPhone}\n` +
        `Property: ${propertyName}\n` +
        `Date: ${formattedDate}\n` +
        `Time: ${formattedTime}\n\n` +
        `Please be ready to meet the client.`;

      allNotifications.push({
        type: 'reminder_12h',
        bookingId: booking.id,
        leadPhone: leadPhone,
        leadName: leadName,
        tenantWhatsApp: booking.tenants?.whatsapp_number,
        message: message,
        agentNotification: {
          agentPhone: agentPhone,
          message: agentMessage,
          clientName: leadName,
          clientPhone: leadPhone,
          propertyName: propertyName,
          propertyAddress: propertyAddress,
          date: formattedDate,
          time: formattedTime
        }
      });
    }

    // ===================================
    // 2. CHECK 1-HOUR REMINDERS
    // ===================================
    const in1Hour = new Date(now.getTime() + (1 * 60 * 60 * 1000));
    const in50Minutes = new Date(now.getTime() + (50 * 60 * 1000));

    const { data: bookings1h, error: error1h } = await supabase
      .from('bookings')
      .select(`
        id,
        start_datetime,
        lead_id,
        tenant_id,
        leads (name, phone),
        properties (
          property_name,
          address,
          agents (agent_name, phone)
        ),
        tenants (timezone, whatsapp_number)
      `)
      .eq('status', 'Scheduled')
      .eq('reminder_1h_sent', false)
      .gt('start_datetime', in50Minutes.toISOString())
      .lt('start_datetime', in1Hour.toISOString());

    if (error1h) throw error1h;

    for (const booking of bookings1h) {
      const timezone = booking.tenants?.timezone || 'Africa/Nairobi';
      const startTime = new Date(booking.start_datetime);
      const leadName = booking.leads?.name;
      const leadPhone = booking.leads?.phone;
      const propertyName = booking.properties?.property_name;
      const propertyAddress = booking.properties?.address;
      const agentName = booking.properties?.agents?.agent_name || null;
      const agentPhone = booking.properties?.agents?.phone || null;

      const formattedDate = startTime.toLocaleDateString('en-KE', {
        timeZone: timezone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric'
      });
      const formattedTime = startTime.toLocaleTimeString('en-KE', {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });

      const message =
        `Your viewing starts in 1 hour!\n\n` +
        `Property: ${propertyName}\n` +
        `Address: ${propertyAddress}\n` +
        `Time: ${formattedTime}\n\n` +
        `The agent is ready for you.`;

      const agentMessage =
        `Upcoming Viewing Reminder\n\n` +
        `Client: ${leadName}\n` +
        `Phone: ${leadPhone}\n` +
        `Property: ${propertyName}\n` +
        `Date: ${formattedDate}\n` +
        `Time: ${formattedTime}\n\n` +
        `The client is on their way.`;

      allNotifications.push({
        type: 'reminder_1h',
        bookingId: booking.id,
        leadPhone: leadPhone,
        leadName: leadName,
        tenantWhatsApp: booking.tenants?.whatsapp_number,
        message: message,
        agentNotification: {
          agentPhone: agentPhone,
          message: agentMessage,
          clientName: leadName,
          clientPhone: leadPhone,
          propertyName: propertyName,
          propertyAddress: propertyAddress,
          date: formattedDate,
          time: formattedTime
        }
      });
    }

    // ===================================
    // 3. CHECK FOLLOW-UPS
    // ===================================
    const twoHalfHoursAgo = new Date(now.getTime() - (2.5 * 60 * 60 * 1000));
    const threeHalfHoursAgo = new Date(now.getTime() - (3.5 * 60 * 60 * 1000));

    const { data: followUpBookings, error: followUpError } = await supabase
      .from('bookings')
      .select(`
        id,
        end_datetime,
        lead_id,
        tenant_id,
        leads (name, phone),
        properties (property_name),
        tenants (whatsapp_number)
      `)
      .eq('status', 'Scheduled')
      .eq('followup_sent', false)
      .gt('end_datetime', threeHalfHoursAgo.toISOString())
      .lt('end_datetime', twoHalfHoursAgo.toISOString());

    if (followUpError) throw followUpError;

    for (const booking of followUpBookings) {
      const leadName = booking.leads?.name;
      const leadPhone = booking.leads?.phone;
      const propertyName = booking.properties?.property_name;

      const message =
        `Hi ${leadName},\n\n` +
        `How was your viewing of ${propertyName}?\n\n` +
        `Reply:\n` +
        `1 - Interested\n` +
        `2 - Not Interested\n` +
        `HI - to search for another property\n\n` +
        `We are here to help!`;

      allNotifications.push({
        type: 'followup',
        bookingId: booking.id,
        leadId: booking.lead_id,
        leadPhone: leadPhone,
        leadName: leadName,
        propertyName: propertyName,
        tenantWhatsApp: booking.tenants?.whatsapp_number,
        message: message
      });
    }

    res.json({
      success: true,
      notifications: allNotifications,
      count: allNotifications.length
    });

  } catch (error) {
    console.error('Error in check-notifications:', error);
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
      updateData.reminder_12h_sent = true;
    } else if (type === 'reminder_1h') {
      updateData.reminder_1h_sent = true;
    } else if (type === 'followup') {
      updateData.followup_sent = true;
    }

    const { error } = await supabase
      .from('bookings')
      .update(updateData)
      .eq('id', bookingId);

    if (error) throw error;

    res.json({ success: true });

  } catch (error) {
    console.error('Error in mark-notification-sent:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINT 10: Handle Follow-Up Response
// ============================================
app.post('/api/handle-followup-response', async (req, res) => {
  try {
    const { leadId, response } = req.body;

    if (!leadId || !response) {
      return res.status(400).json({ success: false, error: 'leadId and response required' });
    }

    // Get lead details
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('name, phone')
      .eq('id', leadId)
      .single();

    if (leadError) throw leadError;

    const leadName = lead.name;
    const leadPhone = lead.phone;

    if (response === '1' || response.toLowerCase().includes('interested')) {

      const { error: updateError } = await supabase
        .from('leads')
        .update({
          status: 'Hot Lead',
          conversation_stage: 'interested_after_viewing'
        })
        .eq('id', leadId);

      if (updateError) throw updateError;

      const userMessage =
        `Great news!\n\n` +
        `Our agent will contact you shortly to discuss next steps.\n\n` +
        `Reply HI anytime to search for more properties.`;

      const agentMessage =
        `Hot Lead Alert!\n\n` +
        `${leadName} is interested after their viewing.\n\n` +
        `Contact them as soon as possible: ${leadPhone}`;

      res.json({
        success: true,
        userMessage: userMessage,
        agentMessage: agentMessage,
        notifyAgent: true
      });

    } else if (response === '2' || response.toLowerCase().includes('not interested')) {

      const { error: updateError } = await supabase
        .from('leads')
        .update({
          status: 'Not Interested',
          conversation_stage: 'not_interested_after_viewing'
        })
        .eq('id', leadId);

      if (updateError) throw updateError;

      const userMessage =
        `Thank you for your feedback.\n\n` +
        `If you change your mind, just reply HI anytime.\n\n` +
        `We are always here to help.`;

      res.json({
        success: true,
        userMessage: userMessage,
        notifyAgent: false
      });

    } else {
      res.json({
        success: false,
        invalidResponse: true,
        userMessage:
          `Please reply:\n` +
          `1 - Interested\n` +
          `2 - Not Interested\n` +
          `HI - to search for another property`
      });
    }

  } catch (error) {
    console.error('Error in handle-followup-response:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ENDPOINT 11: Mark Awaiting Follow-Up
// ============================================
app.post('/api/mark-awaiting-followup', async (req, res) => {
  try {
    const { leadId, awaiting, propertyName } = req.body;

    if (!leadId) {
      return res.status(400).json({ success: false, error: 'leadId is required' });
    }

    const updateData = {
      awaiting_followup_response: awaiting
    };

    if (propertyName) {
      updateData.last_viewed_property = propertyName;
    }

    const { error } = await supabase
      .from('leads')
      .update(updateData)
      .eq('id', leadId);

    if (error) throw error;

    res.json({ success: true });

  } catch (error) {
    console.error('Error in mark-awaiting-followup:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// Schedule notifications to run every hour
// ============================================
cron.schedule('0 * * * *', async () => {
  console.log('Cron job triggered - running notifications');
  await runNotifications();
});

console.log('Notification scheduler started - runs every hour');

// ============================================
// Start Server
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Property Bot API running on port ${PORT}`);
});