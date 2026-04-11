// webhook.js - Handles incoming WhatsApp messages directly from Twilio
const express = require('express');
const router = express.Router();
const supabase = require('./supabase');
const handleMessage = require('./handleMessage');
const twilio = require('twilio');

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

    console.log('Sending template to agent:', {
      from: tenantWhatsApp,
      to: agentPhone,
      templateSid,
      variables
    });
    
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

// Offplan filter
    if (isOffplan === true) {
      query = query.eq('is_offplan', true);
      if (completionRange && completionRange !== 'any') {
        query = query.ilike('completion_date', `%${completionRange}%`);
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

async function getNextAgentRoundRobin(tenantId) {
  // Step 1: get all active agents
  const { data: agents } = await supabase
    .from('agents')
    .select('id, agent_name, phone')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('created_at', { ascending: true });

  if (!agents || agents.length === 0) {
    console.log('No agents found for tenant');
    return null;
  }

  // Step 2: get tenant pointer
  const { data: tenantData } = await supabase
    .from('tenants')
    .select('last_assigned_agent_index')
    .eq('id', tenantId)
    .single();

  let index = tenantData?.last_assigned_agent_index || 0;

  // Step 3: pick agent
  const agent = agents[index % agents.length];

  // Step 4: update pointer
  const nextIndex = (index + 1) % agents.length;

  await supabase
    .from('tenants')
    .update({
      last_assigned_agent_index: nextIndex
    })
    .eq('id', tenantId);

  console.log('Round robin agent selected:', agent.agent_name);

  return agent;
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

    // Build input for handleMessage
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
      assigned_agent_name: lead?.assigned_agent_name || null,
      assigned_agent_phone: lead?.assigned_agent_phone || null,
      last_viewed_property: lead?.last_viewed_property || null,
      awaiting_followup_response: lead?.awaiting_followup_response || false,
      lead_is_offplan: lead?.is_offplan ?? null,
      lead_completion_range: lead?.completion_range || null,
      last_completion_options: lead?.last_search_results || null,
      tenant_id: tenant.id,
      tenant_company_name: tenant.company_name,
      tenant_bot_name: tenant.bot_name,
      tenant_property_types: tenant.property_types,
      tenant_whatsapp: tenant.whatsapp_number
    };

    // Process message through handleMessage
    const result = await handleMessage(input);
    console.log('Action:', result.action);

    // -----------------------------------------------
    // ACTION: create — new lead
    // -----------------------------------------------
    if (result.action === 'create') {

  // STEP 1: get next agent (ONLY ONCE)
  const selectedAgent = await getNextAgentRoundRobin(tenant.id);

  // STEP 2: create lead + assign agent
  const { data: newLead } = await supabase
    .from('leads')
    .insert({
      phone: from,
      tenant_id: tenant.id,
      status: result.updateFields?.Status || 'New',
      conversation_stage: result.updateFields?.['Conversation Stage'] || 'asked_buy_or_rent',

      // 👇 ADD THIS (IMPORTANT)
      assigned_agent_id: selectedAgent?.id || null,
      assigned_agent_name: selectedAgent?.agent_name || null,
      assigned_agent_phone: selectedAgent?.phone || null
    })
    .select()
    .single();

  // STEP 3: send message to user
  await sendMessage(tenantWhatsApp, from, result.replyMessage);

  return;
}

 // -----------------------------------------------
// ACTION: update — update lead fields
// -----------------------------------------------
if (result.action === 'update' && lead) {

  // ============================================
  // ENSURE LEAD HAS ASSIGNED AGENT
  // ============================================
  let assignedAgent = {
    phone: lead.assigned_agent_phone,
    agent_name: lead.assigned_agent_name
  };

  if (!lead.assigned_agent_phone) {
    console.log('No assigned agent found for this lead. Assigning now...');

    const selectedAgent = await getNextAgentRoundRobin(tenant.id);

    if (selectedAgent) {
      await supabase
        .from('leads')
        .update({
          assigned_agent_id: selectedAgent.id,
          assigned_agent_name: selectedAgent.agent_name,
          assigned_agent_phone: selectedAgent.phone
        })
        .eq('id', lead.id);

      assignedAgent = {
        phone: selectedAgent.phone,
        agent_name: selectedAgent.agent_name
      };

      console.log('Agent assigned during update:', assignedAgent);
    }
  }

  const updateData = {};
  if (result.updateFields?.['Conversation Stage']) updateData.conversation_stage = result.updateFields['Conversation Stage'];
  if (result.updateFields?.Name) updateData.name = result.updateFields.Name;
  if (result.updateFields?.Interest) updateData.interest = result.updateFields.Interest;
  if (result.updateFields?.Budget) updateData.budget = result.updateFields.Budget;
  if (result.updateFields?.Location) updateData.location = result.updateFields.Location;
  if (result.updateFields?.Size) updateData.size = result.updateFields.Size;
  if (result.updateFields?.Status) updateData.status = result.updateFields.Status;

  if (result.isOffplan !== null && result.isOffplan !== undefined) {
    updateData.is_offplan = result.isOffplan;
  }

  if (result.updateFields?.CompletionRange) {
    let completionValue = result.updateFields.CompletionRange;

    if (/^\d+$/.test(completionValue.trim())) {
      const { data: leadWithDates } = await supabase
        .from('leads')
        .select('last_search_results')
        .eq('id', lead.id)
        .single();

      try {
        const storedDates = JSON.parse(leadWithDates?.last_search_results || '[]');
        const index = parseInt(completionValue) - 1;
        if (storedDates[index]) {
          completionValue = storedDates[index];
        }
      } catch (e) {
        console.error('Error parsing stored dates:', e);
      }
    }

    updateData.completion_range = completionValue;
  }

  if (Object.keys(updateData).length > 0) {
    const { error: updateError } = await supabase
      .from('leads')
      .update(updateData)
      .eq('id', lead.id);

    if (updateError) {
      console.error('Supabase update error:', updateError);
    }
  }

  // Send reply first
  await sendMessage(tenantWhatsApp, from, result.replyMessage);

  // Then search properties if needed
  if (result.searchProperties) {
    const searchInterest = updateData.interest || lead.interest;
    const searchLocation = updateData.location || lead.location;
    const searchSize = updateData.size || lead.size;

    console.log('Searching with:', { searchInterest, searchLocation, searchSize });

    const properties = await searchProperties(
      tenant.id,
      searchInterest,
      searchLocation,
      searchSize,
      updateData.budget || lead.budget,
      updateData.is_offplan ?? lead.is_offplan,
      updateData.completion_range || lead.completion_range
    );

    if (properties.length > 0) {
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
        .update({ search_results: searchResultsToSave })
        .eq('id', lead.id);

      console.log(`Sending ${properties.length} properties to user...`);

      for (let i = 0; i < properties.length; i++) {
        const property = properties[i];

        try {
          const sizeText = property.type === 'Land'
            ? `${property.plot_size}`
            : property.bedrooms === 0
              ? `Studio`
              : `${property.bedrooms} Bed${property.bedrooms > 1 ? 's' : ''}`;

          const priceFormatted = `KES ${Number(property.price || 0).toLocaleString()}`;
          const sqmText = property.sqm ? ` (${property.sqm}sqm)` : '';

          const propertyMessage =
            `🏢 *PROPERTY ${i + 1}*\n` +
            `──────────\n\n` +
            (property.project_name ? `*${property.project_name}*\n` : '') +
            `*${property.property_name}*\n\n` +
            `📍 ${property.location}\n` +
            `💰 ${priceFormatted}\n` +
            `🛏 ${sizeText}${sqmText}\n` +
            (property.completion_date ? `🏗 Completion: ${property.completion_date}\n` : '') +
            `📮 ${property.address}\n` +
            (property.description ? `\n${property.description}\n` : '') +
            `\n──────────\n` +
            `Reply *Property${i + 1}* to book a viewing`;

          console.log(`Sending property ${i + 1}: ${property.property_name}`);

          await sendMessage(
            tenantWhatsApp,
            from,
            propertyMessage,
            property.photo_url || null
          );

          console.log(`Property ${i + 1} sent successfully`);

          if (i < properties.length - 1) await delay(2000);

        } catch (propError) {
          console.error(`Error sending property ${i + 1}:`, propError.message);
          continue;
        }
      }

    for (let i = 0; i < properties.length; i++) {
  const property = properties[i];

  try {
    await sendMessage(
      tenantWhatsApp,
      from,
      propertyMessage,
      property.photo_url || null
    );

    if (i < properties.length - 1) {
      await delay(2000);
    }

  } catch (err) {
    console.error(`Error sending property ${i + 1}`, err);
  }
}

// ✅ GUARANTEED LAST MESSAGE
console.log('All properties sent successfully');

await delay(1000); // small buffer (VERY IMPORTANT)

await sendMessage(
  tenantWhatsApp,
  from,
  `I’ve sent you ${properties.length} propert${properties.length === 1 ? 'y' : 'ies'}.\n\n` +
  `Reply with the property number (e.g. 1, 2, 3)\n` +
  `or type Property 1 to book a viewing.`
);

    } else {
      console.log('No properties found - notifying user and agent');

      await sendMessage(
        tenantWhatsApp,
        from,
        `Sorry, we could not find any properties matching your criteria at the moment.\n\n` +
        `Our agent will contact you shortly to assist you personally.\n\n` +
        `Agent: ${assignedAgent.agent_name}\n` +
        `Phone: ${assignedAgent.phone || 'N/A'}\n\n` +
        `You can also reply HI to start a new search.`
      );

      if (assignedAgent.phone) {
        await sendTemplateToAgent(
          tenantWhatsApp,
          assignedAgent.phone,
          TEMPLATES.NO_PROPERTY_FOUND,
          {
            "1": lead.name || 'Unknown',
            "2": cleanLeadPhone,
            "3": kenyaTime
          }
        );
      }
    }
  }

  return;
}
    if (result.action === 'fetch_locations' && lead) {
  const locUpdate = { conversation_stage: 'fetching_locations' };

  if (result.updateFields?.Budget) locUpdate.budget = result.updateFields.Budget;
  if (result.updateFields?.Name) locUpdate.name = result.updateFields.Name;

  await supabase
    .from('leads')
    .update(locUpdate)
    .eq('id', lead.id);

  await sendMessage(tenantWhatsApp, from, result.replyMessage);

  const interest = result.interest || lead.interest;
  const normalizedInterest = normalize(interest);

  const { data: locData } = await supabase
    .from('properties')
    .select('location')
    .eq('tenant_id', tenant.id)
    .ilike('type', normalizedInterest)
    .eq('available', true);

  if (locData && locData.length > 0) {

    const locations = [...new Set(locData.map(r => r.location).filter(Boolean))].sort();

    // 🔥 SAVE OPTIONS TO LEAD (THIS FIXES EVERYTHING)
    await supabase
      .from('leads')
      .update({
        location_options: JSON.stringify(locations)
      })
      .eq('id', lead.id);

    const formatted = locations
      .map((loc, i) => `${i + 1}️⃣ ${loc}`)
      .join('\n');

    await supabase
      .from('leads')
      .update({ conversation_stage: 'asked_location' })
      .eq('id', lead.id);

    await sendMessage(
      tenantWhatsApp,
      from,
      `Which area are you interested in?\n\n` +
      `We have properties in:\n\n` +
      `${formatted}\n\n` +
      `Reply with a number (e.g. 1, 2, 3).`
    );

  } else {
    await sendMessage(
      tenantWhatsApp,
      from,
      `Sorry, no locations available right now.\n\n` +
      `Contact our agent:\n` +
      `${input.assigned_agent_name || "Our Agent"}\n` +
      `${input.assigned_agent_phone || "N/A"}`
    );
  }

  return;
}
    // -----------------------------------------------
    // ACTION: fetch_sizes
    // -----------------------------------------------
    if (result.action === 'fetch_sizes' && lead) {
      await supabase
        .from('leads')
        .update({
          location: result.location,
          conversation_stage: 'fetching_sizes'
        })
        .eq('id', lead.id);

      // Send checking message first
      await sendMessage(tenantWhatsApp, from, result.replyMessage);

      const interest = lead.interest || '';
      const location = result.location || lead.location || '';
      const normalizedInterest = normalize(interest);
      const normalizedLocation = normalize(location);

      const { data: sizeData } = await supabase
        .from('properties')
        .select('bedrooms, plot_size, type')
        .eq('tenant_id', tenant.id)
        .ilike('type', normalizedInterest)
        .ilike('location', normalizedLocation)
        .eq('available', true);

      if (sizeData && sizeData.length > 0) {
        let options = '';
        let nextStage = '';

        if (normalizedInterest === 'Land') {
          const plots = [...new Set(sizeData.map(r => r.plot_size).filter(Boolean))];
          options = plots.map(p => `• ${p}`).join('\n');
          nextStage = 'asked_land_size';
        } else {
        const beds = [
  ...new Set(
    sizeData
      .map(r => parseInt(r.bedrooms))
      .filter(n => !isNaN(n))
  )
].sort((a, b) => a - b);

options = beds.map(b => {
  if (b === 0) return `• Studio`;
  return `• ${b} Bedroom${b > 1 ? 's' : ''}`;
}).join('\n');

nextStage = 'asked_size';
        }

        await supabase
          .from('leads')
          .update({ conversation_stage: nextStage })
          .eq('id', lead.id);

        // Different question for land vs house
        const sizeQuestion = normalizedInterest === 'Land'
          ? `What plot size are you looking for?\n\nAvailable sizes:\n\n${options}\n\nJust type the size.`
          : `How many bedrooms are you looking for?\n\nAvailable options:\n\n${options}\n\nJust type the number.`;

        await sendMessage(tenantWhatsApp, from, sizeQuestion);

      } else {
        await sendMessage(
          tenantWhatsApp,
          from,
          `Sorry, no properties available in ${location} right now.\n\n` + 
          `Contact our agent for assistance.\n\n` +
          `Agent: ${agentName}\n` +
          `Phone: ${agentPhone || 'N/A'}\n\n` +
          `You can also reply HI to start a new search.`
        );
      }
      return;
    }

    // -----------------------------------------------
    // ACTION: fetch_completion_dates
    // -----------------------------------------------
    if (result.action === 'fetch_completion_dates' && lead) {
      const completionUpdate = {
        conversation_stage: 'fetching_completion',
        is_offplan: true
      };
      await supabase.from('leads').update(completionUpdate).eq('id', lead.id);
      await sendMessage(tenantWhatsApp, from, result.replyMessage);

      const normalizedInterest = normalize(lead.interest);
      const normalizedLocation = normalize(lead.location);

      let dateQuery = supabase
        .from('properties')
        .select('completion_date')
        .eq('tenant_id', tenant.id)
        .ilike('type', normalizedInterest)
        .ilike('location', normalizedLocation)
        .eq('available', true)
        .eq('is_offplan', true)
        .not('completion_date', 'is', null);

      // Filter by bedrooms if known
      if (lead.size) {
        const bedroomNum = extractBedrooms(lead.size);
        if (bedroomNum !== null) {
          dateQuery = dateQuery.eq('bedrooms', bedroomNum);
        }
      }

      // Filter by budget if known
      if (lead.budget) {
        const budgetNum = parseFloat(lead.budget);
        if (!isNaN(budgetNum) && budgetNum > 0) {
          dateQuery = dateQuery.lte('price', budgetNum * 1.2);
        }
      }

      const { data: dateData } = await dateQuery;

      if (dateData && dateData.length > 0) {
        const dates = [...new Set(
          dateData.map(r => r.completion_date).filter(Boolean)
        )].sort();

        const formatted = dates.map((d, i) => `${i + 1}️⃣ ${d}`).join('\n');

        await supabase
          .from('leads')
          .update({
            conversation_stage: 'asked_completion',
            last_search_results: JSON.stringify(dates)
          })
          .eq('id', lead.id);

        await sendMessage(
          tenantWhatsApp,
          from,
          `When would you like the property completed?\n\n` +
          `Available completion dates:\n\n${formatted}\n\n` +
          `Just type the date or the number.`
        );
      } else {
        await sendMessage(
          tenantWhatsApp,
          from,
          `Sorry, no off-plan properties found matching your criteria.\n\n` +
          `Our agent will contact you shortly:\n` +
          `Agent: ${agentName}\n` +
          `Phone: ${agentPhone || 'N/A'}\n\n` +
          `Reply HI to start a new search.`
        );
        if (agentPhone) {
          await sendTemplateToAgent(tenantWhatsApp, agentPhone, TEMPLATES.NO_PROPERTY_FOUND, {
            "1": lead.name || 'Unknown',
            "2": cleanLeadPhone,
            "3": kenyaTime
          });
        }
      }
      return;
    }

    // -----------------------------------------------
    // ACTION: booking — check available slots
    // -----------------------------------------------
    if (result.action === 'booking' && lead) {
      await supabase
        .from('leads')
        .update({
          selected_property_number: result.propertyNumber,
          conversation_stage: 'awaiting_time_slot'
        })
        .eq('id', lead.id);

      await sendMessage(tenantWhatsApp, from, result.replyMessage);

      // Get property from saved search results
      const { data: freshLead } = await supabase
        .from('leads')
        .select('search_results')
        .eq('id', lead.id)
        .single();

      const searchResults = freshLead?.search_results || [];
      const selectedProperty = searchResults.find(p => p.number === result.propertyNumber);

      if (!selectedProperty) {
        await sendMessage(
          tenantWhatsApp,
          from,
          `Sorry, could not find that property.\n\nReply HI to start over.`
        );
        return;
      }

      console.log('Selected property from saved results:', selectedProperty.name, selectedProperty.id);

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

      // Save property ID, slot map and property name to lead
      await supabase
        .from('leads')
        .update({
          available_slots: slotsData.slotMap,
          last_viewed_property: selectedProperty.name,
          selected_property_id: selectedProperty.id
        })
        .eq('id', lead.id);

      await sendMessage(tenantWhatsApp, from, slotsData.message);
      return;
    }

    // -----------------------------------------------
// ACTION: create_booking — confirm the booking
// -----------------------------------------------
if (result.action === 'create_booking' && lead) {
  await sendMessage(tenantWhatsApp, from, result.replyMessage);

  const { data: freshLead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', lead.id)
    .single();

  const propertyId = freshLead?.selected_property_id;
  const slotMap = freshLead?.available_slots || '{}';
  const leadName = freshLead?.name || lead.name;

  if (!propertyId) {
    await sendMessage(
      tenantWhatsApp,
      from,
      `Sorry, could not find the property details.\n\nReply HI to start over.`
    );
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
        slotNumber: result.selectedTime.toString(),
        slotMap: slotMap,
        leadName: leadName,
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

    // 🔥 ALWAYS GET FRESH AGENT FROM DB
    const { data: assignedLead } = await supabase
      .from('leads')
      .select('assigned_agent_phone, assigned_agent_name')
      .eq('id', lead.id)
      .single();

    const agentPhone = assignedLead?.assigned_agent_phone;
    const agentName = assignedLead?.assigned_agent_name || 'Our Agent';

    console.log("Assigned agent (booking):", assignedLead);

    await sendTemplateToAgent(
      tenantWhatsApp,
      agentPhone,
      TEMPLATES.BOOKING_CONFIRMED,
      {
        "1": leadName || 'Unknown',
        "2": cleanLeadPhone,
        "3": bookingData.slotDetails?.property || 'N/A',
        "4": `KES ${Number(bookingData.slotDetails?.price || 0).toLocaleString()}`,
        "5": `KES ${freshLead?.budget || 'N/A'}`,
        "6": freshLead?.location || 'N/A',
        "7": bookingData.slotDetails?.date || 'N/A',
        "8": bookingData.slotDetails?.time || 'N/A'
      }
    );

  } else if (bookingData.slotTaken) {
    await sendMessage(
      tenantWhatsApp,
      from,
      `Sorry, that time slot was just taken.\n\nLet me find you another time...`
    );

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

    await sendMessage(tenantWhatsApp, from, newSlotsData.message);

  } else {
    // 🔥 GET AGENT AGAIN FOR FALLBACK
    const { data: assignedLead } = await supabase
      .from('leads')
      .select('assigned_agent_phone, assigned_agent_name')
      .eq('id', lead.id)
      .single();

    const agentPhone = assignedLead?.assigned_agent_phone;
    const agentName = assignedLead?.assigned_agent_name || 'Our Agent';

    await sendMessage(
      tenantWhatsApp,
      from,
      `Sorry, something went wrong with your booking.\n\n` +
      `Contact our agent for assistance.\n\n` +
      `Agent: ${agentName}\n` +
      `Phone: ${agentPhone || 'N/A'}`
    );
  }

  return;
}

// -----------------------------------------------
// ACTION: cancel_booking
// -----------------------------------------------
if (result.action === 'cancel_booking' && lead) {
  await supabase
    .from('leads')
    .update({
      conversation_stage: 'booking_cancelled',
      status: 'Cancelled'
    })
    .eq('id', lead.id);

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

  await sendMessage(
    tenantWhatsApp,
    from,
    cancelData.userMessage ||
    `Your viewing has been cancelled.\n\nReply HI to search for another property.`
  );

  // 🔥 GET FRESH AGENT
  const { data: assignedLead } = await supabase
    .from('leads')
    .select('assigned_agent_phone, assigned_agent_name')
    .eq('id', lead.id)
    .single();

  const agentPhone = assignedLead?.assigned_agent_phone;

  await sendTemplateToAgent(
    tenantWhatsApp,
    agentPhone,
    TEMPLATES.BOOKING_CANCELLED,
    {
      "1": lead.name || 'Unknown',
      "2": cleanLeadPhone
    }
  );

  return;
}
    // -----------------------------------------------
// ACTION: followup_interested
// -----------------------------------------------
if (result.action === 'followup_interested' && lead) {
  await supabase
    .from('leads')
    .update({
      status: 'Hot Lead',
      conversation_stage: 'interested_after_viewing',
      awaiting_followup_response: false
    })
    .eq('id', lead.id);

  await sendMessage(tenantWhatsApp, from, result.replyMessage);

  // 🔥 GET FRESH AGENT
  const { data: assignedLead } = await supabase
    .from('leads')
    .select('assigned_agent_phone, assigned_agent_name')
    .eq('id', lead.id)
    .single();

  const agentPhone = assignedLead?.assigned_agent_phone;

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

  return;
}

    // -----------------------------------------------
    // ACTION: followup_not_interested
    // -----------------------------------------------
    if (result.action === 'followup_not_interested' && lead) {
      await supabase
        .from('leads')
        .update({
          status: 'Not Interested',
          conversation_stage: 'not_interested_after_viewing',
          awaiting_followup_response: false
        })
        .eq('id', lead.id);

      await sendMessage(tenantWhatsApp, from, result.replyMessage);
      return;
    }

    // -----------------------------------------------
    // ACTION: invalid or anything else
    // -----------------------------------------------
    if (result.replyMessage) {
      await sendMessage(tenantWhatsApp, from, result.replyMessage);
    }

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