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
    // All properties same price
    ranges['1'] = { min: minPrice * 0.9, max: minPrice * 1.1, label: `Around KES ${Number(minPrice).toLocaleString()}` };
    return ranges;
  }

  // Create up to 4 meaningful ranges
  const step = spread / 4;
  let rangeCount = 1;

  for (let i = 0; i < 4; i++) {
    const rangeMin = Math.floor((minPrice + (step * i)) / 1000000) * 1000000;
    const rangeMax = Math.ceil((minPrice + (step * (i + 1))) / 1000000) * 1000000;

    // Only add range if it contains actual properties
    if (rangeMin !== rangeMax) {
      ranges[rangeCount.toString()] = {
        min: rangeMin,
        max: rangeMax
      };
      rangeCount++;
    }
  }

  // Always add "Any budget" as last option
  ranges[rangeCount.toString()] = {
    min: 0,
    max: 999999999999,
    label: 'Any budget'
  };

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
  // Check for studio first
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
      tenantId,
      normalizedInterest,
      normalizedLocation,
      size
    });
    
    // Parse budget - remove any non-numeric characters
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

// Add budget filter with 20% flexibility
// This means if user budget is 10M we show properties up to 12M
// so we dont miss good matches that are slightly above budget
if (budgetNumber && budgetNumber > 0) {
  const flexibleBudget = budgetNumber * 1.2;
  query = query.lte('price', flexibleBudget);
}

// Add offplan filter
if (isOffplan === true) {
  query = query.eq('is_offplan', true)

  // Add completion date range filter
  if (completionRange && completionRange !== 'any') {
    if (completionRange === '2026') {
      query = query.ilike('completion_date', '%2026%')
    } else if (completionRange === '2027') {
      query = query.ilike('completion_date', '%2027%')
    } else if (completionRange === '2028') {
      query = query.ilike('completion_date', '%2028%')
    } else if (completionRange === '2029+') {
      // For 2029 and beyond we exclude 2026 2027 2028
      query = query.not('completion_date', 'ilike', '%2026%')
        .not('completion_date', 'ilike', '%2027%')
        .not('completion_date', 'ilike', '%2028%')
    }
  }
} else if (isOffplan === false) {
  query = query.eq('is_offplan', false)
}
// If isOffplan is null show all properties

    if (normalizedInterest === 'Land') {
      const cleanPlotSize = size ? size.replace(/\s+/g, '').toLowerCase() : '';
      if (cleanPlotSize) {
        query = query.ilike('plot_size', `%${cleanPlotSize}%`);
      }
    } else {
      const bedroomNumber = extractBedrooms(size);
      console.log('Extracted bedroom number:', bedroomNumber);
      if (bedroomNumber) {
        query = query.eq('bedrooms', bedroomNumber);
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
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  });
}

// ============================================
// Helper: Format Kenya time
// ============================================
function formatKenyaTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-KE', {
    timeZone: 'Africa/Nairobi',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

// ============================================
// WEBHOOK: Receive WhatsApp messages from Twilio
// ============================================
router.post('/', async (req, res) => {
  const from = req.body.From;
  const to = req.body.To;
  const message = req.body.Body;

  console.log(`Message from ${from} to ${to}: ${message}`);

  // Respond to Twilio immediately to prevent timeout
  res.status(200).send('<Response></Response>');

  try {
    // Look up tenant and lead
    const { tenant, lead } = await getTenantAndLead(to, from);

    if (!tenant) {
      await sendMessage(to, from, 'Sorry, this service is not available on this number.');
      return;
    }

    const tenantWhatsApp = tenant.whatsapp_number;

    // Get agent details
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

    // Get current Kenya time for templates
    const now = new Date();
    const kenyaTime = now.toLocaleTimeString('en-KE', {
      timeZone: 'Africa/Nairobi',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    // ============================================
// AI CONVERSATION ENGINE
// ============================================

// Build conversation history array
const conversationHistory = lead?.conversation_history || [];

console.log('Processing with AI...');
console.log('Lead stage:', lead?.conversation_stage);
console.log('History length:', conversationHistory.length);

// Get AI response
const aiResult = await processAIConversation({
  userMessage: message,
  lead: lead,
  tenant: tenant,
  conversationHistory: conversationHistory,
  agentName: agentName,
  agentPhone: agentPhone
});

console.log('AI action:', aiResult.action);
console.log('AI extracted:', JSON.stringify(aiResult.extracted));

// -----------------------------------------------
// Update conversation history
// -----------------------------------------------
const updatedHistory = [
  ...conversationHistory,
  { role: 'user', content: message },
  { role: 'assistant', content: aiResult.message }
];

// Keep only last 20 messages to avoid token limits
const trimmedHistory = updatedHistory.slice(-20);

// -----------------------------------------------
// Update lead with extracted information
// -----------------------------------------------
const leadUpdateData = {
  conversation_history: trimmedHistory,
  conversation_stage: aiResult.action
};

// Apply extracted fields
if (aiResult.extracted) {
  const e = aiResult.extracted;
  if (e.name) leadUpdateData.name = e.name;
  if (e.interest) leadUpdateData.interest = e.interest;
  if (e.location) leadUpdateData.location = e.location;
  if (e.size) leadUpdateData.size = e.size;
  if (e.bedrooms !== null && e.bedrooms !== undefined) leadUpdateData.bedrooms = e.bedrooms;
  if (e.budget) leadUpdateData.budget = e.budget.toString();
  if (e.is_offplan !== null && e.is_offplan !== undefined) leadUpdateData.is_offplan = e.is_offplan;
  if (e.completion_range) leadUpdateData.completion_range = e.completion_range;
}

// -----------------------------------------------
// Handle actions
// -----------------------------------------------

// CREATE new lead if does not exist
if (!lead) {
  const { data: newLead, error: createError } = await supabase
    .from('leads')
    .insert({
      phone: from,
      tenant_id: tenant.id,
      status: 'New',
      conversation_stage: aiResult.action,
      conversation_history: trimmedHistory,
      name: aiResult.extracted?.name || null,
      interest: aiResult.extracted?.interest || null,
      location: aiResult.extracted?.location || null,
      size: aiResult.extracted?.size || null,
      budget: aiResult.extracted?.budget?.toString() || null,
      is_offplan: aiResult.extracted?.is_offplan ?? null,
      completion_range: aiResult.extracted?.completion_range || null
    })
    .select()
    .single();

  if (createError) {
    console.error('Error creating lead:', createError);
  }

  // Send AI reply
  await sendMessage(tenantWhatsApp, from, aiResult.message);
  return;
}

// Update existing lead
await supabase
  .from('leads')
  .update(leadUpdateData)
  .eq('id', lead.id);

// ACTION: search_properties
if (aiResult.action === 'search_properties') {
  await sendMessage(tenantWhatsApp, from, aiResult.message);

  // Get fresh lead data after update
  const { data: freshLead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', lead.id)
    .single();

  const searchInterest = freshLead?.interest || aiResult.extracted?.interest;
  const searchLocation = freshLead?.location || aiResult.extracted?.location;
  const searchSize = freshLead?.size || aiResult.extracted?.size;
  const searchBudget = freshLead?.budget || aiResult.extracted?.budget;
  const searchIsOffplan = freshLead?.is_offplan;
  const searchCompletionRange = freshLead?.completion_range;

  console.log('Searching with AI extracted data:', {
    searchInterest,
    searchLocation,
    searchSize,
    searchBudget,
    searchIsOffplan,
    searchCompletionRange
  });

  const properties = await searchProperties(
    tenant.id,
    searchInterest,
    searchLocation,
    searchSize,
    searchBudget,
    searchIsOffplan,
    searchCompletionRange
  );

  if (properties.length > 0) {
    // Save search results
    const searchResultsToSave = properties.map((p, i) => ({
      number: i + 1,
      id: p.id,
      name: p.property_name,
      price: p.price,
      location: p.location,
      address: p.address,
      bedrooms: p.bedrooms,
      plot_size: p.plot_size,
      type: p.type,
      photo_url: p.photo_url
    }));

    await supabase
      .from('leads')
      .update({
        search_results: searchResultsToSave,
        conversation_stage: 'completed',
        status: 'Contacted'
      })
      .eq('id', lead.id);

    console.log(`Sending ${properties.length} properties...`);

    for (let i = 0; i < properties.length; i++) {
      const property = properties[i];

      try {
        const sizeText = property.type === 'Land'
          ? `${property.plot_size}`
          : property.bedrooms === 0
            ? `Studio`
            : `${property.bedrooms} Bed${property.bedrooms > 1 ? 's' : ''}`;

        const sqmText = property.sqm ? ` (${property.sqm}sqm)` : '';
        const priceFormatted = `KES ${Number(property.price || 0).toLocaleString()}`;

        const propertyHeader =
          `🏢 *PROPERTY ${i + 1}*\n` +
          `──────────\n\n` +
          (property.project_name ? `*${property.project_name}*\n` : '') +
          `*${property.property_name}*\n\n` +
          `📍 ${property.location}\n` +
          `💰 ${priceFormatted}\n` +
          `🛏 ${sizeText}${sqmText}\n` +
          (property.completion_date ? `🏗 Completion: ${property.completion_date}\n` : '') +
          `📮 ${property.address}`;

        const descriptionText = property.description
          ? `\n\n${property.description}`
          : '';

        const footer = `\n\n──────────\nReply *Property${i + 1}* to book a viewing`;

        const fullMessage = propertyHeader + descriptionText + footer;

        console.log(`Sending property ${i + 1}: ${property.property_name} (${fullMessage.length} chars)`);

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

    // After sending properties ask AI for follow up message
    const followUpAI = await processAIConversation({
      userMessage: `[SYSTEM: ${properties.length} properties were just sent to the user. Send a brief friendly follow up asking if they would like to book a viewing for any of them. Mention they can reply Property1, Property2 etc.]`,
      lead: { ...lead, conversation_stage: 'completed' },
      tenant: tenant,
      conversationHistory: trimmedHistory,
      agentName: agentName,
      agentPhone: agentPhone
    });

    await delay(1500);
    await sendMessage(tenantWhatsApp, from, followUpAI.message);

  } else {
    // No properties found - AI suggests alternatives
    const noResultAI = await processAIConversation({
      userMessage: `[SYSTEM: No properties found matching the user criteria. Apologize naturally and suggest they contact the agent. Be helpful and warm.]`,
      lead: lead,
      tenant: tenant,
      conversationHistory: trimmedHistory,
      agentName: agentName,
      agentPhone: agentPhone
    });

    await supabase
      .from('leads')
      .update({ conversation_stage: 'no_results' })
      .eq('id', lead.id);

    await sendMessage(tenantWhatsApp, from, noResultAI.message);

    if (agentPhone) {
      await sendTemplateToAgent(
        tenantWhatsApp,
        agentPhone,
        TEMPLATES.NO_PROPERTY_FOUND,
        {
          "1": lead.name || 'Unknown',
          "2": cleanLeadPhone,
          "3": kenyaTime
        }
      );
    }
  }

  return;
}

// ACTION: booking
if (aiResult.action === 'booking') {
  const propertyNumber = aiResult.extracted?.property_number;

  if (!propertyNumber) {
    await sendMessage(tenantWhatsApp, from, aiResult.message);
    return;
  }

  await sendMessage(tenantWhatsApp, from, aiResult.message);

  // Get saved search results
  const { data: freshLead } = await supabase
    .from('leads')
    .select('search_results, selected_property_id')
    .eq('id', lead.id)
    .single();

  const searchResults = freshLead?.search_results || [];
  const selectedProperty = searchResults.find(p => p.number === propertyNumber);

  if (!selectedProperty) {
    await sendMessage(
      tenantWhatsApp,
      from,
      `I could not find that property. Please reply with the property number from the list above.`
    );
    return;
  }

  // Save selection
  await supabase
    .from('leads')
    .update({
      selected_property_number: propertyNumber,
      selected_property_id: selectedProperty.id,
      last_viewed_property: selectedProperty.name,
      conversation_stage: 'awaiting_time_slot'
    })
    .eq('id', lead.id);

  // Get available slots
  const slotsResponse = await fetch(
    `https://property-bot-backend.onrender.com/api/available-slots-v2`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: tenant.id,
        propertyId: selectedProperty.id,
        leadId: lead.id
      })
    }
  );
  const slotsData = await slotsResponse.json();

  await supabase
    .from('leads')
    .update({ available_slots: slotsData.slotMap })
    .eq('id', lead.id);

  await sendMessage(tenantWhatsApp, from, slotsData.message);
  return;
}

// ACTION: create_booking (user selected a time slot)
if (aiResult.action === 'continue' &&
  lead?.conversation_stage === 'awaiting_time_slot' &&
  aiResult.extracted?.slot_number) {

  const slotNumber = aiResult.extracted.slot_number;

  const { data: freshLead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', lead.id)
    .single();

  const propertyId = freshLead?.selected_property_id;
  const slotMap = freshLead?.available_slots || '{}';

  if (!propertyId) {
    await sendMessage(tenantWhatsApp, from, aiResult.message);
    return;
  }

  const bookingResponse = await fetch(
    `https://property-bot-backend.onrender.com/api/create-booking`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: tenant.id,
        leadId: lead.id,
        propertyId: propertyId,
        slotNumber: slotNumber.toString(),
        slotMap: slotMap,
        leadName: freshLead?.name || 'Client',
        leadPhone: from
      })
    }
  );
  const bookingData = await bookingResponse.json();

  if (bookingData.success) {
    await supabase
      .from('leads')
      .update({ conversation_stage: 'booking_confirmed' })
      .eq('id', lead.id);

    await sendMessage(tenantWhatsApp, from, bookingData.message);

    if (agentPhone) {
      await sendTemplateToAgent(
        tenantWhatsApp,
        agentPhone,
        TEMPLATES.BOOKING_CONFIRMED,
        {
          "1": freshLead?.name || 'Unknown',
          "2": cleanLeadPhone,
          "3": bookingData.slotDetails?.property || 'N/A',
          "4": `KES ${Number(bookingData.slotDetails?.price || 0).toLocaleString()}`,
          "5": `KES ${freshLead?.budget || 'N/A'}`,
          "6": freshLead?.location || 'N/A',
          "7": bookingData.slotDetails?.date || 'N/A',
          "8": bookingData.slotDetails?.time || 'N/A'
        }
      );
    }

  } else if (bookingData.slotTaken) {
    const newSlotsResponse = await fetch(
      `https://property-bot-backend.onrender.com/api/available-slots-v2`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: tenant.id,
          propertyId: propertyId,
          leadId: lead.id
        })
      }
    );
    const newSlotsData = await newSlotsResponse.json();

    await supabase
      .from('leads')
      .update({
        conversation_stage: 'awaiting_time_slot',
        available_slots: newSlotsData.slotMap
      })
      .eq('id', lead.id);

    await sendMessage(
      tenantWhatsApp,
      from,
      `Sorry, that slot was just taken. Here are the next available times:\n\n${newSlotsData.message}`
    );
  } else {
    await sendMessage(tenantWhatsApp, from, aiResult.message);
  }

  return;
}

// ACTION: cancel_booking
if (aiResult.action === 'cancel_booking') {
  await sendMessage(tenantWhatsApp, from, aiResult.message);

  const cancelResponse = await fetch(
    `https://property-bot-backend.onrender.com/api/cancel-booking`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leadId: lead.id,
        calendarId: tenant.google_calendar_id
      })
    }
  );
  const cancelData = await cancelResponse.json();

  await supabase
    .from('leads')
    .update({ conversation_stage: 'booking_cancelled' })
    .eq('id', lead.id);

  await sendMessage(tenantWhatsApp, from, cancelData.userMessage);

  if (cancelData.agentNotification?.agentPhone) {
    await sendTemplateToAgent(
      tenantWhatsApp,
      agentPhone,
      TEMPLATES.BOOKING_CANCELLED,
      {
        "1": lead.name || 'Unknown',
        "2": cleanLeadPhone
      }
    );
  }
  return;
}

// ACTION: human_handoff
if (aiResult.action === 'human_handoff') {
  await sendMessage(tenantWhatsApp, from, aiResult.message);
  return;
}

// ACTION: followup responses (interested / not interested)
if (lead?.awaiting_followup_response) {
  if (message === '1' || message.toLowerCase().includes('interested')) {
    await supabase
      .from('leads')
      .update({
        status: 'Hot Lead',
        conversation_stage: 'interested_after_viewing',
        awaiting_followup_response: false
      })
      .eq('id', lead.id);

    await sendMessage(tenantWhatsApp, from, aiResult.message);

    if (agentPhone) {
      await sendTemplateToAgent(
        tenantWhatsApp,
        agentPhone,
        TEMPLATES.HOT_LEAD,
        {
          "1": lead.name || 'Unknown',
          "2": cleanLeadPhone,
          "3": lead.last_viewed_property || 'N/A'
        }
      );
    }
    return;
  }

  if (message === '2' || message.toLowerCase().includes('not interested')) {
    await supabase
      .from('leads')
      .update({
        status: 'Not Interested',
        conversation_stage: 'not_interested_after_viewing',
        awaiting_followup_response: false
      })
      .eq('id', lead.id);

    await sendMessage(tenantWhatsApp, from, aiResult.message);
    return;
  }
}

// DEFAULT: continue conversation
await sendMessage(tenantWhatsApp, from, aiResult.message);

  } catch (error) {
    console.error('Error in webhook:', error);

    // Safety net — notify user and agent if anything fails
    try {
      const { tenant } = await getTenantAndLead(to, from);
      if (tenant) {
        await sendMessage(
          tenant.whatsapp_number,
          from,
          `Sorry, something went wrong on our end.\n\n` +
          `Our agent will contact you shortly to assist you.`
        );

        const { data: agentData } = await supabase
          .from('agents')
          .select('phone')
          .eq('tenant_id', tenant.id)
          .eq('active', true)
          .single();

        if (agentData?.phone) {
          await sendMessage(
            tenant.whatsapp_number,
            `whatsapp:${agentData.phone}`,
            `System Alert!\n\n` +
            `A client needs manual assistance.\n\n` +
            `Client number: ${from.replace('whatsapp:', '')}\n\n` +
            `Please contact them directly.`
          );
        }
      }
    } catch (fallbackError) {
      console.error('Fallback notification failed:', fallbackError);
    }
  }
});

module.exports = router;