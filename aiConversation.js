// aiConversation.js - Smart AI conversation engine
const Anthropic = require('@anthropic-ai/sdk');
const supabase = require('./supabase');

function getAnthropicClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ============================================
// Fetch live options from database
// CHANGE: Added `lead` parameter so price range
// is filtered by bedrooms when asking for budget
// ============================================
async function fetchTenantOptions(tenantId, interest, location, isOffplan = null, lead = null) {
  try {
    const options = {};

    // Property types
    const { data: typeData } = await supabase
      .from('properties')
      .select('type')
      .eq('tenant_id', tenantId)
      .eq('available', true);

    if (typeData) {
      options.types = [...new Set(typeData.map(r => r.type).filter(Boolean))];
    }

    // Locations for selected interest
    if (interest) {
      const { data: locData } = await supabase
        .from('properties')
        .select('location')
        .eq('tenant_id', tenantId)
        .eq('available', true)
        .ilike('type', interest);

      if (locData) {
        options.locations = [...new Set(locData.map(r => r.location).filter(Boolean))].sort();
      }
    }

    // Bedrooms, plot sizes and prices for interest + location
    if (interest && location) {
      let propQuery = supabase
        .from('properties')
        .select('bedrooms, plot_size, price, is_offplan, completion_date')
        .eq('tenant_id', tenantId)
        .eq('available', true)
        .ilike('type', interest)
        .ilike('location', location);

      // Filter by offplan status if known — makes bedrooms and prices accurate
      if (isOffplan === true) propQuery = propQuery.eq('is_offplan', true);
      if (isOffplan === false) propQuery = propQuery.eq('is_offplan', false);

      // CHANGE: Also filter by bedrooms if known — so price range shown at budget
      // stage is exact for the user's specific unit type (e.g. 2-bed in Westlands offplan)
      if (lead?.size) {
        const isStudio = lead.size.toLowerCase().includes('studio');
        const bedroomNum = isStudio ? 0 : parseInt(lead.size.match(/\d+/)?.[0]);
        if (!isNaN(bedroomNum)) {
          propQuery = propQuery.eq('bedrooms', bedroomNum);
        }
      }

      const { data: propData } = await propQuery;

      if (propData && propData.length > 0) {

        // Detect availability
        options.hasOffplan = propData.some(p => p.is_offplan === true);
        options.hasReady = propData.some(p => p.is_offplan === false);

        // Bedrooms — only fetch when size not yet known (avoid showing wrong options)
        if (!lead?.size) {
          const beds = [...new Set(
            propData.map(r => r.bedrooms).filter(b => b !== null && b !== undefined)
          )].sort((a, b) => a - b);
          options.bedrooms = beds.map(b => b === 0 ? 'Studio' : `${b} Bedroom${b > 1 ? 's' : ''}`);
        }

        // Plot sizes
        const plots = [...new Set(propData.map(r => r.plot_size).filter(Boolean))];
        if (plots.length > 0) options.plotSizes = plots;

        // Price range — filter by offplan status for accurate range
        let priceSource = propData;

        if (isOffplan === true) {
          const offplanData = propData.filter(p => p.is_offplan === true);
          if (offplanData.length > 0) priceSource = offplanData;
        }

        if (isOffplan === false) {
          const readyData = propData.filter(p => p.is_offplan === false);
          if (readyData.length > 0) priceSource = readyData;
        }

        const prices = priceSource.map(r => r.price).filter(p => p && p > 0).sort((a, b) => a - b);
        if (prices.length > 0) {
          options.minPrice = prices[0];
          options.maxPrice = prices[prices.length - 1];
          options.priceRange = `KES ${Number(prices[0]).toLocaleString()} to KES ${Number(prices[prices.length - 1]).toLocaleString()}`;
        }

        // Completion dates — filter by is_offplan=true specifically
        const dates = [...new Set(
          propData
            .filter(r => r.is_offplan === true && r.completion_date)
            .map(r => r.completion_date)
            .filter(Boolean)
        )].sort();
        if (dates.length > 0) options.completionDates = dates;
      }
    }

    return options;
  } catch (error) {
    console.error('Error fetching options:', error);
    return {};
  }
}

// ============================================
// Determine conversation stage
// CHANGE: Correct order enforced:
//   interest → name → location → size(bedrooms)
//   → offplan → completion → budget → search
// Budget is always LAST so the system has all
// filters needed to pull the exact price range
// ============================================
function getConversationStage(lead) {
  if (!lead?.interest) return 'need_interest';
  if (!lead?.name) return 'need_name';
  if (!lead?.location) return 'need_location';
  // Ask offplan BEFORE size so we can filter bedrooms correctly
  if (lead?.interest !== 'Land') {
    const offplanKnown = lead?.is_offplan === true || lead?.is_offplan === false;
    if (!offplanKnown) return 'need_offplan';
    if (lead?.is_offplan === true && !lead?.completion_range) return 'need_completion';
  }
  if (!lead?.size) return 'need_size';
  if (!lead?.budget) return 'need_budget';
  return 'ready_to_search';
}
// ============================================
    // HANDLE MESSAGE WITH STRUCTURED FLOW
    // ============================================
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
      is_offplan: lead?.is_offplan ?? null,
      completion_range: lead?.completion_range || null,
      tenant_id: tenant.id,
      tenant_company_name: tenant.company_name,
      tenant_bot_name: tenant.bot_name,
      tenant_property_types: tenant.property_types,
      tenant_whatsapp: tenant.whatsapp_number
    };

    const result = await handleMessage(input);
    console.log('Action:', result.action);

    // -----------------------------------------------
    // ACTION: create new lead
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
    // ACTION: update lead fields
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
      if (result.updateFields?.IsOffplan !== undefined) updateData.is_offplan = result.updateFields.IsOffplan;
      if (result.updateFields?.CompletionRange) updateData.completion_range = result.updateFields.CompletionRange;

      if (Object.keys(updateData).length > 0) {
        await supabase.from('leads').update(updateData).eq('id', lead.id);
      }

      await sendMessage(tenantWhatsApp, from, result.replyMessage);

      // Search properties if needed
      if (result.searchProperties) {
        const searchInterest = updateData.interest || lead.interest;
        const searchLocation = updateData.location || lead.location;
        const searchSize = updateData.size || lead.size;
        const searchBudget = updateData.budget || lead.budget;
        const searchIsOffplan = updateData.is_offplan ?? lead.is_offplan;
        const searchCompletionRange = updateData.completion_range || lead.completion_range;

        console.log('Searching properties:', {
          searchInterest, searchLocation, searchSize,
          searchBudget, searchIsOffplan, searchCompletionRange
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

        const freshLead = { ...lead, ...updateData };

        await handlePropertyResults(
          properties, freshLead, tenant, tenantWhatsApp,
          from, agentName, agentPhone, cleanLeadPhone, kenyaTime
        );
      }

      return;
    }

    // -----------------------------------------------
    // ACTION: fetch_locations
    // -----------------------------------------------
    if (result.action === 'fetch_locations' && lead) {
      const updateFields = {};
      if (result.updateFields?.Budget) updateFields.budget = result.updateFields.Budget;
      if (result.updateFields?.IsOffplan !== undefined) updateFields.is_offplan = result.updateFields.IsOffplan;
      if (result.updateFields?.CompletionRange) updateFields.completion_range = result.updateFields.CompletionRange;
      updateFields.conversation_stage = 'fetching_locations';

      await supabase.from('leads').update(updateFields).eq('id', lead.id);
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
          tenantWhatsApp, from,
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
      await supabase
        .from('leads')
        .update({ location: result.location, conversation_stage: 'fetching_sizes' })
        .eq('id', lead.id);

      await sendMessage(tenantWhatsApp, from, result.replyMessage);

      const interest = lead.interest || '';
      const location = result.location || lead.location || '';
      const normalizedInterest = normalize(interest);
      const normalizedLocation = normalize(location);

      // Build property query filtered by offplan if known
      let sizeQuery = supabase
        .from('properties')
        .select('bedrooms, plot_size, type')
        .eq('tenant_id', tenant.id)
        .ilike('type', normalizedInterest)
        .ilike('location', normalizedLocation)
        .eq('available', true);

      if (lead.is_offplan === true) sizeQuery = sizeQuery.eq('is_offplan', true);
      if (lead.is_offplan === false) sizeQuery = sizeQuery.eq('is_offplan', false);

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
        await sendMessage(tenantWhatsApp, from, `Sorry, no properties available in ${location} right now.\n\nReply HI to start over.`);
      }
      return;
    }

    // -----------------------------------------------
    // ACTION: booking
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
        await sendMessage(tenantWhatsApp, from, `Sorry, could not find that property.\n\nReply HI to start over.`);
        return;
      }

      await sendMessage(tenantWhatsApp, from, `Great choice! 🎉 Let me check availability for *${selectedProperty.name}*...`);

      const slotsResponse = await fetch(`${process.env.BACKEND_URL}/api/available-slots-v2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: tenant.id, propertyId: selectedProperty.id, leadId: lead.id })
      });
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
    // ACTION: cancel_booking
    // -----------------------------------------------
    if (result.action === 'cancel_booking' && lead) {
      await supabase
        .from('leads')
        .update({ conversation_stage: 'booking_cancelled', status: 'Cancelled' })
        .eq('id', lead.id);

      const cancelResponse = await fetch(`${process.env.BACKEND_URL}/api/cancel-booking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: lead.id, calendarId: tenant.google_calendar_id })
      });
      const cancelData = await cancelResponse.json();

      await sendMessage(tenantWhatsApp, from, cancelData.userMessage || `Your viewing has been cancelled.\n\nReply HI to search for another property.`);

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
        .update({ status: 'Hot Lead', conversation_stage: 'interested_after_viewing', awaiting_followup_response: false })
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
        .update({ status: 'Not Interested', conversation_stage: 'not_interested_after_viewing', awaiting_followup_response: false })
        .eq('id', lead.id);

      await sendMessage(tenantWhatsApp, from, result.replyMessage);
      return;
    }

    // -----------------------------------------------
    // DEFAULT: send reply
    // -----------------------------------------------
    if (result.replyMessage) {
      await sendMessage(tenantWhatsApp, from, result.replyMessage);
    }