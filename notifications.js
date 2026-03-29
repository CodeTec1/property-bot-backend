// notifications.js - Handles reminders and follow-ups automatically
const supabase = require('./supabase');
const twilio = require('twilio');

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// ============================================
// Twilio Template SIDs
// ============================================
const TEMPLATES = {
  VIEWING_REMINDER: 'HXe2f13d97461952b669a22dd6a17081aa',
};

// ============================================
// Helper: Send regular Twilio message
// ============================================
async function sendMessage(from, to, body) {
  try {
    await twilioClient.messages.create({ from, to, body });
    console.log(`Message sent to ${to}`);
  } catch (error) {
    console.error(`Error sending message to ${to}:`, error.message);
  }
}

// ============================================
// Helper: Send Twilio template to agent
// ============================================
async function sendTemplateToAgent(tenantWhatsApp, agentPhone, templateSid, variables) {
  try {
    if (!agentPhone) return;

    const agentWhatsApp = agentPhone.startsWith('whatsapp:')
      ? agentPhone
      : `whatsapp:${agentPhone}`;

    await twilioClient.messages.create({
      from: tenantWhatsApp,
      to: agentWhatsApp,
      contentSid: templateSid,
      contentVariables: JSON.stringify(variables)
    });

    console.log('Reminder template sent to agent:', agentPhone);
  } catch (error) {
    console.error('Error sending template to agent:', error.message);
  }
}

// ============================================
// Helper: Format Kenya date
// ============================================
function formatKenyaDate(isoString, timezone) {
  return new Date(isoString).toLocaleDateString('en-KE', {
    timeZone: timezone || 'Africa/Nairobi',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  });
}

// ============================================
// Helper: Format Kenya time
// ============================================
function formatKenyaTime(isoString, timezone) {
  return new Date(isoString).toLocaleTimeString('en-KE', {
    timeZone: timezone || 'Africa/Nairobi',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

// ============================================
// CHECK AND SEND 12-HOUR REMINDERS
// ============================================
async function check12HourReminders() {
  try {
    console.log('Checking 12-hour reminders...');

    const now = new Date();
    const in12Hours = new Date(now.getTime() + (12 * 60 * 60 * 1000));
    const in11Hours = new Date(now.getTime() + (11 * 60 * 60 * 1000));

    const { data: bookings, error } = await supabase
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

    if (error) throw error;

    console.log(`Found ${bookings.length} bookings needing 12h reminder`);

    for (const booking of bookings) {
      const timezone = booking.tenants?.timezone || 'Africa/Nairobi';
      const tenantWhatsApp = booking.tenants?.whatsapp_number;
      const leadPhone = booking.leads?.phone;
      const leadName = booking.leads?.name;
      const propertyName = booking.properties?.property_name;
      const propertyAddress = booking.properties?.address;
      const agentPhone = booking.properties?.agents?.phone || null;
      const formattedDate = formatKenyaDate(booking.start_datetime, timezone);
      const formattedTime = formatKenyaTime(booking.start_datetime, timezone);

      if (!tenantWhatsApp || !leadPhone) continue;

      // Send reminder to client
      await sendMessage(
        tenantWhatsApp,
        leadPhone,
        `Reminder: Viewing Coming Up!\n\n` +
        `Property: ${propertyName}\n` +
        `Date: ${formattedDate}\n` +
        `Time: ${formattedTime}\n` +
        `Address: ${propertyAddress}\n\n` +
        (agentPhone ? `Agent Phone: ${agentPhone}\n\n` : '') +
        `See you there!`
      );

      // Send reminder to agent via template
      await sendTemplateToAgent(
        tenantWhatsApp,
        agentPhone,
        TEMPLATES.VIEWING_REMINDER,
        {
          "1": leadName || 'Unknown',
          "2": leadPhone.replace('whatsapp:', '').trim(),
          "3": propertyName || 'N/A',
          "4": propertyAddress || 'N/A',
          "5": formattedDate,
          "6": formattedTime
        }
      );

      // Mark reminder as sent
      await supabase
        .from('bookings')
        .update({ reminder_12h_sent: true })
        .eq('id', booking.id);

      console.log(`12h reminder sent for booking ${booking.id}`);
    }

  } catch (error) {
    console.error('Error in check12HourReminders:', error);
  }
}

// ============================================
// CHECK AND SEND 1-HOUR REMINDERS
// ============================================
async function check1HourReminders() {
  try {
    console.log('Checking 1-hour reminders...');

    const now = new Date();
    const in1Hour = new Date(now.getTime() + (1 * 60 * 60 * 1000));
    const in50Minutes = new Date(now.getTime() + (50 * 60 * 1000));

    const { data: bookings, error } = await supabase
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

    if (error) throw error;

    console.log(`Found ${bookings.length} bookings needing 1h reminder`);

    for (const booking of bookings) {
      const timezone = booking.tenants?.timezone || 'Africa/Nairobi';
      const tenantWhatsApp = booking.tenants?.whatsapp_number;
      const leadPhone = booking.leads?.phone;
      const leadName = booking.leads?.name;
      const propertyName = booking.properties?.property_name;
      const propertyAddress = booking.properties?.address;
      const agentPhone = booking.properties?.agents?.phone || null;
      const formattedDate = formatKenyaDate(booking.start_datetime, timezone);
      const formattedTime = formatKenyaTime(booking.start_datetime, timezone);

      if (!tenantWhatsApp || !leadPhone) continue;

      // Send reminder to client
      await sendMessage(
        tenantWhatsApp,
        leadPhone,
        `Your viewing starts in 1 hour!\n\n` +
        `Property: ${propertyName}\n` +
        `Address: ${propertyAddress}\n` +
        `Time: ${formattedTime}\n\n` +
        `The agent is ready for you.`
      );

      // Send reminder to agent via template
      await sendTemplateToAgent(
        tenantWhatsApp,
        agentPhone,
        TEMPLATES.VIEWING_REMINDER,
        {
          "1": leadName || 'Unknown',
          "2": leadPhone.replace('whatsapp:', '').trim(),
          "3": propertyName || 'N/A',
          "4": propertyAddress || 'N/A',
          "5": formattedDate,
          "6": formattedTime
        }
      );

      // Mark reminder as sent
      await supabase
        .from('bookings')
        .update({ reminder_1h_sent: true })
        .eq('id', booking.id);

      console.log(`1h reminder sent for booking ${booking.id}`);
    }

  } catch (error) {
    console.error('Error in check1HourReminders:', error);
  }
}

// ============================================
// CHECK AND SEND FOLLOW-UPS
// ============================================
async function checkFollowUps() {
  try {
    console.log('Checking follow-ups...');

    const now = new Date();
    const twoHalfHoursAgo = new Date(now.getTime() - (2.5 * 60 * 60 * 1000));
    const threeHalfHoursAgo = new Date(now.getTime() - (3.5 * 60 * 60 * 1000));

    const { data: bookings, error } = await supabase
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

    if (error) throw error;

    console.log(`Found ${bookings.length} bookings needing follow-up`);

    for (const booking of bookings) {
      const tenantWhatsApp = booking.tenants?.whatsapp_number;
      const leadPhone = booking.leads?.phone;
      const leadName = booking.leads?.name;
      const propertyName = booking.properties?.property_name;

      if (!tenantWhatsApp || !leadPhone) continue;

      // Send follow-up message to client
      await sendMessage(
        tenantWhatsApp,
        leadPhone,
        `Hi ${leadName},\n\n` +
        `How was your viewing of ${propertyName}?\n\n` +
        `Reply:\n` +
        `1 - Interested\n` +
        `2 - Not Interested\n` +
        `HI - to search for another property\n\n` +
        `We are here to help.`
      );

      // Mark follow-up as sent and set awaiting response
      await supabase
        .from('bookings')
        .update({ followup_sent: true })
        .eq('id', booking.id);

      await supabase
        .from('leads')
        .update({
          awaiting_followup_response: true,
          last_viewed_property: propertyName
        })
        .eq('id', booking.lead_id);

      console.log(`Follow-up sent for booking ${booking.id}`);
    }

  } catch (error) {
    console.error('Error in checkFollowUps:', error);
  }
}

// ============================================
// MAIN FUNCTION - runs every hour
// ============================================
async function runNotifications() {
  console.log('========================================');
  console.log('Running notifications check:', new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' }));
  console.log('========================================');

  await check12HourReminders();
  await check1HourReminders();
  await checkFollowUps();

  console.log('Notifications check complete');
}

module.exports = { runNotifications };