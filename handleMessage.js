// handleMessage.js

async function handleMessage(input) {
  try {
    // 1. Get input data
    const message = (input.message || "").toLowerCase().trim();
    const phone = input.from;

    // 2. Identify lead and stage
    const leadExists = input.lead_id && input.lead_id.length > 0;
    const stage = input.lead_stage || null;

    // 3. Reconstruct lead object
    const lead = {
      id: input.lead_id,
      Interest: input.lead_interest,
      Budget: input.lead_budget,
      Location: input.lead_location,
      Size: input.lead_size
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

    const botName = input.tenant_bot_name || "PropertyBot";
    const companyName = input.tenant_company_name || "our company";
    const tenantTypes = input.tenant_property_types || "Buy, Rent";

    function formatOptions(types) {
      return types
        .split(',')
        .map(t => `• ${t.trim()}`)
        .join('\n');
    }

    // ======================================
    // NEW USER
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

Reply with your choice.`;

      return response;
    }

    // ======================================
    // GREETING
    // ======================================
    if (message.match(/^(hi|hello|hey|start|helo)$/)) {
      response.action = "update";
      response.updateFields = {
        "Conversation Stage": "asked_buy_or_rent"
      };

      const options = formatOptions(tenantTypes);

      response.replyMessage = 
`Hi! Welcome back to ${companyName} 👋

I'm ${botName}, your property assistant.

What are you looking for?

${options}

Reply with your choice.`;

      return response;
    }

    // ======================================
    // STAGE 1: PROPERTY TYPE
    // ======================================
    if (stage === "asked_buy_or_rent") {
      const types = tenantTypes.split(',').map(t => t.trim().toLowerCase());

      if (!types.includes(message)) {
        response.action = "invalid";
        response.replyMessage = "Please choose one of the listed options.";
        return response;
      }

      const interest = message.charAt(0).toUpperCase() + message.slice(1);

      response.action = "update";
      response.updateFields = {
        "Interest": interest,
        "Conversation Stage": "asked_name"
      };

      response.replyMessage = "Great choice! 👍\n\nWhat's your name?";
      return response;
    }

    // ======================================
    // STAGE 2: NAME
    // ======================================
    if (stage === "asked_name" && message.match(/^[a-zA-Z]{2,}(\s[a-zA-Z]{2,})?$/)) {
      const name = message.split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

      response.action = "update";
      response.updateFields = {
        "Name": name,
        "Conversation Stage": "asked_budget"
      };
      response.replyMessage = `Nice to meet you, ${name}! 👋\n\nWhat's your budget?\n\nExample: 5000000 or 5M`;
      return response;
    }

    // ======================================
    // STAGE 3: BUDGET (Triggers location fetch)
    // ======================================
    if (stage === "asked_budget" && message.match(/^\s*[\d.,]+[mMkK]?\s*$/)) {
      let budget = message.replace(/,/g, '').toUpperCase();
      if (budget.includes('M')) {
        budget = parseFloat(budget) * 1000000;
      } else if (budget.includes('K')) {
        budget = parseFloat(budget) * 1000;
      } else {
        budget = parseFloat(budget);
      }

      const interest = lead.Interest || input.lead_interest;

      response.action = "fetch_locations";
      response.updateFields = {
        "Budget": budget.toString(),
        "Conversation Stage": "fetching_locations"
      };

      response.interest = interest;
      response.replyMessage = "Great! 💰\n\nLet me check available areas... 🔍";

      return response;
    }

    // ======================================
    // STAGE 4: LOCATION (Triggers size fetch)
    // ======================================
    if (stage === "asked_location" && message.match(/^[a-zA-Z\s]{3,}$/)) {
      const location = message.split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

      const interest = lead.Interest || input.lead_interest;

      response.action = "fetch_sizes";
      response.updateFields = {
        "Location": location,
        "Conversation Stage": "fetching_sizes"
      };
      
      response.interest = interest;
      response.location = location;
      
      response.replyMessage = `Perfect! 📍\n\nChecking what's available in ${location}... 🔍`;

      return response;
    }

    // ======================================
    // STAGE 5: SIZE (HOUSES)
    // ======================================
    if (stage === "asked_size" && message.match(/^\s*\d+\s*$/)) {
      const bedrooms = message.trim();

      const finalInterest = lead.Interest || input.lead_interest || "Not specified";
      const finalBudget = lead.Budget || input.lead_budget || "Not specified";
      const finalLocation = lead.Location || input.lead_location || "Not specified";

      response.action = "update";
      response.updateFields = {
        "Size": `${bedrooms} bedroom`,
        "Conversation Stage": "completed",
        "Status": "Contacted"
      };

      response.interest = finalInterest;
      response.bedrooms = parseInt(bedrooms);
      response.requestedBedrooms = parseInt(bedrooms);
      response.location = finalLocation;
      response.searchProperties = true; // keeps your search HTTP in Make intact

      response.replyMessage = `✅ Got it! Let me find the best matches for you...

📋 Your preferences:
• Interest: ${finalInterest}
• Budget: KES ${finalBudget}
• Location: ${finalLocation}
• Bedrooms: ${bedrooms}

Searching properties... 🔍`;

      return response;
    }

    // ======================================
    // STAGE 5B: LAND SIZE SELECTION
    // ======================================
    if (stage === "asked_land_size") {
      const plotSize = message.trim();

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
    if (stage === "completed" && message.match(/^property\s*\d+$/i)) {
      const propertyNumber = parseInt(message.match(/\d+/)[0]);

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
    if (stage === "awaiting_time_slot" && message.match(/^\d+$/)) {
      const timeSlotNumber = parseInt(message);

      response.action = "create_booking";
      response.updateFields = {
        "Conversation Stage": "booking_confirmed",
        "Selected Time Slot": timeSlotNumber
      };
      response.selectedTime = timeSlotNumber;
      response.bookingRequest = true;
      response.replyMessage = "Creating your booking... ✅";

      return response;
    }

    // ======================================
    // CANCEL
    // ======================================
    if (message === "cancel" && stage === "booking_confirmed") {
      response.action = "cancel_booking";
      response.updateFields = {
        "Conversation Stage": "booking_cancelled",
        "Status": "Cancelled"
      };
      response.replyMessage = "Cancelling your booking... ⏳";
      return response;
    }

    // ======================================
    // DEFAULT
    // ======================================
    response.action = "invalid";
    response.replyMessage = getHelpMessage(stage);
    return response;

    function getHelpMessage(currentStage) {
      switch(currentStage) {
        case "asked_buy_or_rent": return "Please reply with one of the listed options.";
        case "asked_name": return "Please enter your name (letters only).";
        case "asked_budget": return "Please enter a valid budget (e.g., 5000000 or 5M).";
        case "asked_location": return "Please enter a location from the list above.";
        case "asked_size": return "Please enter the number of bedrooms (e.g., 1, 2, 3).";
        case "asked_land_size": return "Please enter the plot size you are interested in (e.g., 50x100, 1/8 Acre).";
        case "awaiting_time_slot": return "Please reply with a slot number.";
        default: return "Hi! Send 'hi' to start.";
      }
    }

  } catch (error) {
    console.error("Error in handleMessage:", error);
    return {
      action: "error",
      replyMessage: "Oops! Something went wrong. Please try again later."
    };
  }
}

module.exports = handleMessage;
