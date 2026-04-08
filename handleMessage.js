// handleMessage.js - Structured conversation flow
const supabase = require('./supabase');

async function handleMessage(input) {
  try {
    const originalMessage = input.message || '';
    const message = originalMessage.toLowerCase().trim();
    const stage = input.lead_stage || null;
    const leadExists = !!input.lead_id;

    const botName = input.tenant_bot_name || 'PropertyBot';
    const companyName = input.tenant_company_name || 'our company';
    const tenantId = input.tenant_id;
    const tenantTypes = input.tenant_property_types || 'Buy, Rent';

    let response = {
      action: '',
      updateFields: {},
      replyMessage: '',
      searchProperties: false,
      interest: '',
      location: '',
      propertyNumber: 0,
      selectedTime: '',
      isOffplan: null,
      completionRange: null
    };

    // ============================================
    // NEW USER
    // ============================================
    if (!leadExists) {
      const types = tenantTypes.split(',').map((t, i) => `${i + 1} - ${t.trim()}`).join('\n');
      response.action = 'create';
      response.updateFields = { 'Conversation Stage': 'asked_buy_or_rent', 'Status': 'New' };
      response.replyMessage =
        `Hi! Welcome to *${companyName}* 👋\n\n` +
        `I am ${botName}, your property assistant.\n\n` +
        `What are you looking for?\n\n${types}\n\nReply with the number or name.`;
      return response;
    }

    // ============================================
    // GREETING - RESTART
    // ============================================
    if (message.match(/^(hi|hello|hey|start|helo|restart)$/)) {
      const types = tenantTypes.split(',').map((t, i) => `${i + 1} - ${t.trim()}`).join('\n');
      response.action = 'update';
      response.updateFields = { 'Conversation Stage': 'asked_buy_or_rent' };
      response.replyMessage =
        `Hi${input.lead_name ? ` ${input.lead_name}` : ''}! Welcome back to *${companyName}* 👋\n\n` +
        `I am ${botName}, your property assistant.\n\n` +
        `What are you looking for?\n\n${types}\n\nReply with the number or name.`;
      return response;
    }

    // ============================================
    // STAGE 1: PROPERTY TYPE
    // ============================================
    if (stage === 'asked_buy_or_rent') {
      const typesList = tenantTypes.split(',').map(t => t.trim());
      const typeMapping = {};
      typesList.forEach((type, index) => {
        typeMapping[(index + 1).toString()] = type;
        typeMapping[type.toLowerCase()] = type;
      });

      // Handle common variations
      if (message.includes('buy') || message.includes('purchase')) typeMapping['buy'] = 'Buy';
      if (message.includes('rent')) typeMapping['rent'] = 'Rent';
      if (message.includes('land') || message.includes('plot')) typeMapping['land'] = 'Land';

      const selectedType = typeMapping[message] ||
        typesList.find(t => message.includes(t.toLowerCase()));

      if (!selectedType) {
        const types = tenantTypes.split(',').map((t, i) => `${i + 1} - ${t.trim()}`).join('\n');
        response.action = 'invalid';
        response.replyMessage = `Please choose from the options below:\n\n${types}\n\nReply with the number or name.`;
        return response;
      }

      response.action = 'update';
      response.updateFields = { 'Interest': selectedType, 'Conversation Stage': 'asked_name' };
      response.replyMessage = `Great choice! 👍\n\nWhat is your name?`;
      return response;
    }

    // ============================================
    // STAGE 2: NAME
    // ============================================
    if (stage === 'asked_name') {
      let name = originalMessage.trim();

      if (name.toLowerCase().match(/my name is (.+)/i)) name = name.match(/my name is (.+)/i)[1];
      else if (name.toLowerCase().match(/i am (.+)/i)) name = name.match(/i am (.+)/i)[1];
      else if (name.toLowerCase().match(/i'm (.+)/i)) name = name.match(/i'm (.+)/i)[1];

      name = name.trim()
        .replace(/[^a-zA-Z\s]/g, '')
        .split(/\s+/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');

      if (!name || name.length < 2) {
        response.action = 'invalid';
        response.replyMessage = `Please enter your name.\n\nJust your name is enough!`;
        return response;
      }

      // Fetch locations from database
      response.action = 'fetch_locations';
      response.updateFields = { 'Name': name, 'Conversation Stage': 'fetching_locations' };
      response.interest = input.lead_interest || 'Buy';
      response.replyMessage = `Nice to meet you, ${name}! 😊\n\nLet me check available areas...`;
      return response;
    }

    // ============================================
    // STAGE 3: LOCATION
    // ============================================
    if (stage === 'asked_location') {
      let location = originalMessage.trim();
      if (location.match(/in (.+)/i)) location = location.match(/in (.+)/i)[1];
      if (location.match(/at (.+)/i)) location = location.match(/at (.+)/i)[1];

      location = location.trim()
        .split(/\s+/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');

      if (!location || location.length < 2) {
        response.action = 'invalid';
        response.replyMessage = `Please type the area name from the list above.`;
        return response;
      }

      // Fetch offplan/ready status then sizes
      response.action = 'fetch_offplan_status';
      response.updateFields = { 'Location': location, 'Conversation Stage': 'fetching_offplan' };
      response.location = location;
      response.interest = input.lead_interest;
      response.replyMessage = `Great choice! 📍\n\nLet me check what is available in ${location}...`;
      return response;
    }

    // ============================================
    // STAGE 4: OFFPLAN OR READY
    // ============================================
    if (stage === 'asked_offplan') {
      const isOffplan = message === '2' ||
        message.includes('off-plan') || message.includes('offplan') ||
        message.includes('off plan') || message.includes('under construction');

      const isReady = message === '1' ||
        message.includes('ready') || message.includes('move in') ||
        message.includes('completed');

      if (!isOffplan && !isReady) {
        response.action = 'invalid';
        response.replyMessage =
          `Please choose:\n\n` +
          `1 - Ready (move in immediately)\n` +
          `2 - Off-Plan (under construction)`;
        return response;
      }

      if (isReady) {
        response.action = 'fetch_sizes';
        response.updateFields = { 'IsOffplan': false, 'Conversation Stage': 'fetching_sizes' };
        response.location = input.lead_location;
        response.interest = input.lead_interest;
        response.isOffplan = false;
        response.replyMessage = `Perfect! Let me check available sizes...`;
        return response;
      }

      if (isOffplan) {
        // Fetch completion dates from database
        response.action = 'fetch_completion_dates';
        response.updateFields = { 'IsOffplan': true, 'Conversation Stage': 'fetching_completion' };
        response.location = input.lead_location;
        response.interest = input.lead_interest;
        response.isOffplan = true;
        response.replyMessage = `Great! Let me check available completion dates...`;
        return response;
      }
    }

    // ============================================
    // STAGE 5: COMPLETION DATE
    // ============================================
    if (stage === 'asked_completion') {
      const completionInput = originalMessage.trim();

      if (!completionInput || completionInput.length < 2) {
        response.action = 'invalid';
        response.replyMessage = `Please choose a completion date from the options above.`;
        return response;
      }

      response.action = 'fetch_sizes';
      response.updateFields = {
        'CompletionRange': completionInput,
        'Conversation Stage': 'fetching_sizes'
      };
      response.location = input.lead_location;
      response.interest = input.lead_interest;
      response.completionRange = completionInput;
      response.replyMessage = `Perfect! Let me check available bedroom options...`;
      return response;
    }

    // ============================================
    // STAGE 6: SIZE / BEDROOMS
    // ============================================
    if (stage === 'asked_size') {
      let bedrooms = null;
      const isStudio = message.match(/stud/i);

      if (isStudio) {
        bedrooms = 0;
      } else {
        if (message.match(/(\d+)\s*bed/i)) bedrooms = parseInt(message.match(/(\d+)\s*bed/i)[1]);
        else if (message.match(/^\d+$/)) bedrooms = parseInt(message);
        else if (message.match(/i (want|need) (\d+)/i)) bedrooms = parseInt(message.match(/i (want|need) (\d+)/i)[2]);
      }

      if (bedrooms === null || (isNaN(bedrooms) && !isStudio) || bedrooms < 0 || bedrooms > 20) {
        response.action = 'invalid';
        response.replyMessage = `Please choose from the bedroom options above.\n\nJust type the number or reply Studio.`;
        return response;
      }

      const displaySize = bedrooms === 0 ? 'Studio' : `${bedrooms} bedroom`;
      const budget = input.lead_budget;
      const interest = input.lead_interest;
      const location = input.lead_location;
      const isOffplan = input.is_offplan;
      const completionRange = input.completion_range;

      // Now fetch budget ranges from database
      response.action = 'fetch_budget_ranges';
      response.updateFields = {
        'Size': displaySize,
        'Conversation Stage': 'fetching_budget_ranges'
      };
      response.interest = interest;
      response.location = location;
      response.bedrooms = bedrooms;
      response.isOffplan = isOffplan;
      response.completionRange = completionRange;
      response.replyMessage = `Great! Let me check the price range for ${displaySize} in ${location}...`;
      return response;
    }

    // ============================================
    // STAGE 6B: LAND SIZE
    // ============================================
    if (stage === 'asked_land_size') {
      const plotSize = originalMessage.trim();

      if (!plotSize || plotSize.length < 2) {
        response.action = 'invalid';
        response.replyMessage = `Please choose from the plot sizes above.`;
        return response;
      }

      response.action = 'fetch_budget_ranges';
      response.updateFields = { 'Size': plotSize, 'Conversation Stage': 'fetching_budget_ranges' };
      response.interest = input.lead_interest;
      response.location = input.lead_location;
      response.plotSize = plotSize;
      response.replyMessage = `Great! Let me check available prices for ${plotSize} plots in ${input.lead_location}...`;
      return response;
    }

    // ============================================
    // STAGE 7: BUDGET
    // ============================================
    if (stage === 'asked_budget') {
      // Parse budget from user input
      let budget = null;
      const budgetPatterns = [
        { pattern: /(\d+\.?\d*)\s*million/i, multiplier: 1000000 },
        { pattern: /(\d+\.?\d*)\s*m\b/i, multiplier: 1000000 },
        { pattern: /(\d+\.?\d*)\s*k\b/i, multiplier: 1000 },
        { pattern: /kes\s*([\d,]+)/i, multiplier: 1 },
        { pattern: /^([\d,]+)$/, multiplier: 1 }
      ];

      for (const { pattern, multiplier } of budgetPatterns) {
        const match = message.match(pattern);
        if (match) {
          const amount = parseFloat(match[1].replace(/,/g, '')) * multiplier;
          if (!isNaN(amount) && amount >= 1000) {
            budget = amount;
            break;
          }
        }
      }

      if (!budget) {
        response.action = 'invalid';
        response.replyMessage = `Please enter your budget.\n\nExamples: 5M, 10M, KES 5,000,000`;
        return response;
      }

      const interest = input.lead_interest;
      const location = input.lead_location;
      const size = input.lead_size;
      const isOffplan = input.is_offplan;
      const completionRange = input.completion_range;

      response.action = 'update';
      response.updateFields = {
        'Budget': budget.toString(),
        'Conversation Stage': 'completed',
        'Status': 'Contacted'
      };

      const displaySize = size?.toLowerCase().includes('studio') ? 'Studio' : size;

      response.replyMessage =
        `✅ Got it! Let me find the best matches for you...\n\n` +
        `📋 Your preferences:\n` +
        `• Type: ${interest}\n` +
        `• Location: ${location}\n` +
        `• Size: ${displaySize}\n` +
        `• Budget: KES ${Number(budget).toLocaleString()}\n\n` +
        `Searching properties... 🔍`;

      response.searchProperties = true;
      response.interest = interest;
      response.location = location;
      return response;
    }

    // ============================================
    // STAGE 8: PROPERTY SELECTION
    // ============================================
    if (stage === 'completed') {
      let propertyNumber = null;
      if (message.match(/property\s*(\d+)/i)) propertyNumber = parseInt(message.match(/property\s*(\d+)/i)[1]);
      else if (message.match(/^(\d+)$/)) propertyNumber = parseInt(message);

      if (!propertyNumber) {
        response.action = 'invalid';
        response.replyMessage = `Reply with the property number to book a viewing.\n\nExample: *Property1* or just *1*`;
        return response;
      }

      response.action = 'booking';
      response.updateFields = { 'Conversation Stage': 'awaiting_time_slot' };
      response.propertyNumber = propertyNumber;
      response.replyMessage = `Great choice! 🎉\n\nLet me check availability for you...`;
      return response;
    }

    // ============================================
    // STAGE 9: TIME SLOT
    // ============================================
    if (stage === 'awaiting_time_slot') {
      let slotNumber = null;
      if (message.match(/slot\s*(\d+)/i)) slotNumber = parseInt(message.match(/slot\s*(\d+)/i)[1]);
      else if (message.match(/^(\d+)$/)) slotNumber = parseInt(message);

      if (!slotNumber) {
        response.action = 'invalid';
        response.replyMessage = `Please reply with the slot number.\n\nExample: *1*, *2*, *3*`;
        return response;
      }

      response.action = 'create_booking';
      response.selectedTime = slotNumber;
      response.replyMessage = `Creating your booking... ✅`;
      return response;
    }

    // ============================================
    // CANCEL BOOKING
    // ============================================
    if (stage === 'booking_confirmed' && message.match(/cancel/i)) {
      response.action = 'cancel_booking';
      response.replyMessage = `Cancelling your booking... ⏳`;
      return response;
    }

    // ============================================
    // FOLLOWUP RESPONSES
    // ============================================
    if (input.awaiting_followup_response) {
      if (message === '1' || message.includes('interested') || message.includes('yes')) {
        response.action = 'followup_interested';
        response.replyMessage =
          `Excellent! 🎉\n\n` +
          `Our agent will contact you shortly to discuss next steps.\n\n` +
          `Reply HI anytime to search for more properties.`;
        return response;
      }
      if (message === '2' || message.includes('not interested') || message.includes('no')) {
        response.action = 'followup_not_interested';
        response.replyMessage =
          `Thank you for letting us know.\n\n` +
          `If you change your mind, just reply HI anytime. We are always here to help!`;
        return response;
      }
    }

    // ============================================
    // DEFAULT
    // ============================================
    response.action = 'invalid';
    response.replyMessage = `Reply *HI* to start finding your perfect property! 🏡`;
    return response;

  } catch (error) {
    console.error('Error in handleMessage:', error);
    return {
      action: 'error',
      replyMessage: `Sorry, something went wrong. Please reply HI to start over.`
    };
  }
}

module.exports = handleMessage;