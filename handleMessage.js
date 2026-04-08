// handleMessage.js - Smart conversation flow with dynamic suggestions

async function handleMessage(input) {
  try {
    const originalMessage = input.message || "";
    const message = originalMessage.toLowerCase().trim();
    const phone = input.from;

    const leadExists = input.lead_id && input.lead_id.length > 0;
    const stage = input.lead_stage || null;

    // ============================================
    // FOLLOW-UP RESPONSE HANDLER
    // ============================================
    const awaitingFollowUp = input.awaiting_followup_response || false;

    if (leadExists && awaitingFollowUp && (message === '1' || message === '2')) {
      const leadName = input.lead_name || "there";
      const leadPhone = phone;
      const lastViewedProperty = input.last_viewed_property || "a property";

      if (message === '1') {
        return {
          action: "followup_interested",
          updateFields: {
            "Status": "Hot Lead",
            "Conversation Stage": "interested_after_viewing",
            "AwaitingFollowUpResponse": false
          },
          replyMessage:
            `Great news!\n\n` +
            `Our agent will contact you shortly to discuss next steps.\n\n` +
            `Reply HI anytime to search for more properties.`,
          agentMessage:
            `Hot Lead Alert!\n\n` +
            `${leadName} is interested after their viewing.\n\n` +
            `Contact them now: ${leadPhone}\n` +
            `Property viewed: ${lastViewedProperty}`
        };
      } else if (message === '2') {
        return {
          action: "followup_not_interested",
          updateFields: {
            "Status": "Not Interested",
            "Conversation Stage": "not_interested_after_viewing",
            "AwaitingFollowUpResponse": false
          },
          replyMessage:
            `Thank you for your feedback.\n\n` +
            `If you change your mind, just reply HI anytime.\n\n` +
            `We are always here to help.`
        };
      }
    }

    // ============================================
    // RECONSTRUCT LEAD OBJECT
    // ============================================
    const lead = {
      id: input.lead_id,
      Interest: input.lead_interest,
      Budget: input.lead_budget,
      Location: input.lead_location,
      Size: input.lead_size,
      IsOffplan: input.lead_is_offplan,
      CompletionRange: input.lead_completion_range
    };

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
      plotSize: "",
      isOffplan: null,
      completionRange: null
    };

    const botName = input.tenant_bot_name || "PropertyBot";
    const companyName = input.tenant_company_name || "our company";
    const tenantTypes = input.tenant_property_types || "Buy, Rent";

    function formatOptions(types) {
      return types
        .split(',')
        .map((t, index) => `${index + 1} - ${t.trim()}`)
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
        `Hi! Welcome to *${companyName}* 👋\n\n` +
        `I am ${botName}, your property assistant.\n\n` +
        `What are you looking for?\n\n` +
        `${options}\n\n` +
        `Reply with the number or name.`;

      return response;
    }

    // ======================================
    // GREETING - RESTART
    // ======================================
    if (message.match(/^(hi|hello|hey|start|helo|restart)$/)) {
      response.action = "update";
      response.updateFields = {
        "Conversation Stage": "asked_buy_or_rent"
      };

      const options = formatOptions(tenantTypes);

      response.replyMessage =
        `Hi! Welcome back to *${companyName}* 👋\n\n` +
        `I am ${botName}, your property assistant.\n\n` +
        `What are you looking for?\n\n` +
        `${options}\n\n` +
        `Reply with the number or name.`;

      return response;
    }

    // ======================================
    // STAGE 1: PROPERTY TYPE
    // ======================================
    if (stage === "asked_buy_or_rent") {
      const typesList = tenantTypes.split(',').map(t => t.trim());

      const typeMapping = {};
      typesList.forEach((type, index) => {
        typeMapping[(index + 1).toString()] = type;
        typeMapping[type.toLowerCase()] = type;
      });

      const selectedType = typeMapping[message];

      if (!selectedType) {
        const options = formatOptions(tenantTypes);
        response.action = "invalid";
        response.replyMessage =
          `Please choose from the options below:\n\n` +
          `${options}\n\n` +
          `Reply with the number or name.`;
        return response;
      }

      response.action = "update";
      response.updateFields = {
        "Interest": selectedType,
        "Conversation Stage": "asked_name"
      };

      response.replyMessage =
        `Great choice! 👍\n\n` +
        `What is your name?\n\n` +
        `Just type your name.`;
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
        response.replyMessage =
          `I did not quite catch that.\n\n` +
          `Please enter your name.\n\n` +
          `Just your name is enough!`;
        return response;
      }

      name = name.trim()
        .replace(/[^a-zA-Z\s]/g, '')
        .split(/\s+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');

      response.action = "update";
      response.updateFields = {
        "Name": name,
        "Conversation Stage": "asked_offplan"
      };

      response.replyMessage =
        `Nice to meet you, ${name}! 👋\n\n` +
        `Are you looking for a ready property or an off-plan development?\n\n` +
        `1 - Ready (move in immediately)\n` +
        `2 - Off-Plan (under construction)`;
      return response;
    }

    // ======================================
    // STAGE 3: OFF-PLAN OR READY
    // ======================================
    if (stage === "asked_offplan") {
      const isReady = message === '1' ||
        message.toLowerCase().includes('ready')
      const isOffplan = message === '2' ||
        message.toLowerCase().includes('off-plan') ||
        message.toLowerCase().includes('offplan') ||
        message.toLowerCase().includes('off plan')

      if (!isReady && !isOffplan) {
        response.action = "invalid";
        response.replyMessage =
          `Please choose one of the options:\n\n` +
          `1 - Ready (move in immediately)\n` +
          `2 - Off-Plan (under construction)`;
        return response;
      }

      if (isOffplan) {
        response.action = "update";
        response.updateFields = {
          "Conversation Stage": "asked_completion"
        };
        response.isOffplan = true;
        response.replyMessage =
          `When do you need it completed by?\n\n` +
          `1 - By end of 2026\n` +
          `2 - By end of 2027\n` +
          `3 - By end of 2028\n` +
          `4 - 2029 and beyond\n` +
          `5 - Any completion date`;
        return response;
      }

      if (isReady) {
        response.action = "update";
        response.updateFields = {
          "Conversation Stage": "asked_location"
        };
        response.isOffplan = false;
        response.replyMessage =
          `Perfect! Let me check available areas... 🔍`;
        response.action = "fetch_locations";
        response.interest = lead.Interest || input.lead_interest;
        return response;
      }
    }

    // ======================================
    // STAGE 4: COMPLETION DATE (OFF-PLAN ONLY)
    // ======================================
    if (stage === "asked_completion") {
      const validChoices = ['1', '2', '3', '4', '5'];

      if (!validChoices.includes(message)) {
        response.action = "invalid";
        response.replyMessage =
          `Please reply with a number:\n\n` +
          `1 - By end of 2026\n` +
          `2 - By end of 2027\n` +
          `3 - By end of 2028\n` +
          `4 - 2029 and beyond\n` +
          `5 - Any completion date`;
        return response;
      }

      const completionRanges = {
        '1': '2026',
        '2': '2027',
        '3': '2028',
        '4': '2029+',
        '5': 'any'
      };

      response.action = "fetch_locations";
      response.updateFields = {
        "Conversation Stage": "fetching_locations"
      };
      response.isOffplan = true;
      response.completionRange = completionRanges[message];
      response.interest = lead.Interest || input.lead_interest;
      response.replyMessage = `Perfect! Let me check available areas... 🔍`;
      return response;
    }

    // ======================================
    // STAGE 5: LOCATION
    // ======================================
    if (stage === "asked_location") {
      let location = message;

      if (message.match(/in (.+)/i)) {
        location = message.match(/in (.+)/i)[1];
      } else if (message.match(/at (.+)/i)) {
        location = message.match(/at (.+)/i)[1];
      }

      if (!location.match(/[a-zA-Z]{2,}/)) {
        response.action = "invalid";
        response.replyMessage =
          `Please choose a location from the list above.\n\n` +
          `Just type the area name.`;
        return response;
      }

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
      response.replyMessage = `Perfect! 📍\n\nChecking what is available in ${location}... 🔍`;
      return response;
    }

    // ======================================
    // STAGE 6: SIZE / BEDROOMS
    // ======================================
    if (stage === "asked_size") {
      let bedroomsStr = message;
      let bedrooms = null;

      const isStudio = message.match(/stud/i);

      if (isStudio) {
        bedrooms = 0;
      } else {
        if (message.match(/(\d+)\s*bed/i)) {
          bedroomsStr = message.match(/(\d+)\s*bed/i)[1];
        } else if (message.match(/i (want|need) (\d+)/i)) {
          bedroomsStr = message.match(/i (want|need) (\d+)/i)[2];
        } else if (message.match(/^\d+$/)) {
          bedroomsStr = message;
        }
        bedrooms = parseInt(bedroomsStr);
      }

      if (bedrooms === null || (isNaN(bedrooms) && !isStudio) || bedrooms < 0 || bedrooms > 20) {
        response.action = "invalid";
        response.replyMessage =
          `Please enter the number of bedrooms you need.\n\n` +
          `Examples: Studio, 1, 2, 3, 4\n\n` +
          `Just type Studio or the number!`;
        return response;
      }

      const finalInterest = lead.Interest || input.lead_interest || "Not specified";
      const finalLocation = lead.Location || input.lead_location || "Not specified";
      const displaySize = bedrooms === 0 ? 'Studio' : `${bedrooms} bedroom`;

      response.action = "fetch_budget_ranges";
      response.updateFields = {
        "Size": displaySize,
        "Conversation Stage": "fetching_budget_ranges"
      };

      response.interest = finalInterest;
      response.bedrooms = bedrooms;
      response.requestedBedrooms = bedrooms;
      response.location = finalLocation;
      response.replyMessage = `Great choice! Let me check available price ranges... 💰`;
      return response;
    }

    // ======================================
    // STAGE 6B: LAND SIZE
    // ======================================
    if (stage === "asked_land_size") {
      let plotSize = originalMessage.trim();

      if (plotSize.length < 2) {
        response.action = "invalid";
        response.replyMessage =
          `Please enter the plot size you are interested in.\n\n` +
          `Examples: 50x100, 1/4 Acre, 1/8\n\n` +
          `Choose from the options above!`;
        return response;
      }

      const finalInterest = lead.Interest || input.lead_interest || "Land";
      const finalLocation = lead.Location || input.lead_location || "Not specified";

      response.action = "fetch_budget_ranges";
      response.updateFields = {
        "Size": plotSize,
        "Conversation Stage": "fetching_budget_ranges"
      };

      response.interest = finalInterest;
      response.location = finalLocation;
      response.plotSize = plotSize;
      response.replyMessage = `Great! Let me check available price ranges... 💰`;
      return response;
    }

    // ======================================
    // STAGE 7: BUDGET
    // ======================================
    if (stage === "asked_budget") {
      // Parse budget from free text input
      let budget = null;
      const msgLower = message.toLowerCase().trim();

      const budgetPatterns = [
        { pattern: /(\d+\.?\d*)\s*million/i, multiplier: 1000000 },
        { pattern: /(\d+\.?\d*)\s*m\b/i, multiplier: 1000000 },
        { pattern: /(\d+\.?\d*)\s*k\b/i, multiplier: 1000 },
        { pattern: /kes\s*([\d,]+)/i, multiplier: 1 },
        { pattern: /^([\d,]+)$/, multiplier: 1 }
      ];

      for (const { pattern, multiplier } of budgetPatterns) {
        const match = msgLower.match(pattern);
        if (match) {
          const amount = parseFloat(match[1].replace(/,/g, '')) * multiplier;
          if (!isNaN(amount) && amount >= 1000) {
            budget = amount;
            break;
          }
        }
      }

      if (!budget) {
        response.action = "invalid";
        response.replyMessage =
          `Please enter your budget.\n\n` +
          `Examples: 10M, 15M, KES 10,000,000\n\n` +
          `Just type the amount!`;
        return response;
      }

      const finalInterest = lead.Interest || input.lead_interest || "Not specified";
      const finalLocation = lead.Location || input.lead_location || "Not specified";
      const finalSize = lead.Size || input.lead_size || "Not specified";
      const displaySize = finalSize.toLowerCase().includes('studio') ? 'Studio' : finalSize;

      response.action = "update";
      response.updateFields = {
        "Budget": budget.toString(),
        "Conversation Stage": "completed",
        "Status": "Contacted"
      };

      response.interest = finalInterest;
      response.location = finalLocation;
      response.searchProperties = true;

      response.replyMessage =
        `✅ Got it! Let me find the best matches for you...\n\n` +
        `📋 Your preferences:\n` +
        `• Type: ${finalInterest}\n` +
        `• Location: ${finalLocation}\n` +
        `• Size: ${displaySize}\n` +
        `• Budget: KES ${Number(budget).toLocaleString()}\n\n` +
        `Searching properties... 🔍`;

      return response;
    }
    
    // ======================================
    // STAGE 8: PROPERTY SELECTION / BOOKING
    // ======================================
    if (stage === "completed") {
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
        response.replyMessage =
          `Please reply with the property number you want to view.\n\n` +
          `Example: Property1 or just 1`;
        return response;
      }

      response.action = "booking";
      response.updateFields = {
        "Conversation Stage": "awaiting_time_slot",
        "Selected Property Number": propertyNumber
      };
      response.propertyNumber = propertyNumber;
      response.replyMessage =
        `Great choice! 🎉\n\nLet me check availability for you... ⏳`;
      return response;
    }

    // ======================================
    // STAGE 9: TIME SLOT SELECTION
    // ======================================
    if (stage === "awaiting_time_slot") {
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
          `Please reply with the slot number.\n\n` +
          `Example: 3 or Slot 3`;
        return response;
      }

      response.action = "create_booking";
      response.updateFields = {
        "Conversation Stage": "booking_confirmed",
        "Selected Time Slot": slotNumber
      };
      response.selectedTime = slotNumber;
      response.bookingRequest = true;
      response.replyMessage = `Creating your booking... ✅`;
      return response;
    }

    // ======================================
    // CANCEL BOOKING
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
    // DEFAULT CATCH-ALL
    // ======================================
    response.action = "invalid";
    response.replyMessage = getHelpMessage(stage);
    return response;

    function getHelpMessage(currentStage) {
      switch (currentStage) {
        case "asked_buy_or_rent":
          return `Please choose what you are looking for:\n\n1 - Buy\n2 - Rent\n3 - Land\n\nReply with the number.`;
        case "asked_name":
          return `Please enter your name.\n\nJust your first name or full name.`;
        case "asked_offplan":
          return `Please choose:\n\n1 - Ready (move in immediately)\n2 - Off-Plan (under construction)`;
        case "asked_completion":
          return `Please choose a completion timeline:\n\n1 - By end of 2026\n2 - By end of 2027\n3 - By end of 2028\n4 - 2029 and beyond\n5 - Any completion date`;
        case "asked_location":
          return `Please choose a location from the list above.`;
        case "asked_size":
          return `Please enter the number of bedrooms.\n\nExamples: Studio, 1, 2, 3`;
        case "asked_land_size":
          return `Please enter the plot size.\n\nExamples: 50x100, 1/4 Acre, 1/8`;
        case "asked_budget":
          return `Please reply with a number from the budget options above.`;
        case "awaiting_time_slot":
          return `Please reply with the slot number.\n\nExample: 1, 2, 3`;
        case "booking_confirmed":
          return `Your viewing is confirmed! Reply CANCEL to cancel, or HI to start over.`;
        default:
          return `Send HI to start finding your perfect property!`;
      }
    }

  } catch (error) {
    console.error("Error in handleMessage:", error);
    return {
      action: "error",
      replyMessage:
        `Sorry, something went wrong.\n\n` +
        `Please try again or send HI to restart.`
    };
  }
}

module.exports = handleMessage;