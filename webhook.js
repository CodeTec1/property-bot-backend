// webhook.js - Handles incoming WhatsApp messages directly from Twilio
const express = require('express');
const router = express.Router();
const supabase = require('./supabase');
const handleMessage = require('./handleMessage');
const twilio = require('twilio');

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// ============================================
// Helper: Look up tenant and lead
// ============================================
async function getTenantAndLead(to, from) {
  try {
    const toNumber = to.replace('whatsapp:', '').trim();
    const fromNumber = from.trim();

    // Look up tenant by WhatsApp number
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

    // Look up lead by phone number and tenant
    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', fromNumber)
      .eq('tenant_id', tenant.id)
      .single();

    return { tenant, lead: lead || null };

  } catch (error) {
    console.error('Error in getTenantAndLead:', error);
    return { tenant: null, lead: null };
  }
}

// ============================================
// Helper: Send Twilio message
// ============================================
async function sendMessage(from, to, body, mediaUrl = null) {
  try {
    const options = { from, to, body };
    if (mediaUrl) options.mediaUrl = [mediaUrl];
    await twilioClient.messages.create(options);
  } catch (error) {
    console.error('Error sending message:', error);
  }
}

// ============================================
// Helper: Small delay between messages
// ============================================
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// WEBHOOK: Receive WhatsApp messages from Twilio
// ============================================
router.post('/', async (req, res) => {
  try {
    const from = req.body.From;
    const to = req.body.To;
    const message = req.body.Body;

    console.log(`Message from ${from} to ${to}: ${message}`);

    // Respond to Twilio immediately to prevent timeout
    res.status(200).send('<Response></Response>');

    // Look up tenant and lead
    const { tenant, lead } = await getTenantAndLead(to, from);

    if (!tenant) {
      await sendMessage(to, from, 'Sorry, this service is not available on this number.');
      return;
    }

    const tenantWhatsApp = tenant.whatsapp_number;

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
      tenant_id: tenant.id,
      tenant_company_name: tenant.company_name,
      tenant_bot_name: tenant.bot_name,
      tenant_property_types: tenant.property_types,
      tenant_whatsapp: tenant.whatsapp_number
    };

    const result = await handleMessage(input);

    // -----------------------------------------------
    // Handle all database updates based on action
    // -----------------------------------------------

    // CREATE new lead
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

      if (createError) console.error('Error creating lead:', createError);
    }

    // UPDATE lead
    if (result.action === 'update' && lead) {
      const updateData = {};
      if (result.updateFields?.['Conversation Stage']) updateData.conversation_stage = result.updateFields['Conversation Stage'];
      if (result.updateFields?.Name) updateData.name = result.updateFields.Name;
      if (result.updateFields?.Interest) updateData.interest = result.updateFields.Interest;
      if (result.updateFields?.Budget) updateData.budget = result.updateFields.Budget;
      if (result.updateFields?.Location) updateData.location = result.updateFields.Location;
      if (result.updateFields?.Size) updateData.size = result.updateFields.Size;
      if (result.updateFields?.Status) updateData.status = result.updateFields.Status;
      if (result.updateFields?.['Selected Property Number']) updateData.selected_property_number = result.updateFields['Selected Property Number'];

      if (Object.keys(updateData).length > 0) {
        await supabase.from('leads').update(updateData).eq('id', lead.id);
      }
    }

    // FETCH LOCATIONS
    if (result.action === 'fetch_locations' && lead) {
      await supabase
        .from('leads')
        .update({
          budget: result.updateFields?.Budget,
          conversation_stage: 'fetching_locations'
        })
        .eq('id', lead.id);
    }

    // FETCH SIZES
    if (result.action === 'fetch_sizes' && lead) {
      await supabase
        .from('leads')
        .update({
          location: result.location,
          conversation_stage: 'fetching_sizes'
        })
        .eq('id', lead.id);
    }

    // BOOKING - get available slots
    if (result.action === 'booking' && lead) {
      await supabase
        .from('leads')
        .update({
          selected_property_number: result.propertyNumber,
          conversation_stage: 'awaiting_time_slot'
        })
        .eq('id', lead.id);

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

      result.lead_id = lead.id;
      result.lead_name = lead.name;
      result.tenant_id = tenant.id;
    }

    // CREATE BOOKING
    if (result.action === 'create_booking' && lead) {
      await supabase
        .from('leads')
        .update({ conversation_stage: 'booking_confirmed' })
        .eq('id', lead.id);

      result.lead_id = lead.id;
      result.lead_name = lead.name;
      result.from = lead.phone;
      result.tenant_id = tenant.id;

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

      result.slotMap = lead.available_slots || '{}';
    }

    // CANCEL BOOKING
    if (result.action === 'cancel_booking' && lead) {
      await supabase
        .from('leads')
        .update({
          conversation_stage: 'booking_cancelled',
          status: 'Cancelled'
        })
        .eq('id', lead.id);

      result.lead_id = lead.id;
      result.tenant_calendar_id = tenant.google_calendar_id;
    }

    // FOLLOWUP INTERESTED
    if (result.action === 'followup_interested' && lead) {
      await supabase
        .from('leads')
        .update({
          status: 'Hot Lead',
          conversation_stage: 'interested_after_viewing',
          awaiting_followup_response: false
        })
        .eq('id', lead.id);
    }

    // FOLLOWUP NOT INTERESTED
    if (result.action === 'followup_not_interested' && lead) {
      await supabase
        .from('leads')
        .update({
          status: 'Not Interested',
          conversation_stage: 'not_interested_after_viewing',
          awaiting_followup_response: false
        })
        .eq('id', lead.id);
    }

    // -----------------------------------------------
    // Get agent details for this tenant
    // -----------------------------------------------
    const { data: agentData } = await supabase
      .from('agents')
      .select('agent_name, phone, email')
      .eq('tenant_id', tenant.id)
      .eq('active', true)
      .single();

    const agentPhone = agentData?.phone || null;
    const cleanLeadPhone = lead?.phone ? lead.phone.replace('whatsapp:', '').trim() : null;

    // -----------------------------------------------
    // Send messages based on action
    // -----------------------------------------------

    // ACTION: create — send welcome message
    if (result.action === 'create') {
      await sendMessage(tenantWhatsApp, from, result.replyMessage);
      return;
    }

    // ACTION: update — send reply, then search if needed
    if (result.action === 'update') {
      await sendMessage(tenantWhatsApp, from, result.replyMessage);

      if (result.searchProperties && lead) {
        const normalizedInterest = lead.interest.charAt(0).toUpperCase() + lead.interest.slice(1).toLowerCase();
        const normalizedLocation = lead.location.charAt(0).toUpperCase() + lead.location.slice(1).toLowerCase();

        const { data: searchData } = await supabase
          .from('properties')
          .select('id, property_name, type, price, bedrooms, plot_size, location, address, photo_url')
          .eq('tenant_id', tenant.id)
          .ilike('type', normalizedInterest)
          .ilike('location', normalizedLocation)
          .eq('available', true)
          .order('price', { ascending: true })
          .limit(3);

        const sizeField = lead.size || '';
        let filteredData = searchData || [];

        if (normalizedInterest === 'Land') {
          const cleanPlotSize = sizeField.replace(/\s+/g, '').toLowerCase();
          filteredData = filteredData.filter(p =>
            p.plot_size && p.plot_size.replace(/\s+/g, '').toLowerCase().includes(cleanPlotSize)
          );
        } else {
          const bedroomMatch = sizeField.match(/\d+/);
          const bedroomNumber = bedroomMatch ? parseInt(bedroomMatch[0]) : null;
          if (bedroomNumber) {
            filteredData = filteredData.filter(p => p.bedrooms === bedroomNumber);
          }
        }

        if (filteredData.length > 0) {
          for (let i = 0; i < filteredData.length; i++) {
            const property = filteredData[i];
            const propertyMessage =
              `PROPERTY ${i + 1} 🏡\n\n` +
              `Property: ${property.property_name}\n` +
              `Location: ${property.location}\n` +
              `Price: KES ${Number(property.price).toLocaleString()}\n` +
              `${property.type === 'Land' ? `Size: ${property.plot_size}` : `Size: ${property.bedrooms} Bedrooms`}\n` +
              `Address: ${property.address}\n\n` +
              `Reply Property${i + 1} to book viewing.`;

            await sendMessage(tenantWhatsApp, from, propertyMessage, property.photo_url || null);
            await delay(1500);
          }
        } else {
          await sendMessage(
            tenantWhatsApp,
            from,
            `Sorry, we could not find any properties matching your criteria.\n\nAgent: ${agentData?.agent_name || 'Our agent'}\nPhone: ${agentPhone || ''}\n\nThey will help you find your perfect property!\n\nReply HI to start over.`
          );

          if (agentPhone) {
            await sendMessage(
              tenantWhatsApp,
              `whatsapp:${agentPhone}`,
              `Lead Alert!\n\nA client could not find properties matching their criteria.\n\nClient: ${lead.name}\nPhone: ${cleanLeadPhone}\nInterest: ${lead.interest}\nLocation: ${lead.location}\nBudget: KES ${lead.budget}`
            );
          }
        }
      }
      return;
    }

    // ACTION: fetch_locations
    if (result.action === 'fetch_locations') {
      await sendMessage(tenantWhatsApp, from, result.replyMessage);

      const interest = result.interest || lead?.interest;
      const normalizedInterest = interest ? interest.charAt(0).toUpperCase() + interest.slice(1).toLowerCase() : '';

      const { data: locData } = await supabase
        .from('properties')
        .select('location')
        .eq('tenant_id', tenant.id)
        .ilike('type', normalizedInterest)
        .eq('available', true);

      if (locData && locData.length > 0) {
        const locations = [...new Set(locData.map(r => r.location).filter(Boolean))].sort();
        const formatted = locations.map(loc => `• ${loc}`).join('\n');

        // Update lead stage to asked_location
        if (lead) {
          await supabase
            .from('leads')
            .update({ conversation_stage: 'asked_location' })
            .eq('id', lead.id);
        }

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

    // ACTION: fetch_sizes
    if (result.action === 'fetch_sizes') {
      await sendMessage(tenantWhatsApp, from, result.replyMessage);

      const interest = lead?.interest || '';
      const location = result.location || lead?.location || '';
      const normalizedInterest = interest.charAt(0).toUpperCase() + interest.slice(1).toLowerCase();
      const normalizedLocation = location.charAt(0).toUpperCase() + location.slice(1).toLowerCase();

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
          const beds = [...new Set(sizeData.map(r => parseInt(r.bedrooms)).filter(n => !isNaN(n)))].sort((a, b) => a - b);
          options = beds.map(b => `• ${b} bedroom${b > 1 ? 's' : ''}`).join('\n');
          nextStage = 'asked_size';
        }

        // Update lead stage
        if (lead) {
          await supabase
            .from('leads')
            .update({ conversation_stage: nextStage })
            .eq('id', lead.id);
        }

        await sendMessage(
          tenantWhatsApp,
          from,
          `How many bedrooms are you looking for?\n\nAvailable options:\n\n${options}\n\nJust type the number.`
        );
      } else {
        await sendMessage(tenantWhatsApp, from, `Sorry, no properties available in that location.\n\nReply HI to start over.`);
      }
      return;
    }

    // ACTION: booking - send available slots
    if (result.action === 'booking') {
      await sendMessage(tenantWhatsApp, from, result.replyMessage);

      if (result.propertyId) {
        const slotsResponse = await fetch(`https://property-bot-backend.onrender.com/api/available-slots-v2`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId: tenant.id,
            propertyId: result.propertyId,
            leadId: lead.id
          })
        });
        const slotsData = await slotsResponse.json();

        await sendMessage(tenantWhatsApp, from, slotsData.message);
      }
      return;
    }

    // ACTION: create_booking
    if (result.action === 'create_booking') {
      await sendMessage(tenantWhatsApp, from, result.replyMessage);

      if (result.propertyId) {
        const bookingResponse = await fetch(`https://property-bot-backend.onrender.com/api/create-booking`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId: tenant.id,
            leadId: lead.id,
            propertyId: result.propertyId,
            slotNumber: result.selectedTime,
            slotMap: result.slotMap,
            leadName: lead.name,
            leadPhone: from
          })
        });
        const bookingData = await bookingResponse.json();

        if (bookingData.success) {
          await sendMessage(tenantWhatsApp, from, bookingData.message);

          if (agentPhone) {
            await sendMessage(
              tenantWhatsApp,
              `whatsapp:${agentPhone}`,
              bookingData.agentMessage
            );
          }
        } else if (bookingData.slotTaken) {
          await sendMessage(
            tenantWhatsApp,
            from,
            `Sorry, that time slot was just taken by another client.\n\nLet me find you another time...`
          );

          const newSlotsResponse = await fetch(`https://property-bot-backend.onrender.com/api/available-slots-v2`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tenantId: tenant.id,
              propertyId: result.propertyId,
              leadId: lead.id
            })
          });
          const newSlotsData = await newSlotsResponse.json();

          await sendMessage(tenantWhatsApp, from, newSlotsData.message);

          await supabase
            .from('leads')
            .update({ conversation_stage: 'awaiting_time_slot' })
            .eq('id', lead.id);
        }
      }
      return;
    }

    // ACTION: cancel_booking
    if (result.action === 'cancel_booking') {
      await sendMessage(tenantWhatsApp, from, result.replyMessage);

      const cancelResponse = await fetch(`https://property-bot-backend.onrender.com/api/cancel-booking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: lead.id,
          calendarId: tenant.google_calendar_id
        })
      });
      const cancelData = await cancelResponse.json();

      await sendMessage(tenantWhatsApp, from, cancelData.userMessage);

      if (cancelData.agentNotification?.agentPhone) {
        await sendMessage(
          tenantWhatsApp,
          `whatsapp:${cancelData.agentNotification.agentPhone}`,
          cancelData.agentNotification.message
        );
      }
      return;
    }

    // ACTION: followup_interested
    if (result.action === 'followup_interested') {
      await sendMessage(tenantWhatsApp, from, result.replyMessage);

      if (agentPhone) {
        await sendMessage(
          tenantWhatsApp,
          `whatsapp:${agentPhone}`,
          `Hot Lead Alert!\n\n${lead.name} is interested after their viewing.\n\nContact them as soon as possible: ${cleanLeadPhone}\n\nProperty viewed: ${lead.last_viewed_property || 'N/A'}`
        );
      }
      return;
    }

    // ACTION: followup_not_interested
    if (result.action === 'followup_not_interested') {
      await sendMessage(tenantWhatsApp, from, result.replyMessage);
      return;
    }

    // ACTION: invalid or anything else
    if (result.replyMessage) {
      await sendMessage(tenantWhatsApp, from, result.replyMessage);
    }

  } catch (error) {
    console.error('Error in webhook:', error);
  }
});

module.exports = router;