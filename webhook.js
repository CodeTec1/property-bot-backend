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
// Helper: Normalize text
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
      tenantId,
      normalizedInterest,
      normalizedLocation,
      size,
      budget,
      isOffplan,
      completionRange
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
// Helper: Send properties to user
// ============================================
async function sendProperties(properties, lead, tenant, tenantWhatsApp, from, agentName, agentPhone, cleanLeadPhone, kenyaTime) {
  if (properties.length === 0) {
    await sendMessage(
      tenantWhatsApp,
      from,
      `Sorry, we could not find properties matching your criteria at the moment.\n\n` +
      `Our agent will contact you shortly to assist you personally.\n\n` +
      `Agent: ${agentName}\n` +
      `Phone: ${agentPhone || 'N/A'}\n\n` +
      `You can also reply HI to start a new search.`
    );

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
    return;
  }

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

  console.log(`Sending ${properties.length} properties to user...`);

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

      const descriptionText = property.description ? `\n\n${property.description}` : '';
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
      last_viewed_property: lead?.last_viewed_property || null,
      awaiting_followup_response: lead?.awaiting_followup_response || false,
      lead_is_offplan: lead?.is_offplan ?? null,
      lead_completion_range: lead?.completion_range || null,
      lead_budget_ranges: lead?.available_slots || null,
      tenant_id: tenant.id,
      tenant_company_name: tenant.company_name,
      tenant_bot_name: tenant.bot_name,
      tenant_property_types: tenant.property_types,
      tenant_whatsapp: tenant.whatsapp_number
    };

    const result = await handleMessage(input);
    console.log('Action:', result.action);

    // -----------------------------------------------
    // ACTION: create — new lead
    // -----------------------------------------------
    if (result.action === 'create') {
      await supabase
        .from('leads')
        .insert({
          phone: from,
          tenant_id: tenant.id,
          status: result.updateFields?.Status || 'New',
          conversation_stage: result.updateFields?.['Conversation Stage'] || 'asked_buy_or_rent'
        });

      await sendMessage(tenantWhatsApp, from, result.replyMessage);
      return;
    }

    // -----------------------------------------------
    // ACTION: update — update lead fields
    // -----------------------------------------------
    if (result.action === 'update' && lead) {
      const updateData = {};
      if (result.updateFields?.['Conversation Stage']) updateData.conversation_stage = result.updateFields['Conversation Stage'];
      if (result.updateFields?.Name) updateData.name = result.updateFields.Name;
      if (result.updateFields?.Interest) updateData.interest = result.updateFields.Interest;
      if (result.updateFields?.Budget) updateData.budget = result.updateFields.Budget;
      if (result.updateFields?.Location) updateData.location = result.updateFields.Location;
      if (result.updateFields?.Size) updateData.size = result.updateFields.Size;
      if (result.updateFields?.Status) updateData.status = result.updateFields.Status;
      if (result.isOffplan !== null && result.isOffplan !== undefined) updateData.is_offplan = result.isOffplan;
      if (result.completionRange) updateData.completion_range = result.completionRange;

      if (Object.keys(updateData).length > 0) {
        await supabase.from('leads').update(updateData).eq('id', lead.id);
      }

      await sendMessage(tenantWhatsApp, from, result.replyMessage);

     if (result.searchProperties) {
        const searchInterest = updateData.interest || lead.interest;
        const searchLocation = updateData.location || lead.location;
        const searchSize = updateData.size || lead.size;
        const searchBudget = updateData.budget || lead.budget;

        // Fetch fresh lead to get all saved fields including offplan and completion
        const { data: freshLeadData } = await supabase
          .from('leads')
          .select('*')
          .eq('id', lead.id)
          .single();

        const searchIsOffplan = freshLeadData?.is_offplan ?? lead.is_offplan;
        const searchCompletionRange = freshLeadData?.completion_range || lead.completion_range;

        console.log('Search params:', {
          searchInterest, searchLocation, searchSize,
          searchBudget, searchIsOffplan, searchCompletionRange
        });

        console.log('Searching with:', { searchInterest, searchLocation, searchSize, searchBudget, searchIsOffplan, searchCompletionRange });

        const properties = await searchProperties(
          tenant.id,
          searchInterest,
          searchLocation,
          searchSize,
          searchBudget,
          searchIsOffplan,
          searchCompletionRange
        );

        const freshLead = freshLeadData || { ...lead, ...updateData };
        await sendProperties(properties, freshLead, tenant, tenantWhatsApp, from, agentName, agentPhone, cleanLeadPhone, kenyaTime);
      }

      return;
    }

    // -----------------------------------------------
    // ACTION: fetch_locations
    // -----------------------------------------------
    if (result.action === 'fetch_locations' && lead) {
      const updateData = { conversation_stage: 'fetching_locations' };
      if (result.updateFields?.Budget) updateData.budget = result.updateFields.Budget;
      if (result.updateFields?.Name) updateData.name = result.updateFields.Name;
      if (result.isOffplan !== null && result.isOffplan !== undefined) updateData.is_offplan = result.isOffplan;
      if (result.completionRange) updateData.completion_range = result.completionRange;

      await supabase.from('leads').update(updateData).eq('id', lead.id);
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
        const formatted = locations.map(loc => `• ${loc}`).join('\n');

        await supabase.from('leads').update({ conversation_stage: 'asked_location' }).eq('id', lead.id);

        await sendMessage(
          tenantWhatsApp,
          from,
          `Which area are you interested in?\n\nWe have properties in:\n\n${formatted}\n\nJust type the area name.`
        );
      } else {
        await sendMessage(tenantWhatsApp, from, `Sorry, no locations available right now.\n\nReply HI to start over.`);
      }
      return;
    }

    // -----------------------------------------------
    // ACTION: fetch_sizes
    // -----------------------------------------------
    if (result.action === 'fetch_sizes' && lead) {
      const updateData = {
        location: result.location,
        conversation_stage: 'fetching_sizes'
      };
      if (result.isOffplan !== null && result.isOffplan !== undefined) updateData.is_offplan = result.isOffplan;
      if (result.completionRange) updateData.completion_range = result.completionRange;
      if (result.updateFields?.CompletionRange) updateData.completion_range = result.updateFields.CompletionRange;

      await supabase.from('leads').update(updateData).eq('id', lead.id);
      await sendMessage(tenantWhatsApp, from, result.replyMessage);

      const interest = lead.interest || '';
      const location = result.location || lead.location || '';
      const normalizedInterest = normalize(interest);
      const normalizedLocation = normalize(location);

      // Get current offplan status
      const currentIsOffplan = result.isOffplan ?? lead.is_offplan;

      let sizeQuery = supabase
        .from('properties')
        .select('bedrooms, plot_size, type')
        .eq('tenant_id', tenant.id)
        .ilike('type', normalizedInterest)
        .ilike('location', normalizedLocation)
        .eq('available', true);

      // Filter by offplan if known
      if (currentIsOffplan === true) sizeQuery = sizeQuery.eq('is_offplan', true);
      if (currentIsOffplan === false) sizeQuery = sizeQuery.eq('is_offplan', false);

      const { data: sizeData } = await sizeQuery;

      if (sizeData && sizeData.length > 0) {
        let options = '';
        let nextStage = '';

        if (normalizedInterest === 'Land') {
          const plots = [...new Set(sizeData.map(r => r.plot_size).filter(Boolean))];
          options = plots.map(p => `• ${p}`).join('\n');
          nextStage = 'asked_land_size';
        } else {
          const beds = [...new Set(
            sizeData.map(r => parseInt(r.bedrooms)).filter(n => !isNaN(n))
          )].sort((a, b) => a - b);

          options = beds.map(b => {
            if (b === 0) return `• Studio`;
            return `• ${b} Bedroom${b > 1 ? 's' : ''}`;
          }).join('\n');
          nextStage = 'asked_size';
        }

        await supabase.from('leads').update({ conversation_stage: nextStage }).eq('id', lead.id);

        const sizeQuestion = normalizedInterest === 'Land'
          ? `What plot size are you looking for?\n\nAvailable sizes:\n\n${options}\n\nJust type the size.`
          : `How many bedrooms are you looking for?\n\nAvailable options:\n\n${options}\n\nJust type the number or reply Studio.`;

        await sendMessage(tenantWhatsApp, from, sizeQuestion);
      } else {
        await sendMessage(
          tenantWhatsApp,
          from,
          `Sorry, no properties available in ${location} right now.\n\nReply HI to start over.`
        );
      }
      return;
    }

// -----------------------------------------------
    // ACTION: fetch_budget_ranges
    // -----------------------------------------------
    if (result.action === 'fetch_budget_ranges' && lead) {
      const updateData = {
        size: result.updateFields?.Size,
        conversation_stage: 'fetching_budget_ranges'
      };

      await supabase.from('leads').update(updateData).eq('id', lead.id);
      await sendMessage(tenantWhatsApp, from, result.replyMessage);

      const normalizedInterest = normalize(lead.interest);
      const normalizedLocation = normalize(lead.location || result.location);
      const currentIsOffplan = lead.is_offplan;
      const currentCompletion = lead.completion_range;
      const size = result.updateFields?.Size || lead.size;

      let priceQuery = supabase
        .from('properties')
        .select('price')
        .eq('tenant_id', tenant.id)
        .ilike('type', normalizedInterest)
        .ilike('location', normalizedLocation)
        .eq('available', true)
        .not('price', 'is', null);

      if (currentIsOffplan === true) priceQuery = priceQuery.eq('is_offplan', true);
      if (currentIsOffplan === false) priceQuery = priceQuery.eq('is_offplan', false);

      if (size) {
        const bedroomNum = extractBedrooms(size);
        if (bedroomNum !== null) {
          priceQuery = priceQuery.eq('bedrooms', bedroomNum);
        }
      }

      if (currentIsOffplan === true && currentCompletion && currentCompletion !== 'any') {
        if (currentCompletion === '2026') priceQuery = priceQuery.ilike('completion_date', '%2026%');
        else if (currentCompletion === '2027') priceQuery = priceQuery.ilike('completion_date', '%2027%');
        else if (currentCompletion === '2028') priceQuery = priceQuery.ilike('completion_date', '%2028%');
        else if (currentCompletion === '2029+') {
          priceQuery = priceQuery
            .not('completion_date', 'ilike', '%2026%')
            .not('completion_date', 'ilike', '%2027%')
            .not('completion_date', 'ilike', '%2028%');
        }
      }

      const { data: priceData } = await priceQuery;

      if (priceData && priceData.length > 0) {
        const prices = priceData.map(r => r.price).filter(p => p > 0).sort((a, b) => a - b);
        const minPrice = prices[0];
        const maxPrice = prices[prices.length - 1];
        const priceRange = `KES ${Number(minPrice).toLocaleString()} to KES ${Number(maxPrice).toLocaleString()}`;

        await supabase
          .from('leads')
          .update({ conversation_stage: 'asked_budget' })
          .eq('id', lead.id);

        await sendMessage(
          tenantWhatsApp,
          from,
          `Almost there! 💰\n\n` +
          `What is your budget?\n\n` +
          `Properties matching your criteria range from:\n` +
          `*${priceRange}*\n\n` +
          `Just type your budget (e.g. 10M, 15M, KES 10,000,000)`
        );
      } else {
        await sendMessage(
          tenantWhatsApp,
          from,
          `Sorry, we could not find properties matching your criteria.\n\n` +
          `Our agent will contact you shortly:\n` +
          `👤 ${agentName}\n` +
          `📞 ${agentPhone || 'N/A'}\n\n` +
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

      console.log('Selected property:', selectedProperty.name);

      await sendMessage(
        tenantWhatsApp,
        from,
        `Great choice! 🎉 Let me check availability for *${selectedProperty.name}*...`
      );

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

        if (agentPhone) {
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
        }

      } else if (bookingData.slotTaken) {
        await sendMessage(tenantWhatsApp, from, `Sorry, that time slot was just taken.\n\nLet me find you another time...`);

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
        await sendMessage(
          tenantWhatsApp,
          from,
          `Sorry, something went wrong with your booking.\n\n` +
          `Our agent will contact you shortly.\n\n` +
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
        .update({ conversation_stage: 'booking_cancelled', status: 'Cancelled' })
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
        cancelData.userMessage || `Your viewing has been cancelled.\n\nReply HI to search for another property.`
      );

      await sendTemplateToAgent(tenantWhatsApp, agentPhone, TEMPLATES.BOOKING_CANCELLED, {
        "1": lead.name || 'Unknown',
        "2": cleanLeadPhone
      });
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

      await sendTemplateToAgent(tenantWhatsApp, agentPhone, TEMPLATES.HOT_LEAD, {
        "1": lead.name || 'Unknown',
        "2": cleanLeadPhone,
        "3": lead.last_viewed_property || 'N/A'
      });
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
    // DEFAULT: send reply for invalid/unknown actions
    // -----------------------------------------------
    if (result.replyMessage) {
      await sendMessage(tenantWhatsApp, from, result.replyMessage);
    }

  } catch (error) {
    console.error('Error in webhook:', error);

    try {
      const { tenant } = await getTenantAndLead(to, from);
      if (tenant) {
        await sendMessage(
          tenant.whatsapp_number,
          from,
          `Sorry, something went wrong on our end.\n\n` +
          `Our agent will contact you shortly to assist you manually.`
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
            `System Alert!\n\nA client needs manual assistance.\n\nClient: ${from.replace('whatsapp:', '')}\n\nPlease contact them directly.`
          );
        }
      }
    } catch (fallbackError) {
      console.error('Fallback notification failed:', fallbackError);
    }
  }
});

module.exports = router;