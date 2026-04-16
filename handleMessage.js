const supabase = require('./supabase');

function normalize(text) {
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

function extractBedrooms(sizeStr) {
  if (!sizeStr) return null;

  const str = sizeStr.toString().toLowerCase().trim();

  if (str.includes('studio')) return 0;

  const match = str.match(/\d+/);
  return match ? parseInt(match[0]) : null;
}

// helper fuzzy matching function

function levenshtein(a, b) {
  const matrix = [];

  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

function smartMatch(input, options) {
  input = input.toLowerCase().trim();

  let bestMatch = null;
  let bestScore = Infinity;

  for (const option of options) {
    const opt = option.toLowerCase();

    const distance = levenshtein(input, opt);

    if (distance < bestScore) {
      bestScore = distance;
      bestMatch = option;
    }
  }

  return {
    match: bestMatch,
    confidence: bestScore
  };
}

// ============================================
// Helper: Check if properties exist
// ============================================
async function checkPropertyExists(tenantId, filters) {
  try {
    let query = supabase
      .from('properties')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('available', true);

    if (filters.type) {
      query = query.ilike('type', filters.type);
    }

    if (filters.isOffplan !== undefined) {
      query = query.eq('is_offplan', filters.isOffplan);
    }

    const { data } = await query.limit(1);

    return data && data.length > 0;

  } catch (err) {
    console.error('Check property error:', err);
    return false;
  }
}

// handleMessage.js - Enhanced conversation logic with natural language support + Follow-up handler
async function handleMessage(input) {
  try {
    // 1. Get input data
    const originalMessage = input.message || "";
    const message = originalMessage.toLowerCase().trim();
    const phone = input.from;

    // 2. Identify lead and stage
    const leadExists = input.lead_id && input.lead_id.length > 0;
    const stage = input.lead_stage || null;
    
// ============================================
// FOLLOW-UP RESPONSE HANDLER (Route 8)
// ============================================

// Check if lead is awaiting follow-up response
const awaitingFollowUp = input.awaiting_followup_response || false;

if (leadExists && awaitingFollowUp && (message === '1' || message === '2' || message === '3')) {
  console.log('Follow-up response detected!');
  
  const leadName = input.lead_name || "there";
  const leadPhone = phone;
  const tenantWhatsApp = input.tenant_whatsapp || "";
  const lastViewedProperty = input.last_viewed_property || "a property";

  console.log('Last Viewed Property:', lastViewedProperty);

  // ============================================
  // OPTION 1: INTERESTED
  // ============================================
  if (message === '1') {
    return {
      action: "followup_interested",
      updateFields: {
        "Status": "Hot Lead",
        "Conversation Stage": "interested_after_viewing",
        "AwaitingFollowUpResponse": false
      },
      replyMessage: `Great! 🎉\n\nOur agent will contact you shortly to discuss next steps!\n\nReply HI anytime to search for more properties.`
    };
  }

  // ============================================
  // OPTION 2: NOT INTERESTED
  // ============================================
  else if (message === '2') {
    return {
      action: "followup_not_interested",
      updateFields: {
        "Status": "Not Interested",
        "Conversation Stage": "not_interested_after_viewing",
        "AwaitingFollowUpResponse": false
      },
      replyMessage: `Thank you for your feedback! 🙏\n\nIf you change your mind, just reply HI anytime.\n\nWe're always here to help! 🏡`
    };
  }

  // ============================================
  // OPTION 3: ALREADY DECIDED
  // ============================================
  else if (message === '3') {
    return {
      action: "followup_decided",
      updateFields: {
        "AwaitingFollowUpResponse": false
      },
      replyMessage: `Thank you for letting us know 😊\n\nIf you ever need help again, just reply HI anytime. We're always here for you! 🏡`
    };
  }
}
    
    // ============================================
    // END FOLLOW-UP HANDLER - Continue normal flow
    // ============================================

    const lead = {
      id: input.lead_id,
      Interest: input.lead_interest,
      Budget: input.lead_budget,
      Location: input.lead_location,
      Size: input.lead_size,
      location_options: input.lead_location_options || null,
      IsOffplan: input.lead_is_offplan ?? null
    };

    // 4. Response object
    let response = {
      action: "",
      updateFields: {},
      replyMessage: "",
      createLead: false,
      searchProperties: false,
      bookingRequest: false,
      interest: "",
      bedrooms: 0,
      requestedBedrooms: 0,
      propertyNumber: 0,
      location: "",
      selectedTime: "",
      plotSize: ""
    };

    // Tenant configuration
    const botName = input.tenant_bot_name || "PropertyBot";
    const companyName = input.tenant_company_name || "our company";
    const tenantTypes = input.tenant_property_types || "Buy, Rent";

    function formatOptions(types) {
      return types
        .split(',')
        .map((t, index) => `${index + 1}️⃣ ${t.trim()}`)
        .join('\n');
    }

    // ======================================
    // NEW USER - START CONVERSATION
    // ======================================
    if (!leadExists) {
      response.action = "create";
      response.createLead = true;
      response.updateFields = {
        "Conversation Stage": "asked_buy_or_rent",
        "Status": "New",
        "Phone": phone,
        "Tenant": input.tenant_id
      };

      const options = formatOptions(tenantTypes);

      response.replyMessage = 
`Hi! Welcome to ${companyName} 👋

I'm ${botName}, your property assistant.

What are you looking for?

${options}

Reply with the name or number (e.g., Buy or 1).`;

      return response;
    }

    if (message.match(/^(hi|hello|hey|start|helo|restart)$/)) {
      response.action = "update";
      response.updateFields = {
        "Conversation Stage": "asked_buy_or_rent"
      };

      const options = formatOptions(tenantTypes);
      const userName = input.lead_name;

      response.replyMessage = userName
        ? `Welcome back, *${userName}*! 👋\n\nI'm ${botName} from *${companyName}*.\n\nWhat are you looking for today?\n\n${options}\n\nReply with the name or number.`
        : `Hi! Welcome to *${companyName}* 👋\n\nI'm ${botName}, your property assistant.\n\nWhat are you looking for?\n\n${options}\n\nReply with the name or number.`;

      return response;
    }

    async function getBudgetRange(tenantId, interest, location, bedrooms) {
  try {
    const normalizedInterest = normalize(interest);
    const normalizedLocation = normalize(location);

    let query = supabase
      .from('properties')
      .select('price')
      .eq('tenant_id', tenantId)
      .eq('available', true)
      .ilike('type', normalizedInterest)
      .ilike('location', normalizedLocation);

    // ✅ ALWAYS filter bedrooms (including studio = 0)
    if (bedrooms !== null && bedrooms !== undefined) {
      query = query.eq('bedrooms', bedrooms);
    }

    const { data, error } = await query;

    if (error || !data || data.length === 0) {
      return null;
    }

    const prices = data
      .map(p => Number(p.price))
      .filter(p => !isNaN(p));

    if (prices.length === 0) return null;

    const min = Math.min(...prices);
    const max = Math.max(...prices);

    return { min, max };

  } catch (err) {
    console.error('Budget range error:', err);
    return null;
  }
}

    // ======================================
    // STAGE 1: PROPERTY TYPE
    // ======================================
    if (stage === "asked_buy_or_rent") {
      const typesList = tenantTypes.split(',').map(t => t.trim());
      
      // Build mapping: number → type and name → type
      const typeMapping = {};
      typesList.forEach((type, index) => {
        typeMapping[(index + 1).toString()] = type;
        typeMapping[type.toLowerCase()] = type;
      });

      const selectedType = typeMapping[message];

// ======================================
// CHECK IF TYPE EXISTS IN DB
// ======================================
const exists = await checkPropertyExists(input.tenant_id, {
  type: selectedType
});

if (!exists) {
  const agentName = input.agent_name || "Our Agent";
  const agentPhone = input.agent_phone || "N/A";

  response.action = "update";
  response.updateFields = {
    "Conversation Stage": "asked_buy_or_rent"
  };

  response.replyMessage =
    `Currently, we don’t have ${selectedType.toLowerCase()} properties.\n\n` +
    `You can reply HI to explore other options.\n\n` +
    `Or contact our agent:\n` +
    `${agentName}\n${agentPhone}`;

  return response;
}

      if (!selectedType) {
        const options = formatOptions(tenantTypes);
        response.action = "invalid";
        response.replyMessage = `Please choose from the options below:

${options}

Reply with the name or number.`;
        return response;
      }

      const existingName = input.lead_name;

      if (existingName) {
        // Skip name — go straight to locations
        response.action = "fetch_locations";
        response.updateFields = {
          "Interest": selectedType,
          "Conversation Stage": "fetching_locations"
        };
        response.interest = selectedType;
        response.replyMessage = `Great choice! Let me check available areas for you... 🔍`;
      } else {
        response.action = "update";
        response.updateFields = {
          "Interest": selectedType,
          "Conversation Stage": "asked_name"
        };
        response.replyMessage = `Great choice! 👍\n\nWhat's your name?\n\n(Just type your name, e.g., Peter or Mary Jane)`;
      }
      return response;
    }

    // ======================================
    // STAGE 2: NAME
    // ======================================
    if (stage === "asked_name") {
      let name = "";

      if (message.match(/my name is (.+)/i)) {
        name = message.match(/my name is (.+)/i)[1];
      } else if (message.match(/i am (.+)/i)) {
        name = message.match(/i am (.+)/i)[1];
      } else if (message.match(/i'm (.+)/i)) {
        name = message.match(/i'm (.+)/i)[1];
      } else if (message.match(/this is (.+)/i)) {
        name = message.match(/this is (.+)/i)[1];
      } else if (message.match(/^[a-zA-Z]{2,}(\s[a-zA-Z]{2,})*$/)) {
        name = message;
      }

      if (!name || name.length < 2) {
        response.action = "invalid";
        response.replyMessage = `I didn't quite catch that.\n\nPlease enter your name (e.g., John or Mary Jane).\n\nJust your name is enough! 😊`;
        return response;
      }

      name = name.trim()
        .replace(/[^a-zA-Z\s]/g, '')
        .split(/\s+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');

      response.action = "fetch_locations";
      response.updateFields = {
        "Name": name,
        "Conversation Stage": "fetching_locations"
      };
      response.interest = lead.Interest || input.lead_interest;
      response.replyMessage = `Nice to meet you, ${name}! 👋\n\nLet me check available areas... 🔍`;
      return response;
    }
    
    // ======================================
    // STAGE 3: BUDGET (Enhanced - accepts natural language)
    // ======================================
    if (stage === "asked_budget") {
      let budgetStr = message;

      // Extract budget from various formats
      if (message.match(/budget is (.+)/i)) {
        budgetStr = message.match(/budget is (.+)/i)[1];
      } else if (message.match(/i have (.+)/i)) {
        budgetStr = message.match(/i have (.+)/i)[1];
      } else if (message.match(/around (.+)/i)) {
        budgetStr = message.match(/around (.+)/i)[1];
      } else if (message.match(/about (.+)/i)) {
        budgetStr = message.match(/about (.+)/i)[1];
      }

      // Clean: remove everything except numbers, dots, commas, M, K
      budgetStr = budgetStr.replace(/[^0-9.,mkMK]/g, '').toUpperCase();

      // Validate format
      if (!budgetStr.match(/^[\d.,]+[MK]?$/)) {
        response.action = "invalid";
        response.replyMessage = `I didn't understand that budget.

Please enter a valid amount:
• 5000000
• 5M (5 million)
• 500K (500 thousand)

Just the number is fine!`;
        return response;
      }

      // Parse budget
      let budget = budgetStr.replace(/,/g, '');
      if (budget.includes('M')) {
        budget = parseFloat(budget) * 1000000;
      } else if (budget.includes('K')) {
        budget = parseFloat(budget) * 1000;
      } else {
        budget = parseFloat(budget);
      }

      // Get interest from lead record (in case it was set during intent detection)
      const interest = lead.Interest || input.lead_interest;

      response.action = "update";
      response.updateFields = {
        "Budget": budget.toString(),
        "Conversation Stage": "asked_offplan"
      };

      response.replyMessage =
        `Great! 💰\n\n` +
        `Are you looking for a ready property or an off-plan development?\n\n` +
        `1️⃣ Ready (move in immediately)\n` +
        `2️⃣ Off-Plan (under construction)\n\n` +
        'Choose 1 or 2';

      return response;
    }

    // ======================================
    // STAGE 5B: OFFPLAN OR READY
    // ======================================
    if (stage === "asked_offplan") {
      const isReady = message === '1' ||
        message.includes('ready') ||
        message.includes('move in');

      const isOffplan = message === '2' ||
        message.includes('off-plan') ||
        message.includes('offplan') ||
        message.includes('off plan') ||
        message.includes('under construction');

      if (!isReady && !isOffplan) {
        response.action = "invalid";
        response.replyMessage =
          `Please choose one of the options:\n\n` +
          `1️⃣ Ready (move in immediately)\n` +
          `2️⃣ Off-Plan (under construction)`;
        return response;
      }

      if (isReady) {
        // Check if ready properties exist for this tenant
        const readyExists = await checkPropertyExists(input.tenant_id, {
          type: lead.Interest || input.lead_interest,
          isOffplan: false
        });

        if (!readyExists) {
          const agName = input.agent_name || 'Our Agent';
          const agPhone = input.agent_phone || 'N/A';
          response.action = "update";
          response.updateFields = { "Conversation Stage": "asked_offplan" };
          response.replyMessage =
            `We currently don't have ready properties available.\n\n` +
            `We do have off-plan options though!\n\n` +
            `Reply *2* to explore off-plan properties.\n\n` +
            `Or contact our agent:\n` +
            `👤 ${agName}\n` +
            `📞 ${agPhone}`;
          return response;
        }

        response.action = "update";
        response.updateFields = {
          "Conversation Stage": "completed",
          "Status": "Contacted"
        };
        response.isOffplan = false;
        response.searchProperties = true;

        const finalInterest = lead.Interest || input.lead_interest || "Not specified";
        const finalBudget = lead.Budget || input.lead_budget || "Not specified";
        const finalLocation = lead.Location || input.lead_location || "Not specified";
        const finalSize = lead.Size || input.lead_size || "Not specified";
        const displaySize = finalSize.toLowerCase().includes('studio') ? 'Studio' : finalSize;

        response.replyMessage =
          `✅ Got it! Let me find the best matches for you...\n\n` +
          `📋 Your preferences:\n` +
          `• Type: ${finalInterest}\n` +
          `• Location: ${finalLocation}\n` +
          `• Size: ${displaySize}\n` +
          `• Budget: KES ${finalBudget}\n` +
          `• Ready property\n\n` +
          `Searching properties... 🔍`;
        return response;
      }

      if (isOffplan) {
        // Check if offplan properties exist for this tenant
        const offplanExists = await checkPropertyExists(input.tenant_id, {
          type: lead.Interest || input.lead_interest,
          isOffplan: true
        });

        if (!offplanExists) {
          const agName = input.agent_name || 'Our Agent';
          const agPhone = input.agent_phone || 'N/A';
          response.action = "update";
          response.updateFields = { "Conversation Stage": "asked_offplan" };
          response.replyMessage =
            `We currently don't have off-plan properties available.\n\n` +
            `We do have ready properties you can move into now!\n\n` +
            `Reply *1* to explore ready properties.\n\n` +
            `Or contact our agent:\n` +
            `👤 ${agName}\n` +
            `📞 ${agPhone}`;
          return response;
        }

        response.action = "fetch_completion_dates";
        response.updateFields = { "Conversation Stage": "fetching_completion" };
        response.isOffplan = true;
        response.replyMessage = `Great! Let me check available completion dates... 🔍`;
        return response;
      }
    }
    
    // ======================================
    // STAGE 5C: COMPLETION DATE (Off-plan only)
    // ======================================
    if (stage === "asked_completion") {
      let completionInput = originalMessage.trim();
let displayCompletion = completionInput;

// If user typed a number → convert to actual date
if (/^\d+$/.test(completionInput) && input.last_completion_options) {
  try {
    const dates = JSON.parse(input.last_completion_options);
    const index = parseInt(completionInput) - 1;

    if (dates[index]) {
      displayCompletion = dates[index];
    }
  } catch (e) {
    console.error('Error parsing completion dates:', e);
  }
}
      const isNumber = /^\d+$/.test(completionInput);

      if (!completionInput || completionInput.length < 1) {
        response.action = "invalid";
        response.replyMessage = `Please choose a completion date from the options above.`;
        return response;
      }

      const finalInterest = lead.Interest || input.lead_interest || "Not specified";
      const finalBudget = lead.Budget || input.lead_budget || "Not specified";
      const finalLocation = lead.Location || input.lead_location || "Not specified";
      const finalSize = lead.Size || input.lead_size || "Not specified";
      const displaySize = finalSize.toLowerCase().includes('studio') ? 'Studio' : finalSize;

      response.action = "update";
      response.updateFields = {
        "CompletionRange": completionInput,
        "Conversation Stage": "completed",
        "Status": "Contacted"
      };
      response.searchProperties = true;

      response.replyMessage =
        `✅ Got it! Let me find the best matches for you...\n\n` +
        `📋 Your preferences:\n` +
        `• Type: ${finalInterest}\n` +
        `• Location: ${finalLocation}\n` +
        `• Size: ${displaySize}\n` +
        `• Budget: KES ${finalBudget}\n` +
        `• Completion: ${displayCompletion}\n\n` +
        `Searching properties... 🔍`;
      return response;
    }

// ======================================
// STAGE 4: LOCATION (FIXED + BULLETPROOF)
// ======================================
if (stage === "asked_location") {

  let locationOptions = [];

  console.log("RAW MESSAGE:", message);
  console.log("STORED OPTIONS:", lead.location_options);

  // STEP 1: SAFE PARSE STORED OPTIONS
  try {
    if (lead.location_options) {
      locationOptions =
        typeof lead.location_options === "string"
          ? JSON.parse(lead.location_options)
          : lead.location_options;
    }
  } catch (e) {
    console.error("Failed to parse location_options:", e);
    locationOptions = [];
  }

  let location = null;

  // ======================================
  // STEP 2: NUMBER INPUT (PRIMARY LOGIC)
  // ======================================
  const isNumber = /^\d+$/.test(message);

  if (isNumber && locationOptions.length > 0) {
    const index = parseInt(message) - 1;

    console.log("Location selection index:", index);
    console.log("Available locations:", locationOptions);

   if (index >= 0 && index < locationOptions.length) {
      location = locationOptions[index];
    } else {
      response.action = "invalid";
      const optionsList = locationOptions.map((loc, i) => `${i + 1}️⃣ ${loc}`).join('\n');
      response.replyMessage =
        `That number is not in the list. Please choose between 1 and ${locationOptions.length}.\n\n` +
        `${optionsList}\n\n` +
        `Reply with a number (e.g. 1, 2, 3)`;
      return response;
    }
  }

  // ======================================
  // STEP 2B: MULTIPLE NUMBERS DETECTED
  // ======================================
  // User typed something like "1, 3 & 4" or "1 and 3"
  const multipleNumbers = message.match(/\d+/g);
  if (multipleNumbers && multipleNumbers.length > 1 && locationOptions.length > 0) {
    response.action = "invalid";
    const optionsList = locationOptions.map((loc, i) => `${i + 1}️⃣ ${loc}`).join('\n');
    response.replyMessage =
      `Please choose just *one* area at a time. 😊\n\n` +
      `Which area would you like to start with?\n\n` +
      `${optionsList}\n\n` +
      `Reply with one number (e.g. 1, 2, 3)`;
    return response;
  }

 // ======================================
// STEP 3: TEXT INPUT → SMART MATCH
// ======================================
if (!location && locationOptions.length > 0) {

  const { match, confidence } = smartMatch(message, locationOptions);

  // HIGH confidence → accept
  if (confidence <= 1) {
    location = match;
  }

  // MEDIUM confidence → ask user
  else if (confidence === 2) {
    return {
      action: "clarify_location",
      tempMatch: match,
      replyMessage: `Did you mean *${match}*? 📍\n\nReply YES or NO.`
    };
  }

  // LOW confidence → reject
  else {
    const optionsList = locationOptions.map((loc, i) => `${i + 1}️⃣ ${loc}`).join('\n');

    return {
      action: "invalid",
      replyMessage:
        `I didn't quite understand that 🤔\n\n` +
        `Please choose one of these areas:\n\n` +
        `${optionsList}\n\n` +
        `Reply with a number or type the name 😊`
    };
  }
}

  // ======================================
  // STEP 4: FINAL VALIDATION
  // ======================================
  if (!location || location.length < 2) {
    response.action = "invalid";
    response.replyMessage =
      `Please choose a valid location.\n\n` +
      `Reply with the NUMBER (e.g. 1, 2, 3, 4, 5) or type the area name.`;
    return response;
  }

  // ======================================
  // STEP 5: CONTINUE FLOW
  // ======================================
  const interest = lead.Interest || input.lead_interest;

  response.action = "fetch_sizes";
  response.updateFields = {
    Location: location,
    "Conversation Stage": "fetching_sizes"
  };

  response.interest = interest;
  response.location = location;

  response.replyMessage =
    `Perfect! 📍\n\nChecking what's available in ${location}... 🔍`;

  return response;
}

  // ======================================
// STAGE 5: SIZE (HOUSES) - SMART VERSION
// ======================================
if (stage === "asked_size") {

  const options = ["studio", "1", "2", "3", "4"];

  const { match, confidence } = smartMatch(message, options);

  let bedrooms = null;

  // ======================================
  // HIGH CONFIDENCE → ACCEPT
  // ======================================
  if (confidence <= 1) {
    if (match === "studio") bedrooms = 0;
    else bedrooms = parseInt(match);
  }

  // ======================================
  // MEDIUM CONFIDENCE → ASK USER
  // ======================================
  else if (confidence === 2) {
    return {
      action: "clarify_size",
      tempMatch: match,
      replyMessage: `Did you mean *${match === "studio" ? "Studio" : match + " Bedroom"}*? 😊\n\nReply YES or NO.`
    };
  }

  // ======================================
  // LOW CONFIDENCE → REJECT
  // ======================================
  else {
    return {
      action: "invalid",
      replyMessage:
        `I didn't quite understand that 🤔\n\n` +
        `Please choose one of the options:\n\n` +
        `• Studio\n• 1 Bedroom\n• 2 Bedrooms\n• 3 Bedrooms\n\n` +
        `You can type or choose a number 😊`
    };
  }

  // ======================================
  // VALIDATION SAFETY (EXTRA PROTECTION)
  // ======================================
  if (bedrooms === null || isNaN(bedrooms) || bedrooms < 0 || bedrooms > 20) {
    response.action = "invalid";
    response.replyMessage =
      `That doesn't look right. Please choose from the bedroom options shown above.\n\n` +
      `Just type the number (e.g. 1, 2, 3) or *Studio*.`;
    return response;
  }

  // ======================================
  // CLEAN VALUES
  // ======================================
  const finalInterest = lead.Interest || input.lead_interest || "Not specified";
  const finalLocation = lead.Location || input.lead_location || "Not specified";
  const displaySize = bedrooms === 0
    ? 'Studio'
    : `${bedrooms} Bedroom${bedrooms > 1 ? 's' : ''}`;

  // ======================================
  // UPDATE LEAD
  // ======================================
  response.action = "update";
  response.updateFields = {
    "Size": displaySize,
    "Conversation Stage": "asked_budget"
  };

  response.bedrooms = bedrooms;

  // ======================================
  // GET BUDGET RANGE
  // ======================================
  let budgetRange = null;

  try {
    budgetRange = await getBudgetRange(
      input.tenant_id,
      finalInterest,
      finalLocation,
      bedrooms
    );
  } catch (err) {
    console.error("Error fetching budget range:", err);
  }

  // ======================================
  // RESPONSE MESSAGE
  // ======================================
  if (budgetRange && budgetRange.min && budgetRange.max) {
    response.replyMessage =
      `Based on your selection:\n` +
      `${finalLocation} • ${displaySize} • ${finalInterest}\n\n` +
      `Available price range:\n` +
      `💰 KES ${budgetRange.min.toLocaleString()} – KES ${budgetRange.max.toLocaleString()}\n\n` +
      `What is your budget within this range?\n\n` +
      `Just type your price.\nEg:\n• 50000\n• 10M\n• 500k`;
  } else {
    response.replyMessage =
      `Perfect! What is your budget in Ksh?\n\n` +
      `Examples:\n• 50000\n• 10M\n• 500k\n\n` +
      `Just type the amount!`;
  }

  return response;
}

// ======================================
// STAGE 5B: LAND SIZE SELECTION (UNCHANGED)
// ======================================
if (stage === "asked_land_size") {

  let plotSize = originalMessage.trim();

  if (message.match(/(\d+x\d+|\d+\/\d+|\d+\s*acre)/i)) {
    // valid
  } else if (message.match(/i (want|need) (.+)/i)) {
    plotSize = message.match(/i (want|need) (.+)/i)[2];
  }

  if (plotSize.length < 2) {
    response.action = "invalid";
    response.replyMessage = `Please enter the plot size you're interested in.

Examples:
• 50x100
• 1/4 Acre
• 1/8

Choose from the options above!`;
    return response;
  }

  const finalInterest = lead.Interest || input.lead_interest || "Land";
  const finalBudget = lead.Budget || input.lead_budget || "Not specified";
  const finalLocation = lead.Location || input.lead_location || "Not specified";

  response.action = "update";
  response.updateFields = {
    "Size": plotSize,
    "Conversation Stage": "completed",
    "Status": "Contacted"
  };

  response.interest = finalInterest;
  response.location = finalLocation;
  response.plotSize = plotSize;
  response.searchProperties = true;

  response.replyMessage = `✅ Got it! Let me find the best land matches for you...

📋 Your preferences:
• Interest: ${finalInterest}
• Budget: KES ${finalBudget}
• Location: ${finalLocation}
• Plot Size: ${plotSize}

Searching properties... 🔍`;

  return response;
}

    // ======================================
    // STAGE 7: BOOKING REQUEST
    // ======================================
    if (stage === "completed") {
      // Accept various property selection formats
      let propertyNumber = null;

      if (message.match(/property\s*(\d+)/i)) {
        propertyNumber = parseInt(message.match(/property\s*(\d+)/i)[1]);
      } else if (message.match(/^(\d+)$/)) {
        propertyNumber = parseInt(message);
      } else if (message.match(/number\s*(\d+)/i)) {
        propertyNumber = parseInt(message.match(/number\s*(\d+)/i)[1]);
      }

      if (!propertyNumber) {
        response.action = "invalid";
        response.replyMessage = `Please reply with the property number you want to view.

Example: Property1 or just 1`;
        return response;
      }

      response.action = "booking";
      response.updateFields = {
        "Conversation Stage": "awaiting_time_slot",
        "Selected Property Number": propertyNumber
      };
      response.propertyNumber = propertyNumber;
      response.replyMessage = `Great choice! 🎉\n\nLet me check availability for you... ⏳`;

      return response;
    }

    // ======================================
    // STAGE 8: TIME SLOT
    // ======================================
    if (stage === "awaiting_time_slot") {
      // Extract slot number
      let slotNumber = null;

      if (message.match(/slot\s*(\d+)/i)) {
        slotNumber = parseInt(message.match(/slot\s*(\d+)/i)[1]);
      } else if (message.match(/^(\d+)$/)) {
        slotNumber = parseInt(message);
      } else if (message.match(/number\s*(\d+)/i)) {
        slotNumber = parseInt(message.match(/number\s*(\d+)/i)[1]);
      }

      if (!slotNumber) {
        response.action = "invalid";
        response.replyMessage =
          `Please reply with just the slot number.\n\n` +
          `Example: *1*, *2*, *3*\n\n` +
          `Check the list above and pick a number.`;
        return response;
      }

      response.action = "create_booking";
      response.updateFields = {
        "Conversation Stage": "booking_confirmed",
        "Selected Time Slot": slotNumber
      };
      response.selectedTime = slotNumber;
      response.bookingRequest = true;
      response.replyMessage = "Creating your booking... ✅";

      return response;
    }

    // ======================================
    // CANCEL
    // ======================================
    if (stage === "booking_confirmed" && message.match(/cancel/i)) {
      response.action = "cancel_booking";
      response.updateFields = {
        "Conversation Stage": "booking_cancelled",
        "Status": "Cancelled"
      };
      response.replyMessage = "Cancelling your booking... ⏳";
      return response;
    }


    // ======================================
    // DEFAULT (Catch-all for unexpected input)
    // ======================================
    response.action = "invalid";
    response.replyMessage = getHelpMessage(stage, tenantTypes);
    return response;

    // Helper function INSIDE handleMessage
    function getHelpMessage(currentStage) {
      switch(currentStage) {
        case "asked_buy_or_rent":
          return (
            `Please choose what you are looking for:\n\n` +
            `${formatOptions(tenantTypes)}\n\n` +
            `Reply with the name or number.`
          );
        case "asked_name":
          return (
            `Please enter your name.\n\n` +
            `Just your first name or full name.\n` +
            `Example: *John* or *Mary Jane*`
          );
        case "asked_budget":
          return (
            `Please enter your budget.\n\n` +
            `Examples:\n` +
            `• *5M* (5 million)\n` +
            `• *10M* (10 million)\n` +
            `• *KES 5,000,000*\n\n` +
            `Just type the amount.`
          );
        case "asked_location":
          return (
            `Please choose a location from the list above.\n\n` +
            `Reply with the number (e.g. *1*, *2*, *3*).`
          );
        case "asked_offplan":
          return (
            `Please choose one of the options:\n\n` +
            `1️⃣ Ready (move in immediately)\n` +
            `2️⃣ Off-Plan (under construction)\n\n` +
            `Reply with *1* or *2*.`
          );
        case "asked_completion":
          return (
            `Please choose a completion date from the options above.\n\n` +
            `Reply with the number (e.g. *1*, *2*) or type the date.`
          );
        case "asked_size":
          return (
            `Please choose the number of bedrooms from the options above.\n\n` +
            `Reply with a number (e.g. *1*, *2*, *3*) or type *Studio*.`
          );
        case "asked_land_size":
          return (
            `Please choose a plot size from the options above.\n\n` +
            `Just type the size (e.g. *50x100*, *1/4 Acre*).`
          );
        case "awaiting_time_slot":
          return (
            `Please choose a slot from the list above.\n\n` +
            `Reply with the slot number (e.g. *1*, *2*, *3*).`
          );
        case "booking_confirmed":
          return (
            `Your viewing is confirmed! ✅\n\n` +
            `Reply *CANCEL* to cancel your booking.`
          );
        default:
          return (
            `Please reply with one of the options shown above.`
          );
      }
    }
  } catch (error) {
    console.error("Error in handleMessage:", error);
    return {
      action: "error",
      replyMessage: "Oops! Something went wrong. Please try again or send HI to restart."
    };
  }
}

module.exports = handleMessage;