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
// Helper: Send Twilio message safely
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
  const match = sizeStr.toString().match(/\d+/);
  return match ? parseInt(match[0]) : null;
}

// ============================================
// Helper: Search properties from Supabase
// ============================================
async function searchProperties(tenantId, interest, location, size) {
  try {
    const normalizedInterest = normalize(interest);
    const normalizedLocation = normalize(location);

    console.log('Searching properties:', { tenantId, normalizedInterest, normalizedLocation, size });

    let query = supabase
      .from('properties')
      .select('id, property_name, type, price, bedrooms, plot_size, location, address, photo_url')
      .eq('tenant_id', tenantId)
      .ilike('type', normalizedInterest)
      .ilike('location', normalizedLocation)
      .eq('available', true)
      .order('price', { ascending: true })
      .limit(3);

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
// Helper: Notify agent via WhatsApp
// ============================================
async function notifyAgent(tenantWhatsApp, agentPhone, message) {
  if (!agentPhone) return;
  const agentWhatsApp = agentPhone.startsWith('whatsapp:')
    ? agentPhone
    : `whatsapp:${agentPhone}`;
  await sendMessage(tenantWhatsApp, agentWhatsApp, message);
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

    // Process message through handleMessage
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

      if (Object.keys(updateData).length > 0) {
        await supabase.from('leads').update(updateData).eq('id', lead.id);
      }

      // Send reply first
      await sendMessage(tenantWhatsApp, from, result.replyMessage);

      // Then search properties if needed
      if (result.searchProperties) {
        // Use updated values not old lead values
        const searchInterest = updateData.interest || lead.interest;
        const searchLocation = updateData.location || lead.location;
        const searchSize = updateData.size || lead.size;

        console.log('Searching with:', { searchInterest, searchLocation, searchSize });

        const properties = await searchProperties(
          tenant.id,
          searchInterest,
          searchLocation,
          searchSize
        );

        if (properties.length > 0) {
          for (let i = 0; i < properties.length; i++) {
            const property = properties[i];
            const propertyMessage =
              `PROPERTY ${i + 1} 🏡\n\n` +
              `Property: ${property.property_name}\n` +
              `Location: ${property.location}\n` +
              `Price: KES ${Number(property.price).toLocaleString()}\n` +
              `${property.type === 'Land'
                ? `Size: ${property.plot_size}`
                : `Size: ${property.bedrooms} Bedroom${property.bedrooms > 1 ? 's' : ''}`
              }\n` +
              `Address: ${property.address}\n\n` +
              `Reply Property${i + 1} to book viewing.`;

            await sendMessage(
              tenantWhatsApp,
              from,
              propertyMessage,
              property.photo_url || null
            );

            // Delay between messages so they arrive in order
            if (i < properties.length - 1) await delay(2000);
          }
        } else {
          // No properties found — notify user
          await sendMessage(
            tenantWhatsApp,
            from,
            `Sorry, we could not find any properties matching your criteria.\n\n` +
            `Agent: ${agentName}\n` +
            `Phone: ${agentPhone || 'N/A'}\n\n` +
            `They will help you find your perfect property!\n\n` +
            `Reply HI to start a new search.`
          );

          // Notify agent
          await notifyAgent(
            tenantWhatsApp,
            agentPhone,
            `Lead Alert!\n\n` +
            `Client: ${lead.name || 'Unknown'}\n` +
            `Phone: ${cleanLeadPhone}\n` +
            `Interest: ${searchInterest}\n` +
            `Location: ${searchLocation}\n` +
            `Budget: KES ${lead.budget || 'Not specified'}\n\n` +
            `Could not find matching properties. Please follow up.`
          );
        }
      }
      return;
    }

    // -----------------------------------------------
    // ACTION: fetch_locations
    // -----------------------------------------------
    if (result.action === 'fetch_locations' && lead) {
      // Save budget first
      await supabase
        .from('leads')
        .update({
          budget: result.updateFields?.Budget,
          conversation_stage: 'fetching_locations'
        })
        .eq('id', lead.id);

      // Send "let me check" message first
      await sendMessage(tenantWhatsApp, from, result.replyMessage);

      // Fetch locations from Supabase
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

        // Update stage to asked_location
        await supabase
          .from('leads')
          .update({ conversation_stage: 'asked_location' })
          .eq('id', lead.id);

        await sendMessage(
          tenantWhatsApp,
          from,
          `Which area are you interested in?\n\n` +
          `We have properties in:\n\n${formatted}\n\n` +
          `Just type the area name.`
        );
      } else {
        await sendMessage(
          tenantWhatsApp,
          from,
          `Sorry, no locations available right now.\n\nReply HI to start over.`
        );
      }
      return;
    }

    // -----------------------------------------------
    // ACTION: fetch_sizes
    // -----------------------------------------------
    if (result.action === 'fetch_sizes' && lead) {
      // Save location first
      await supabase
        .from('leads')
        .update({
          location: result.location,
          conversation_stage: 'fetching_sizes'
        })
        .eq('id', lead.id);

      // Send "checking" message first
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
          options = beds.map(b => `• ${b} Bedroom${b > 1 ? 's' : ''}`).join('\n');
          nextStage = 'asked_size';
        }

        await supabase
          .from('leads')
          .update({ conversation_stage: nextStage })
          .eq('id', lead.id);

        await sendMessage(
          tenantWhatsApp,
          from,
          `How many bedrooms are you looking for?\n\n` +
          `Available options:\n\n${options}\n\n` +
          `Just type the number.`
        );
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
    // ACTION: booking — check available slots
    // -----------------------------------------------
    if (result.action === 'booking' && lead) {
      // Save selected property number
      await supabase
        .from('leads')
        .update({
          selected_property_number: result.propertyNumber,
          conversation_stage: 'awaiting_time_slot'
        })
        .eq('id', lead.id);

      // Send "checking availability" message
      await sendMessage(tenantWhatsApp, from, result.replyMessage);

      // Find the actual property ID
      const normalizedInterest = normalize(lead.interest);
      const normalizedLocation = normalize(lead.location);

      const { data: properties } = await supabase
        .from('properties')
        .select('id, property_name')
        .eq('tenant_id', tenant.id)
        .ilike('type', normalizedInterest)
        .ilike('location', normalizedLocation)
        .eq('available', true)
        .order('price', { ascending: true })
        .limit(result.propertyNumber);

      if (!properties || properties.length < result.propertyNumber) {
        await sendMessage(
          tenantWhatsApp,
          from,
          `Sorry, could not find that property.\n\nReply HI to start over.`
        );
        return;
      }

      const selectedProperty = properties[result.propertyNumber - 1];

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

      // Save property ID and slot map to lead
      await supabase
        .from('leads')
        .update({
          available_slots: slotsData.slotMap,
          last_viewed_property: selectedProperty.property_name
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

      // Get property ID from fresh search
      const normalizedInterest = normalize(lead.interest);
      const normalizedLocation = normalize(lead.location);

      const { data: properties } = await supabase
        .from('properties')
        .select('id, property_name')
        .eq('tenant_id', tenant.id)
        .ilike('type', normalizedInterest)
        .ilike('location', normalizedLocation)
        .eq('available', true)
        .order('price', { ascending: true })
        .limit(lead.selected_property_number);

      if (!properties || properties.length < lead.selected_property_number) {
        await sendMessage(
          tenantWhatsApp,
          from,
          `Sorry, could not find the property details.\n\nReply HI to start over.`
        );
        return;
      }

      const selectedProperty = properties[lead.selected_property_number - 1];
      const slotMap = lead.available_slots || '{}';

      const bookingResponse = await fetch(
        `https://property-bot-backend.onrender.com/api/create-booking`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId: tenant.id,
            leadId: lead.id,
            propertyId: selectedProperty.id,
            slotNumber: result.selectedTime.toString(),
            slotMap: slotMap,
            leadName: lead.name,
            leadPhone: from
          })
        }
      );
      const bookingData = await bookingResponse.json();

      if (bookingData.success) {
        // Update lead stage
        await supabase
          .from('leads')
          .update({ conversation_stage: 'booking_confirmed' })
          .eq('id', lead.id);

        // Confirm to user
        await sendMessage(tenantWhatsApp, from, bookingData.message);

        // Notify agent
        await notifyAgent(
          tenantWhatsApp,
          agentPhone,
          `New Viewing Booked!\n\n` +
          `Client: ${lead.name}\n` +
          `Phone: ${cleanLeadPhone}\n` +
          `Property: ${bookingData.slotDetails?.property}\n` +
          `Address: ${bookingData.slotDetails?.address}\n` +
          `Date: ${bookingData.slotDetails?.date}\n` +
          `Time: ${bookingData.slotDetails?.time}\n` +
          `Budget: KES ${lead.budget}`
        );

      } else if (bookingData.slotTaken) {
        // Slot was taken
        await sendMessage(
          tenantWhatsApp,
          from,
          `Sorry, that time slot was just taken.\n\nLet me find you another time...`
        );

        // Get fresh slots
        const newSlotsResponse = await fetch(
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

      // Notify user
      await sendMessage(tenantWhatsApp, from, cancelData.userMessage);

      // Notify agent
      await notifyAgent(
        tenantWhatsApp,
        agentPhone,
        cancelData.agentNotification?.message ||
        `Booking Cancelled\n\nClient: ${lead.name}\nPhone: ${cleanLeadPhone}`
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

      // Notify agent
      await notifyAgent(
        tenantWhatsApp,
        agentPhone,
        `Hot Lead Alert!\n\n` +
        `${lead.name} is interested after their viewing.\n\n` +
        `Contact them now: ${cleanLeadPhone}\n` +
        `Property viewed: ${lead.last_viewed_property || 'N/A'}`
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

    // Safety net - if anything fails notify user and agent
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