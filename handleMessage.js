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
    
    if (leadExists && awaitingFollowUp && (message === '1' || message === '2')) {
      console.log('Follow-up response detected!');
      
      const leadName = input.lead_name || "there";
      const leadPhone = phone;
      const tenantWhatsApp = input.tenant_whatsapp || "";
      const lastViewedProperty = input.last_viewed_property || "a property"; // Property name from last booking
      
      console.log('Last Viewed Property:', lastViewedProperty);
      
      if (message === '1') {
        // User is INTERESTED!
        return {
          action: "followup_interested",
          updateFields: {
            "Status": "Hot Lead",
            "Conversation Stage": "interested_after_viewing",
            "AwaitingFollowUpResponse": false
          },
          replyMessage: `Great! 🎉\n\nOur agent will contact you shortly to discuss next steps!\n\nReply HI anytime to search for more properties.`,
          agentNotification: {
            message: `🔥 *HOT LEAD ALERT!*\n\n${leadName} is INTERESTED after viewing!\n\nProperty: ${lastViewedProperty}\n\n📞 Contact them ASAP: ${leadPhone}\n\nStrike while the iron is hot! 🎯`,
            sendTo: tenantWhatsApp,
            leadName: leadName,
            leadPhone: leadPhone,
            propertyName: lastViewedProperty
          }
        };
      } else if (message === '2') {
        // User is NOT interested
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
    }
    
    // ============================================
    // END FOLLOW-UP HANDLER - Continue normal flow
    // ============================================

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
    // NEW USER - SMART WELCOME WITH CONTEXT DETECTION
    // ======================================
    if (!leadExists) {
      // Try to detect intent from first message
      const lowerMsg = originalMessage.toLowerCase();
      
      // Check if they mentioned property type
      let detectedType = null;
      const typesList = tenantTypes.split(',').map(t => t.trim());
      
      for (const type of typesList) {
        if (lowerMsg.includes(type.toLowerCase())) {
          detectedType = type;
          break;
        }
      }
      
      // Check for buying keywords
      if (!detectedType && (lowerMsg.includes('buy') || lowerMsg.includes('purchase') || lowerMsg.includes('invest'))) {
        detectedType = typesList.find(t => t.toLowerCase().includes('buy'));
      }
      
      // Check for renting keywords  
      if (!detectedType && (lowerMsg.includes('rent') || lowerMsg.includes('lease'))) {
        detectedType = typesList.find(t => t.toLowerCase().includes('rent'));
      }
      
      // Check for land keywords
      if (!detectedType && (lowerMsg.includes('land') || lowerMsg.includes('plot') || lowerMsg.includes('acre'))) {
        detectedType = typesList.find(t => t.toLowerCase().includes('land'));
      }
      
      // If we detected their intent, skip straight to asking name
      if (detectedType) {
        response.action = "create";
        response.createLead = true;
        response.interest = detectedType; // ← ADDED: Store for later use
        response.updateFields = {
          "Interest": detectedType,
          "Conversation Stage": "asked_name",
          "Status": "New",
          "Phone": phone,
          "Tenant": input.tenant_id
        };
        
        response.replyMessage = 
`Hi! Welcome to ${companyName} 👋

I see you're interested in ${detectedType}. Great choice!

What's your name?

(Just type your name, e.g., Peter or Mary Jane)`;
        
        return response;
      }
      
      // Otherwise, ask what they're looking for
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

    // ======================================
    // GREETING (RESTART FOR EXISTING USERS)
    // ======================================
    if (message.match(/^(hi|hello|hey|start|helo|restart)$/)) {
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

Reply with the name or number (e.g., Rent or 2).`;

      return response;
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

      if (!selectedType) {
        const options = formatOptions(tenantTypes);
        response.action = "invalid";
        response.replyMessage = `Please choose from the options below:

${options}

Reply with the name or number.`;
        return response;
      }

      response.action = "update";
      response.updateFields = {
        "Interest": selectedType,
        "Conversation Stage": "asked_name"
      };

      response.replyMessage = `Great choice! 👍

What's your name?

(Just type your name, e.g., Peter or Mary Jane)`;
      return response;
    }

    // ======================================
    // STAGE 2: NAME (Enhanced - accepts natural language)
    // ======================================
    if (stage === "asked_name") {
      let name = "";

      // Try to extract name from various formats
      if (message.match(/my name is (.+)/i)) {
        name = message.match(/my name is (.+)/i)[1];
      } else if (message.match(/i am (.+)/i)) {
        name = message.match(/i am (.+)/i)[1];
      } else if (message.match(/i'm (.+)/i)) {
        name = message.match(/i'm (.+)/i)[1];
      } else if (message.match(/this is (.+)/i)) {
        name = message.match(/this is (.+)/i)[1];
      } else if (message.match(/^[a-zA-Z]{2,}(\s[a-zA-Z]{2,})*$/)) {
        name = message; // Direct name input
      }

      // Validate extracted name
      if (!name || name.length < 2) {
        response.action = "invalid";
        response.replyMessage = `I didn't quite catch that.

Please enter your name (e.g., John or Mary Jane).

Just your name is enough! 😊`;
        return response;
      }

      // Clean and capitalize
      name = name.trim()
        .replace(/[^a-zA-Z\s]/g, '') // Remove special characters
        .split(/\s+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');

      response.action = "update";
      response.updateFields = {
        "Name": name,
        "Conversation Stage": "asked_budget"
      };
      
      response.replyMessage = `Nice to meet you, ${name}! 👋

What's your budget?

Examples:
• 500000
• 5M 
• 500K 

Just type the amount!`;
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

      response.action = "fetch_locations";
      response.updateFields = {
        "Budget": budget.toString(),
        "Conversation Stage": "fetching_locations"
      };

      response.interest = interest; // ← Pass the interest along!
      response.replyMessage = "Great! 💰\n\nLet me check available areas... 🔍";

      return response;
    }

    // ======================================
    // STAGE 4: LOCATION (Triggers size fetch)
    // ======================================
    if (stage === "asked_location") {
      // Accept location in various formats
      let location = message;

      // Clean up common prefixes
      if (message.match(/in (.+)/i)) {
        location = message.match(/in (.+)/i)[1];
      } else if (message.match(/at (.+)/i)) {
        location = message.match(/at (.+)/i)[1];
      }

      // Validate it's mostly letters
      if (!location.match(/[a-zA-Z]{2,}/)) {
        response.action = "invalid";
        response.replyMessage = `Please choose a location from the list above.

Just type the area name (e.g., Westlands or Karen).`;
        return response;
      }

      // Capitalize properly
      location = location.trim()
        .split(/\s+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
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
    if (stage === "asked_size") {
      // Extract number of bedrooms
      let bedroomsStr = message;

      // Handle various formats
      if (message.match(/(\d+)\s*bed/i)) {
        bedroomsStr = message.match(/(\d+)\s*bed/i)[1];
      } else if (message.match(/i (want|need) (\d+)/i)) {
        bedroomsStr = message.match(/i (want|need) (\d+)/i)[2];
      } else if (message.match(/^\d+$/)) {
        bedroomsStr = message;
      }

      const bedrooms = parseInt(bedroomsStr);

      if (isNaN(bedrooms) || bedrooms < 1 || bedrooms > 20) {
        response.action = "invalid";
        response.replyMessage = `Please enter the number of bedrooms you need.

Examples: 1, 2, 3, 4, etc.

Just the number!`;
        return response;
      }

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
      response.bedrooms = bedrooms;
      response.requestedBedrooms = bedrooms;
      response.location = finalLocation;
      response.searchProperties = true;

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
      // Clean plot size input
      let plotSize = originalMessage.trim(); // Keep original case for plot sizes like "1/4 Acre"

      // Extract from various formats
      if (message.match(/(\d+x\d+|\d+\/\d+|\d+\s*acre)/i)) {
        // Already in good format
      } else if (message.match(/i (want|need) (.+)/i)) {
        plotSize = message.match(/i (want|need) (.+)/i)[2];
      }

      // Basic validation
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
        response.replyMessage = `Please reply with the slot number.

Example: 3 or Slot 3`;
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
    response.replyMessage = getHelpMessage(stage);
    return response;

    function getHelpMessage(currentStage) {
      switch(currentStage) {
        case "asked_buy_or_rent": 
          return `Please choose from the options:

1️⃣ Buy
2️⃣ Rent
3️⃣ Land

Reply with the name or number.`;
        
        case "asked_name": 
          return `Please enter your name.

Just your first name or full name (e.g., John or Mary Jane).`;
        
        case "asked_budget": 
          return `Please enter your budget.

Examples:
• 5000000
• 5M (5 million)
• 500K (500 thousand)`;
        
        case "asked_location": 
          return "Please choose a location from the list above.";
        
        case "asked_size": 
          return "Please enter the number of bedrooms (e.g., 1, 2, 3).";
        
        case "asked_land_size": 
          return `Please enter the plot size.

Examples: 50x100, 1/4 Acre, 1/8`;
        
        case "awaiting_time_slot": 
          return "Please reply with the slot number (e.g., 1, 2, 3).";
        
        case "booking_confirmed":
          return "Your viewing is confirmed! Reply CANCEL to cancel, or HI to start over.";
        
        default: 
          return "Hi! Send 'HI' to start finding your perfect property! 🏡";
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