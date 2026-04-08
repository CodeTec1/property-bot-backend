// webhook.js - Handles incoming WhatsApp messages directly from Twilio
const express = require('express');
const router = express.Router();
const supabase = require('./supabase');
const handleMessage = require('./handleMessage');
const twilio = require('twilio');
const { processAIConversation } = require('./aiConversation');

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// ============================================
// BACKEND URL — hardcoded fallback prevents
// "undefined/api/..." crash if env var missing
// Add BACKEND_URL to Render environment variables
// ============================================
const BACKEND_URL = process.env.BACKEND_URL || 'https://property-bot-backend.onrender.com';

// ============================================
// Twilio Template SIDs
// ============================================
const TEMPLATES = {
  BOOKING_CONFIRMED: 'HX9eed3c1924829f0ae1ecab49e84d99d9',
  VIEWING_REMINDER: 'HXe2f13d97461952b669a22dd6a17081aa',
  BOOKING_CANCELLED: 'HX1110acf915d7366c907299818993fa00',
  HOT_LEAD: 'HX8e8cfe432e7ae3256d6d5c343359d85e',
  NO_PROPERTY_FOUND: 'HX6b9d047af7d746a257c0099c9c34034e'
};

// ============================================
// Helper: Look up tenant and lead
// ============================================
async function getTenantAndLead(to, from) {
  try {
    const toNumber = to.replace('whatsapp:', '').trim();

    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('*')
      .or(`whatsapp_number.eq.${to},whatsapp_number.eq.whatsapp:${toNumber}`)
      .eq('active', true)
      .single();

    if (tenantError || !tenant) {
      console.error('Tenant not found for number:', to);
      return { tenant: null, lead: null };
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', from)
      .eq('tenant_id', tenant.id)
      .single();

    return { tenant, lead: lead || null };

  } catch (error) {
    console.error('Error in getTenantAndLead:', error);
    return { tenant: null, lead: null };
  }
}

// ============================================
// Helper: Create smart budget ranges from prices
// ============================================
function createBudgetRanges(minPrice, maxPrice) {
  const ranges = {};
  const spread = maxPrice - minPrice;

  if (spread === 0) {
    ranges['1'] = { min: minPrice * 0.9, max: minPrice * 1.1, label: `Around KES ${Number(minPrice).toLocaleString()}` };
    return ranges;
  }

  const step = spread / 4;
  let rangeCount = 1;

  for (let i = 0; i < 4; i++) {
    const rangeMin = Math.floor((minPrice + (step * i)) / 1000000) * 1000000;
    const rangeMax = Math.ceil((minPrice + (step * (i + 1))) / 1000000) * 1000000;
    if (rangeMin !== rangeMax) {
      ranges[rangeCount.toString()] = { min: rangeMin, max: rangeMax };
      rangeCount++;
    }
  }

  ranges[rangeCount.toString()] = { min: 0, max: 999999999999, label: 'Any budget' };
  return ranges;
}

// ============================================
// Helper: Send regular Twilio message to user
// ============================================
async function sendMessage(from, to, body, mediaUrl = null) {
  try {
    const options = { from, to, body };
    if (mediaUrl) options.mediaUrl = [mediaUrl];
    await twilioClient.messages.create(options);
  } catch (error) {
    console.error(`Error sending message to ${to}:`, error.message);
  }
}

// ============================================
// Helper: Send Twilio template to agent
// ============================================
async function sendTemplateToAgent(tenantWhatsApp, agentPhone, templateSid, variables) {
  try {
    if (!agentPhone) {
      console.error('No agent phone provided');
      return;
    }

    const agentWhatsApp = agentPhone.startsWith('whatsapp:')
      ? agentPhone
      : `whatsapp:${agentPhone}`;

    await twilioClient.messages.create({
      from: tenantWhatsApp,
      to: agentWhatsApp,
      contentSid: templateSid,
      contentVariables: JSON.stringify(variables)
    });

    console.log('Template sent to agent:', agentPhone);
  } catch (error) {
    console.error('Error sending template to agent:', error.message);
  }
}

// ============================================
// Helper: Small delay between messages
// ============================================
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// Helper: Normalize text (capitalize first letter)
// ============================================
function normalize(text) {
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

// ============================================
// Helper: Extract bedroom number from size string
// ============================================
function extractBedrooms(sizeStr) {
  if (!sizeStr) return null;
  if (sizeStr.toString().toLowerCase().includes('studio')) return 0;
  const match = sizeStr.toString().match(/\d+/);
  return match ? parseInt(match[0]) : null;
}

// ============================================
// Helper: Search properties from Supabase
// ============================================
async function searchProperties(tenantId, interest, location, size, budget, isOffplan, completionRange) {
  try {
    const normalizedInterest = normalize(interest);
    const normalizedLocation = normalize(location);

    console.log('Searching properties:', {
      tenantId, normalizedInterest, normalizedLocation, size, isOffplan, completionRange
    });

    let budgetNumber = null;
    if (budget) {
      const cleanBudget = budget.toString().replace(/[^0-9.]/g, '');
      budgetNumber = parseFloat(cleanBudget);
    }

    let query = supabase
      .from('properties')
      .select('id, property_name, type, price, bedrooms, plot_size, location, address, photo_url, description, completion_date, is_offplan, sqm, project_name')
      .eq('tenant_id', tenantId)
      .ilike('type', normalizedInterest)
      .ilike('location', normalizedLocation)
      .eq('available', true)
      .order('price', { ascending: true })
      .limit(7);

    if (budgetNumber && budgetNumber > 0) {
      const flexibleBudget = budgetNumber * 1.2;
      query = query.lte('price', flexibleBudget);
    }

    if (isOffplan === true) {
      query = query.eq('is_offplan', true);
      if (completionRange && completionRange !== 'any') {
        if (completionRange === '2026') {
          query = query.ilike('completion_date', '%2026%');
        } else if (completionRange === '2027') {
          query = query.ilike('completion_date', '%2027%');
        } else if (completionRange === '2028') {
          query = query.ilike('completion_date', '%2028%');
        } else if (completionRange === '2029+') {
          query = query
            .not('completion_date', 'ilike', '%2026%')
            .not('completion_date', 'ilike', '%2027%')
            .not('completion_date', 'ilike', '%2028%');
        } else {
          // Exact string match e.g. "Dec-2027", "January 2027"
          query = query.ilike('completion_date', `%${completionRange}%`);
        }
      }
    } else if (isOffplan === false) {
      query = query.eq('is_offplan', false);
    }

    if (normalizedInterest === 'Land') {
      const cleanPlotSize = size ? size.replace(/\s+/g, '').toLowerCase() : '';
      if (cleanPlotSize) {
        query = query.ilike('plot_size', `%${cleanPlotSize}%`);
      }
    } else {
      const bedroomNumber = extractBedrooms(size);
      console.log('Extracted bedroom number:', bedroomNumber);
      if (bedroomNumber !== null && bedroomNumber !== undefined) {
        query = query.eq('bedrooms', bedroomNumber);
        console.log('Filtering by bedrooms:', bedroomNumber);
      }
    }

    const { data, error } = await query;
    if (error) {
      console.error('Property search error:', error);
      return [];
    }

    console.log('Properties found:', data?.length || 0);
    return data || [];

  } catch (error) {
    console.error('Error in searchProperties:', error);
    return [];
  }
}

// ============================================
// Helper: Format Kenya date
// ============================================
function formatKenyaDate(isoString) {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-KE', {
    timeZone: 'Africa/Nairobi', year: 'numeric', month: 'numeric', day: 'numeric'
  });
}

// ============================================
// Helper: Format Kenya time
// ============================================
function formatKenyaTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-KE', {
    timeZone: 'Africa/Nairobi', hour: 'numeric', minute: '2-digit', hour12: true
  });
}

// ============================================
// Helper: Send property cards to user
// ============================================
async function handlePropertyResults(
  properties, lead, tenant, tenantWhatsApp,
  from, agentName, agentPhone, cleanLeadPhone, kenyaTime
) {
  if (properties.length > 0) {
    const searchResultsToSave = properties.map((p, i) => ({
      number: i + 1, id: p.id, name: p.property_name, price: p.price,
      location: p.location, address: p.address, bedrooms: p.bedrooms,
      plot_size: p.plot_size, type: p.type, photo_url: p.photo_url
    }));

    await supabase.from('leads').update({
      search_results: searchResultsToSave,
      conversation_stage: 'completed',
      status: 'Contacted'
    }).eq('id', lead.id);

    for (let i = 0; i < properties.length; i++) {
      const property = properties[i];

      const sizeText = property.type === 'Land'
        ? `${property.plot_size}`
        : property.bedrooms === 0 ? 'Studio'
        : `${property.bedrooms} Bed${property.bedrooms > 1 ? 's' : ''}`;

      const sqmText = property.sqm ? ` (${property.sqm}sqm)` : '';
      const priceFormatted = `KES ${Number(property.price || 0).toLocaleString()}`;

      const propertyHeader =
        `🏢 *PROPERTY ${i + 1}*\n──────────\n\n` +
        (property.project_name ? `*${property.project_name}*\n` : '') +
        `*${property.property_name}*\n\n` +
        `📍 ${property.location}\n` +
        `💰 ${priceFormatted}\n` +
        `🛏 ${sizeText}${sqmText}\n` +
        (property.completion_date ? `🏗 Completion: ${property.completion_date}\n` : '') +
        `📮 ${property.address}`;

      const descriptionText = property.description ? `\n\n${property.description}` : '';
      const footer = `\n\n──────────\nReply *Property${i + 1}* to book a viewing`;
      const fullMessage = propertyHeader + descriptionText + footer;

      if (fullMessage.length <= 1500) {
        await sendMessage(tenantWhatsApp, from, fullMessage, property.photo_url || null);
      } else {
        await sendMessage(tenantWhatsApp, from, propertyHeader + footer, property.photo_url || null);
        if (property.description) {
          await delay(1000);
          const chunks = [];
          let start = 0;
          while (start < property.description.length) {
            let end = start + 1500;
            if (end < property.description.length) {
              const lastNewline = property.description.lastIndexOf('\n', end);
              if (lastNewline > start) end = lastNewline;
            }
            chunks.push(property.description.substring(start, end));
            start = end;
          }
          for (const chunk of chunks) {
            await sendMessage(tenantWhatsApp, from, chunk, null);
            await delay(1000);
          }
        }
      }

      if (i < properties.length - 1) await delay(2000);
    }

    await delay(1500);
    await sendMessage(
      tenantWhatsApp, from,
      `Found ${properties.length} propert${properties.length > 1 ? 'ies' : 'y'} for you! 🏡\n\n` +
      `Reply *Property1*${properties.length > 1 ? `, *Property2*` : ''} etc. to book a viewing.`
    );

  } else {
    await sendMessage(
      tenantWhatsApp, from,
      `Sorry, I could not find properties matching your exact criteria.\n\n` +
      `Our agent will contact you personally:\n` +
      `👤 ${agentName || 'Agent'}\n📞 ${agentPhone || 'N/A'}\n\n` +
      `Reply *HI* to start a new search.`
    );

    if (agentPhone) {
      await sendTemplateToAgent(tenantWhatsApp, agentPhone, TEMPLATES.NO_PROPERTY_FOUND,
        { "1": lead.name || 'Unknown', "2": cleanLeadPhone, "3": kenyaTime }
      );
    }
  }
}

// ============================================
// WEBHOOK: Receive WhatsApp messages from Twilio
// ============================================
router.post('/', async (req, res) => {
  const from = req.body.From;
  const to = req.body.To;
  const message = req.body.Body;

  console.log(`Message from ${from} to ${to}: ${message}`);

  res.status(200).send('<Response></Response>');

  try {
    const { tenant, lead } = await getTenantAndLead(to, from);

    if (!tenant) {
      await sendMessage(to, from, 'Sorry, this service is not available on this number.');
      return;
    }

    const tenantWhatsApp = tenant.whatsapp_number;

    const { data: agentData } = await supabase
      .from('agents')
      .select('agent_name, phone, email')
      .eq('tenant_id', tenant.id)
      .eq('active', true)
      .single();

    const agentPhone = agentData?.phone || null;
    const agentName = agentData?.agent_name || 'Our Agent';
    const cleanLeadPhone = lead?.phone
      ? lead.phone.replace('whatsapp:', '').trim()
      : from.replace('whatsapp:', '').trim();

    const now = new Date();
    const kenyaTime = now.toLocaleTimeString('en-KE', {
      timeZone: 'Africa/Nairobi', hour: 'numeric', minute: '2-digit', hour12: true
    });

    const msgLower = message.toLowerCase().trim();

    // ============================================
    // STEP 1: CANCELLATION (exact command)
    // ============================================
    if (msgLower === 'cancel' && lead?.conversation_stage === 'booking_confirmed') {
      const cancelResponse = await fetch(`${BACKEND_URL}/api/cancel-booking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: lead.id, calendarId: tenant.google_calendar_id })
      });
      const cancelData = await cancelResponse.json();
      await supabase.from('leads').update({ conversation_stage: 'booking_cancelled' }).eq('id', lead.id);
      await sendMessage(tenantWhatsApp, from, cancelData.userMessage);
      if (agentPhone) {
        await sendTemplateToAgent(tenantWhatsApp, agentPhone, TEMPLATES.BOOKING_CANCELLED,
          { "1": lead.name || 'Unknown', "2": cleanLeadPhone }
        );
      }
      return;
    }

    // ============================================
    // STEP 2: PROPERTY SELECTION
    // "Property1", "property 2", or bare digit after search completed
    // ============================================
    const propertySelectMatch =
      msgLower.match(/^property\s*(\d+)$/i) ||
      (lead?.conversation_stage === 'completed' && msgLower.match(/^(\d+)$/));

    if (propertySelectMatch) {
      const propNum = parseInt(propertySelectMatch[1]);
      console.log('Property selection detected:', propNum);

      let searchResults = lead?.search_results || [];
      if (!searchResults || searchResults.length === 0) {
        const { data: freshLead } = await supabase.from('leads').select('search_results').eq('id', lead.id).single();
        searchResults = freshLead?.search_results || [];
      }

      const selectedProperty = searchResults.find(p => p.number === propNum);

      if (selectedProperty) {
        console.log('Found property:', selectedProperty.name);

        await supabase.from('leads').update({
          selected_property_number: propNum,
          selected_property_id: selectedProperty.id,
          last_viewed_property: selectedProperty.name,
          conversation_stage: 'awaiting_time_slot'
        }).eq('id', lead.id);

        await sendMessage(tenantWhatsApp, from,
          `Great choice! 🎉 Let me check availability for *${selectedProperty.name}*...`
        );

        const slotsResponse = await fetch(`${BACKEND_URL}/api/available-slots-v2`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId: tenant.id, propertyId: selectedProperty.id, leadId: lead.id })
        });
        const slotsData = await slotsResponse.json();

        await supabase.from('leads').update({ available_slots: slotsData.slotMap }).eq('id', lead.id);
        await sendMessage(tenantWhatsApp, from, slotsData.message);
        return;
      }
    }

    // ============================================
    // STEP 3: SLOT SELECTION
    // Only fires when awaiting_time_slot
    // ============================================
    const slotSelectMatch = lead?.conversation_stage === 'awaiting_time_slot' &&
      (msgLower.match(/^slot\s*(\d+)$/i) || msgLower.match(/^(\d+)$/));

    if (slotSelectMatch) {
      const slotNum = parseInt(slotSelectMatch[1]);
      console.log('Slot selection detected:', slotNum);

      const { data: freshLead } = await supabase.from('leads').select('*').eq('id', lead.id).single();
      const propertyId = freshLead?.selected_property_id;
      const slotMap = freshLead?.available_slots || '{}';

      if (!propertyId) {
        await sendMessage(tenantWhatsApp, from, `Sorry, I lost track of which property you selected.\n\nReply *HI* to start over.`);
        return;
      }

      await sendMessage(tenantWhatsApp, from, `Creating your booking... ✅`);

      const bookingResponse = await fetch(`${BACKEND_URL}/api/create-booking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: tenant.id, leadId: lead.id, propertyId,
          slotNumber: slotNum.toString(), slotMap,
          leadName: freshLead?.name || 'Client', leadPhone: from
        })
      });
      const bookingData = await bookingResponse.json();

      if (bookingData.success) {
        await supabase.from('leads').update({ conversation_stage: 'booking_confirmed' }).eq('id', lead.id);
        await sendMessage(tenantWhatsApp, from, bookingData.message);
        if (agentPhone) {
          await sendTemplateToAgent(tenantWhatsApp, agentPhone, TEMPLATES.BOOKING_CONFIRMED, {
            "1": freshLead?.name || 'Unknown',
            "2": cleanLeadPhone,
            "3": bookingData.slotDetails?.property || 'N/A',
            "4": `KES ${Number(bookingData.slotDetails?.price || 0).toLocaleString()}`,
            "5": `KES ${freshLead?.budget || 'N/A'}`,
            "6": freshLead?.location || 'N/A',
            "7": bookingData.slotDetails?.date || 'N/A',
            "8": bookingData.slotDetails?.time || 'N/A'
          });
        }
      } else if (bookingData.slotTaken) {
        const newSlotsResponse = await fetch(`${BACKEND_URL}/api/available-slots-v2`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId: tenant.id, propertyId, leadId: lead.id })
        });
        const newSlotsData = await newSlotsResponse.json();
        await supabase.from('leads').update({
          conversation_stage: 'awaiting_time_slot',
          available_slots: newSlotsData.slotMap
        }).eq('id', lead.id);
        await sendMessage(tenantWhatsApp, from,
          `Sorry, that slot was just taken.\n\nHere are the next available times:\n\n${newSlotsData.message}`
        );
      } else {
        await sendMessage(tenantWhatsApp, from,
          `Sorry, something went wrong with your booking.\n\nOur agent will contact you shortly.\n\nAgent: ${agentName}\nPhone: ${agentPhone || 'N/A'}`
        );
      }
      return;
    }

    // ============================================
    // STEP 4: PRE-EXTRACTION
    // Extract clear simple answers without AI
    // CRITICAL RULE: Only extract fields NOT yet saved
    // Never overwrite what is already in the DB
    // ============================================
    let preExtracted = {};

    // Interest — only if not yet set
    if (!lead?.interest) {
      if (['buy', 'buying', 'purchase', 'i want to buy', "i'm looking to buy"].includes(msgLower) ||
          msgLower.includes('looking to buy') || msgLower.includes('want to buy')) {
        preExtracted.interest = 'Buy';
      } else if (['rent', 'renting', 'rental', 'i want to rent', "i'm looking to rent"].includes(msgLower) ||
          msgLower.includes('looking to rent') || msgLower.includes('want to rent')) {
        preExtracted.interest = 'Rent';
      } else if (['land', 'i want land', 'plot'].includes(msgLower)) {
        preExtracted.interest = 'Land';
      }
    }

    // Bedrooms — only if size not yet set
    if (!lead?.size) {
      // Match "3 bed", "3 bedroom", "3 bedrooms"
      const bedroomWordMatch = msgLower.match(/(\d+)\s*bed(?:room)?s?/i) || msgLower.match(/^studio$/i);
      if (bedroomWordMatch) {
        if (msgLower === 'studio') {
          preExtracted.bedrooms = 0;
          preExtracted.size = 'Studio';
        } else {
          const num = parseInt(bedroomWordMatch[1]);
          if (num >= 0 && num <= 10) {
            preExtracted.bedrooms = num;
            preExtracted.size = `${num} bedroom`;
          }
        }
      }

      // Bare digit for bedrooms ONLY when offplan is already known
      // At that point we know the user is answering the bedroom question
      if (!bedroomWordMatch && (lead?.is_offplan === true || lead?.is_offplan === false)) {
        const bareDigit = msgLower.match(/^(\d+)$/);
        if (bareDigit) {
          const num = parseInt(bareDigit[1]);
          if (num >= 0 && num <= 10) {
            preExtracted.bedrooms = num;
            preExtracted.size = num === 0 ? 'Studio' : `${num} bedroom`;
          }
        }
      }
    }

    // Off-plan — only if not yet set, only in safe stages
    if (lead?.is_offplan === null || lead?.is_offplan === undefined) {
      const safeForOffplan = !['awaiting_time_slot', 'completed', 'booking_confirmed'].includes(lead?.conversation_stage);
      if (safeForOffplan) {
        if (['offplan', 'off-plan', 'off plan', 'under construction', 'yes offplan'].includes(msgLower) ||
            msgLower.includes('off plan') || msgLower.includes('off-plan') || msgLower.includes('offplan')) {
          preExtracted.is_offplan = true;
        } else if (['ready', 'ready to move', 'move in', 'ready property'].includes(msgLower) ||
            msgLower.includes('ready to move') || msgLower.includes('move in')) {
          preExtracted.is_offplan = false;
        }

        // Bare "1"=ready or "2"=offplan ONLY when we are on the offplan question
        // We know it's the offplan question when: size is set but is_offplan is not
        if (lead?.size && (lead?.is_offplan === null || lead?.is_offplan === undefined)) {
          if (msgLower === '1') preExtracted.is_offplan = false;
          if (msgLower === '2') preExtracted.is_offplan = true;
        }
      }
    }

    // Completion date — match against actual DB dates only, never guess
    if (lead?.is_offplan === true && !lead?.completion_range && lead?.interest && lead?.location) {
      const { data: dateProps } = await supabase
        .from('properties')
        .select('completion_date')
        .eq('tenant_id', tenant.id)
        .eq('available', true)
        .ilike('type', lead.interest)
        .ilike('location', lead.location)
        .eq('is_offplan', true);

      if (dateProps && dateProps.length > 0) {
        const availableDates = [...new Set(dateProps.map(p => p.completion_date).filter(Boolean))];
        const matchedDate = availableDates.find(date => msgLower.includes(date.toLowerCase()));
        if (matchedDate) preExtracted.completion_range = matchedDate;
      }
    }

    // Budget — ONLY when size AND offplan are already saved (budget is the last question)
    // Minimum 100k sanity check prevents small numbers being mistaken for budgets
    if (lead?.size && (lead?.is_offplan === true || lead?.is_offplan === false) && !lead?.budget) {
      const budgetPatterns = [
        { pattern: /kes\s*(\d+\.?\d*)\s*m/i, multiplier: 1000000 },
        { pattern: /kes\s*(\d+\.?\d*)\s*million/i, multiplier: 1000000 },
        { pattern: /kes\s*(\d+\.?\d*)\s*k/i, multiplier: 1000 },
        { pattern: /^(\d+\.?\d*)\s*m$/i, multiplier: 1000000 },
        { pattern: /^(\d+\.?\d*)\s*million/i, multiplier: 1000000 },
        { pattern: /^(\d+\.?\d*)\s*k$/i, multiplier: 1000 },
        { pattern: /^kes\s*(\d+[\d,]*)/i, multiplier: 1 },
        { pattern: /^(\d[\d,]{5,})$/, multiplier: 1 }  // 6+ digit raw numbers only
      ];

      for (const { pattern, multiplier } of budgetPatterns) {
        const match = msgLower.match(pattern);
        if (match) {
          const amount = parseFloat(match[1].replace(/,/g, '')) * multiplier;
          if (!isNaN(amount) && amount >= 100000) {
            preExtracted.budget = amount;
            break;
          }
        }
      }
    }

    // ============================================
    // STEP 5: SAVE PRE-EXTRACTED — PATCH ONLY
    // Only write the fields we just extracted
    // Never touch fields already in the database
    // ============================================
    if (Object.keys(preExtracted).length > 0) {
      console.log('Pre-extracted data:', preExtracted);

      // Validate offplan against DB
      if (preExtracted.is_offplan !== undefined && lead?.interest && lead?.location) {
        const { data: propData } = await supabase
          .from('properties')
          .select('is_offplan')
          .eq('tenant_id', tenant.id)
          .eq('available', true)
          .ilike('type', lead.interest)
          .ilike('location', lead.location);

        if (propData && propData.length > 0) {
          const hasOffplan = propData.some(p => p.is_offplan === true);
          const hasReady = propData.some(p => p.is_offplan === false);
          if (preExtracted.is_offplan === true && !hasOffplan) preExtracted.is_offplan = false;
          if (preExtracted.is_offplan === false && !hasReady) preExtracted.is_offplan = true;
        }
      }

      // Build patch — only extracted fields
      const patchUpdate = {};
      if (preExtracted.interest !== undefined) patchUpdate.interest = preExtracted.interest;
      if (preExtracted.bedrooms !== undefined) patchUpdate.bedrooms = preExtracted.bedrooms;
      if (preExtracted.size !== undefined) patchUpdate.size = preExtracted.size;
      if (preExtracted.is_offplan !== undefined) patchUpdate.is_offplan = preExtracted.is_offplan;
      if (preExtracted.completion_range !== undefined) patchUpdate.completion_range = preExtracted.completion_range;
      if (preExtracted.budget !== undefined) patchUpdate.budget = preExtracted.budget.toString();

      if (lead && Object.keys(patchUpdate).length > 0) {
        await supabase.from('leads').update(patchUpdate).eq('id', lead.id);
      }
    }

    // ============================================
    // STEP 6: FETCH FRESH LEAD — single source of truth
    // ============================================
    let currentLead = lead;
    if (lead) {
      const { data: refreshed } = await supabase.from('leads').select('*').eq('id', lead.id).single();
      if (refreshed) currentLead = refreshed;
    }

    console.log('Current lead state:', {
      interest: currentLead?.interest,
      location: currentLead?.location,
      size: currentLead?.size,
      is_offplan: currentLead?.is_offplan,
      completion_range: currentLead?.completion_range,
      budget: currentLead?.budget
    });

    // ============================================
    // STEP 7: CHECK IF READY TO SEARCH
    // ============================================
    const isOffplanSet = currentLead?.is_offplan === true || currentLead?.is_offplan === false;
    const completionReady = currentLead?.is_offplan === false ||
      (currentLead?.is_offplan === true && currentLead?.completion_range);

    const readyToSearch =
      currentLead?.interest &&
      currentLead?.location &&
      currentLead?.size &&
      isOffplanSet &&
      completionReady &&
      currentLead?.budget;

    console.log('Ready to search:', !!readyToSearch);

    if (readyToSearch) {
      await sendMessage(
        tenantWhatsApp, from,
        `✅ Got it! Let me find the best matches for you...\n\n` +
        `📋 Your preferences:\n` +
        `• Type: ${currentLead.interest}\n` +
        `• Location: ${currentLead.location}\n` +
        `• Size: ${currentLead.size}\n` +
        `• Budget: KES ${Number(currentLead.budget).toLocaleString()}\n\n` +
        `Searching properties... 🔍`
      );

      const properties = await searchProperties(
        tenant.id,
        currentLead.interest,
        currentLead.location,
        currentLead.size,
        currentLead.budget,
        currentLead.is_offplan,
        currentLead.completion_range
      );

      await handlePropertyResults(
        properties, currentLead, tenant, tenantWhatsApp,
        from, agentName, agentPhone, cleanLeadPhone, kenyaTime
      );
      return;
    }

    // ============================================
    // STEP 8: AI ENGINE
    // All simple cases handled — use AI for natural
    // language understanding and asking next question
    // ============================================
    const conversationHistory = currentLead?.conversation_history || [];

    console.log('Processing with AI...');
    console.log('Lead stage:', currentLead?.conversation_stage);
    console.log('History length:', conversationHistory.length);

    const aiResult = await processAIConversation({
      userMessage: message,
      lead: currentLead,
      tenant: tenant,
      conversationHistory: conversationHistory,
      agentName: agentName,
      agentPhone: agentPhone,
      isNewLead: !currentLead
    });

    console.log('AI action:', aiResult.action);
    console.log('AI extracted:', JSON.stringify(aiResult.extracted));

    const updatedHistory = [
      ...conversationHistory,
      { role: 'user', content: message },
      { role: 'assistant', content: aiResult.message }
    ].slice(-10);

    // ============================================
    // STEP 9: SAVE AI EXTRACTED DATA — PATCH ONLY
    // AI extracts name, location, and complex fields
    // Same rule: never overwrite existing DB fields
    // ============================================
    const aiUpdate = {
      conversation_history: updatedHistory,
      conversation_stage: aiResult.action
    };

    if (aiResult.extracted) {
      const e = aiResult.extracted;

      if (e.name && !currentLead?.name) aiUpdate.name = e.name;

      if (e.interest && !currentLead?.interest) {
        const interestMap = {
          'buy': 'Buy', 'buying': 'Buy', 'purchase': 'Buy',
          'rent': 'Rent', 'renting': 'Rent', 'rental': 'Rent', 'land': 'Land'
        };
        aiUpdate.interest = interestMap[e.interest.toLowerCase()] || e.interest;
      }

      if (e.location && !currentLead?.location) {
        aiUpdate.location = e.location.split(' ')
          .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(' ');
      }

      if (!currentLead?.size) {
        if (e.bedrooms !== null && e.bedrooms !== undefined) {
          const n = parseInt(e.bedrooms);
          if (!isNaN(n)) { aiUpdate.size = n === 0 ? 'Studio' : `${n} bedroom`; aiUpdate.bedrooms = n; }
        } else if (e.size) {
          aiUpdate.size = e.size;
          if (e.size.toLowerCase().includes('studio')) aiUpdate.bedrooms = 0;
          else { const m = e.size.match(/(\d+)/); if (m) aiUpdate.bedrooms = parseInt(m[1]); }
        }
      }

      // Budget from AI — only when size and offplan are known
      if (!currentLead?.budget && currentLead?.size &&
          (currentLead?.is_offplan === true || currentLead?.is_offplan === false)) {
        if (e.budget !== null && e.budget !== undefined) {
          let bv = e.budget;
          if (typeof bv === 'string') {
            bv = bv.replace(/KES/gi, '').replace(/,/g, '').trim();
            if (bv.toLowerCase().endsWith('m')) bv = parseFloat(bv) * 1000000;
            else if (bv.toLowerCase().endsWith('k')) bv = parseFloat(bv) * 1000;
            else bv = parseFloat(bv);
          }
          if (!isNaN(bv) && bv >= 100000) aiUpdate.budget = bv.toString();
        }
      }

      // Offplan from AI — only if not already set
      if ((e.is_offplan === true || e.is_offplan === false) &&
          currentLead?.is_offplan === null || currentLead?.is_offplan === undefined) {
        aiUpdate.is_offplan = e.is_offplan;
      }

      // Completion range from AI — must contain a 4-digit year to be valid
      if (e.completion_range && !currentLead?.completion_range) {
        if (/\d{4}/.test(e.completion_range)) {
          aiUpdate.completion_range = e.completion_range;
        }
      }

      // Restart
      if (e.restart === true) {
        Object.assign(aiUpdate, {
          interest: null, location: null, size: null, budget: null,
          is_offplan: null, completion_range: null, search_results: null,
          conversation_history: []
        });
      }
    }

    // Create new lead
    if (!currentLead) {
      const { data: newLead, error: createError } = await supabase
        .from('leads')
        .insert({
          phone: from, tenant_id: tenant.id, status: 'New',
          conversation_stage: aiResult.action,
          conversation_history: updatedHistory,
          name: aiUpdate.name || null,
          interest: aiUpdate.interest || null,
          location: aiUpdate.location || null,
          size: aiUpdate.size || null,
          budget: aiUpdate.budget || null,
          is_offplan: aiUpdate.is_offplan ?? null,
          completion_range: aiUpdate.completion_range || null
        })
        .select().single();

      if (createError) console.error('Error creating lead:', createError);
      await sendMessage(tenantWhatsApp, from, aiResult.message);
      return;
    }

    // Update existing lead
    await supabase.from('leads').update(aiUpdate).eq('id', lead.id);

    // ============================================
    // STEP 10: HANDLE SPECIAL AI ACTIONS
    // ============================================

    if (aiResult.action === 'search_properties') {
      await sendMessage(tenantWhatsApp, from, aiResult.message);

      const { data: searchLead } = await supabase.from('leads').select('*').eq('id', lead.id).single();

      console.log('Searching with final lead data:', {
        interest: searchLead?.interest, location: searchLead?.location,
        size: searchLead?.size, budget: searchLead?.budget,
        is_offplan: searchLead?.is_offplan, completion_range: searchLead?.completion_range
      });

      const properties = await searchProperties(
        tenant.id, searchLead?.interest, searchLead?.location,
        searchLead?.size, searchLead?.budget,
        searchLead?.is_offplan, searchLead?.completion_range
      );

      if (properties.length > 0) {
        const searchResultsToSave = properties.map((p, i) => ({
          number: i + 1, id: p.id, name: p.property_name, price: p.price,
          location: p.location, address: p.address, bedrooms: p.bedrooms,
          plot_size: p.plot_size, type: p.type, photo_url: p.photo_url
        }));

        await supabase.from('leads').update({
          search_results: searchResultsToSave,
          conversation_stage: 'completed',
          status: 'Contacted'
        }).eq('id', lead.id);

        for (let i = 0; i < properties.length; i++) {
          const property = properties[i];
          try {
            const sizeText = property.type === 'Land' ? `${property.plot_size}`
              : property.bedrooms === 0 ? `Studio`
              : `${property.bedrooms} Bed${property.bedrooms > 1 ? 's' : ''}`;
            const sqmText = property.sqm ? ` (${property.sqm}sqm)` : '';
            const priceFormatted = `KES ${Number(property.price || 0).toLocaleString()}`;

            const propertyHeader =
              `🏢 *PROPERTY ${i + 1}*\n──────────\n\n` +
              (property.project_name ? `*${property.project_name}*\n` : '') +
              `*${property.property_name}*\n\n` +
              `📍 ${property.location}\n💰 ${priceFormatted}\n` +
              `🛏 ${sizeText}${sqmText}\n` +
              (property.completion_date ? `🏗 Completion: ${property.completion_date}\n` : '') +
              `📮 ${property.address}`;

            const descriptionText = property.description ? `\n\n${property.description}` : '';
            const footer = `\n\n──────────\nReply *Property${i + 1}* to book a viewing`;
            const fullMessage = propertyHeader + descriptionText + footer;

            if (fullMessage.length <= 1500) {
              await sendMessage(tenantWhatsApp, from, fullMessage, property.photo_url || null);
            } else {
              await sendMessage(tenantWhatsApp, from, propertyHeader + footer, property.photo_url || null);
              if (property.description) {
                await delay(1000);
                const chunks = [];
                let start = 0;
                while (start < property.description.length) {
                  let end = start + 1500;
                  if (end < property.description.length) {
                    const lastNewline = property.description.lastIndexOf('\n', end);
                    if (lastNewline > start) end = lastNewline;
                  }
                  chunks.push(property.description.substring(start, end));
                  start = end;
                }
                for (const chunk of chunks) {
                  await sendMessage(tenantWhatsApp, from, chunk, null);
                  await delay(1000);
                }
              }
            }
            if (i < properties.length - 1) await delay(2000);
          } catch (propError) {
            console.error(`Error sending property ${i + 1}:`, propError.message);
            continue;
          }
        }

        const followUpAI = await processAIConversation({
          userMessage: `[SYSTEM: ${properties.length} properties sent. Brief friendly follow-up asking if they want to book a viewing. Mention Property1, Property2 etc.]`,
          lead: { ...searchLead, conversation_stage: 'completed' },
          tenant, conversationHistory: updatedHistory, agentName, agentPhone
        });

        await delay(1500);
        await sendMessage(tenantWhatsApp, from, followUpAI.message);

      } else {
        const noResultAI = await processAIConversation({
          userMessage: `[SYSTEM: No properties found. Apologize naturally and suggest contacting the agent. Be warm.]`,
          lead, tenant, conversationHistory: updatedHistory, agentName, agentPhone
        });

        await supabase.from('leads').update({ conversation_stage: 'no_results' }).eq('id', lead.id);
        await sendMessage(tenantWhatsApp, from, noResultAI.message);

        if (agentPhone) {
          await sendTemplateToAgent(tenantWhatsApp, agentPhone, TEMPLATES.NO_PROPERTY_FOUND,
            { "1": lead.name || 'Unknown', "2": cleanLeadPhone, "3": kenyaTime }
          );
        }
      }
      return;
    }

    if (aiResult.action === 'booking') {
      let propertyNumber = aiResult.extracted?.property_number;
      if (!propertyNumber) {
        const match = message.match(/property\s*(\d+)/i) || message.match(/^(\d+)$/);
        if (match) propertyNumber = parseInt(match[1]);
      }

      if (!propertyNumber) {
        await sendMessage(tenantWhatsApp, from, `Please reply with the property number you want to view.\n\nExample: *Property1* or just *1*`);
        return;
      }

      let searchResults = currentLead?.search_results || [];
      if (!searchResults || searchResults.length === 0) {
        const { data: fl } = await supabase.from('leads').select('search_results').eq('id', lead.id).single();
        searchResults = fl?.search_results || [];
      }

      const selectedProperty = searchResults.find(p => p.number === propertyNumber);
      if (!selectedProperty) {
        await sendMessage(tenantWhatsApp, from,
          `I could not find property ${propertyNumber}.\n\nPlease reply with a number from 1 to ${searchResults.length || '?'}.\n\nOr reply *HI* to start a new search.`
        );
        return;
      }

      await sendMessage(tenantWhatsApp, from, `Great choice! 🎉 Let me check availability for *${selectedProperty.name}*...`);

      await supabase.from('leads').update({
        selected_property_number: propertyNumber,
        selected_property_id: selectedProperty.id,
        last_viewed_property: selectedProperty.name,
        conversation_stage: 'awaiting_time_slot'
      }).eq('id', lead.id);

      const slotsResponse = await fetch(`${BACKEND_URL}/api/available-slots-v2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: tenant.id, propertyId: selectedProperty.id, leadId: lead.id })
      });
      const slotsData = await slotsResponse.json();
      await supabase.from('leads').update({ available_slots: slotsData.slotMap }).eq('id', lead.id);
      await sendMessage(tenantWhatsApp, from, slotsData.message);
      return;
    }

    if (aiResult.action === 'cancel_booking') {
      await sendMessage(tenantWhatsApp, from, aiResult.message);
      const cancelResponse = await fetch(`${BACKEND_URL}/api/cancel-booking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: lead.id, calendarId: tenant.google_calendar_id })
      });
      const cancelData = await cancelResponse.json();
      await supabase.from('leads').update({ conversation_stage: 'booking_cancelled' }).eq('id', lead.id);
      await sendMessage(tenantWhatsApp, from, cancelData.userMessage);
      if (cancelData.agentNotification?.agentPhone) {
        await sendTemplateToAgent(tenantWhatsApp, agentPhone, TEMPLATES.BOOKING_CANCELLED,
          { "1": lead.name || 'Unknown', "2": cleanLeadPhone }
        );
      }
      return;
    }

    if (aiResult.action === 'human_handoff') {
      await sendMessage(tenantWhatsApp, from, aiResult.message);
      return;
    }

    if (currentLead?.awaiting_followup_response) {
      if (message === '1' || msgLower.includes('interested')) {
        await supabase.from('leads').update({
          status: 'Hot Lead', conversation_stage: 'interested_after_viewing', awaiting_followup_response: false
        }).eq('id', lead.id);
        await sendMessage(tenantWhatsApp, from, aiResult.message);
        if (agentPhone) {
          await sendTemplateToAgent(tenantWhatsApp, agentPhone, TEMPLATES.HOT_LEAD,
            { "1": lead.name || 'Unknown', "2": cleanLeadPhone, "3": lead.last_viewed_property || 'N/A' }
          );
        }
        return;
      }
      if (message === '2' || msgLower.includes('not interested')) {
        await supabase.from('leads').update({
          status: 'Not Interested', conversation_stage: 'not_interested_after_viewing', awaiting_followup_response: false
        }).eq('id', lead.id);
        await sendMessage(tenantWhatsApp, from, aiResult.message);
        return;
      }
    }

    // DEFAULT
    await sendMessage(tenantWhatsApp, from, aiResult.message);

  } catch (error) {
    console.error('Error in webhook:', error);
    try {
      const { tenant } = await getTenantAndLead(to, from);
      if (tenant) {
        await sendMessage(tenant.whatsapp_number, from,
          `Sorry, something went wrong on our end.\n\nOur agent will contact you shortly to assist you.`
        );
        const { data: agentData } = await supabase.from('agents').select('phone')
          .eq('tenant_id', tenant.id).eq('active', true).single();
        if (agentData?.phone) {
          await sendMessage(tenant.whatsapp_number, `whatsapp:${agentData.phone}`,
            `System Alert!\n\nA client needs manual assistance.\n\nClient number: ${from.replace('whatsapp:', '')}\n\nPlease contact them directly.`
          );
        }
      }
    } catch (fallbackError) {
      console.error('Fallback notification failed:', fallbackError);
    }
  }
});

module.exports = router;