const Anthropic = require('@anthropic-ai/sdk');
const supabase = require('./supabase');

// Initialize client inside function to ensure env vars are loaded
function getAnthropicClient() {
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
  });
}

// ============================================
// Fetch available options from database
// for this specific tenant
// ============================================
async function fetchTenantOptions(tenantId, interest, location) {
  try {
    const options = {};

    // Get available property types
    const { data: typeData } = await supabase
      .from('properties')
      .select('type')
      .eq('tenant_id', tenantId)
      .eq('available', true);

    if (typeData) {
      options.availableTypes = [...new Set(typeData.map(r => r.type).filter(Boolean))];
    }

    // Get available locations for selected interest
    if (interest) {
      const { data: locData } = await supabase
        .from('properties')
        .select('location')
        .eq('tenant_id', tenantId)
        .eq('available', true)
        .ilike('type', interest);

      if (locData) {
        options.availableLocations = [...new Set(locData.map(r => r.location).filter(Boolean))].sort();
      }
    }

    // Get available bedrooms for selected interest and location
    if (interest && location) {
      const { data: bedData } = await supabase
        .from('properties')
        .select('bedrooms, plot_size')
        .eq('tenant_id', tenantId)
        .eq('available', true)
        .ilike('type', interest)
        .ilike('location', location);

      if (bedData) {
        const beds = [...new Set(bedData.map(r => r.bedrooms).filter(b => b !== null))].sort((a, b) => a - b);
        options.availableBedrooms = beds.map(b => b === 0 ? 'Studio' : `${b} Bedroom${b > 1 ? 's' : ''}`);

        const plots = [...new Set(bedData.map(r => r.plot_size).filter(Boolean))];
        if (plots.length > 0) options.availablePlotSizes = plots;
      }

      // Get price ranges
      const { data: priceData } = await supabase
        .from('properties')
        .select('price')
        .eq('tenant_id', tenantId)
        .eq('available', true)
        .ilike('type', interest)
        .ilike('location', location)
        .not('price', 'is', null);

      if (priceData && priceData.length > 0) {
        const prices = priceData.map(r => r.price).filter(p => p > 0).sort((a, b) => a - b);
        options.priceRange = {
          min: prices[0],
          max: prices[prices.length - 1],
          minFormatted: `KES ${Number(prices[0]).toLocaleString()}`,
          maxFormatted: `KES ${Number(prices[prices.length - 1]).toLocaleString()}`
        };
      }

      // Get completion dates for offplan
      const { data: dateData } = await supabase
        .from('properties')
        .select('completion_date')
        .eq('tenant_id', tenantId)
        .eq('available', true)
        .eq('is_offplan', true)
        .ilike('type', interest)
        .ilike('location', location)
        .not('completion_date', 'is', null);

      if (dateData && dateData.length > 0) {
        options.completionDates = [...new Set(dateData.map(r => r.completion_date).filter(Boolean))];
      }
    }

    return options;
  } catch (error) {
    console.error('Error fetching tenant options:', error);
    return {};
  }
}

// ============================================
// Main AI conversation function
// ============================================
async function processAIConversation(params) {
  const {
    userMessage,
    lead,
    tenant,
    conversationHistory,
    agentName,
    agentPhone
  } = params;

  try {
    // Fetch available options dynamically from database
    const options = await fetchTenantOptions(
      tenant.id,
      lead?.interest || null,
      lead?.location || null
    );

    // Build what we already know about the lead
    const knownInfo = [];
    if (lead?.name) knownInfo.push(`Name: ${lead.name}`);
    if (lead?.interest) knownInfo.push(`Property Type: ${lead.interest}`);
    if (lead?.location) knownInfo.push(`Location: ${lead.location}`);
    if (lead?.size) knownInfo.push(`Size: ${lead.size}`);
    if (lead?.budget) knownInfo.push(`Budget: KES ${Number(lead.budget).toLocaleString()}`);
    if (lead?.is_offplan !== null && lead?.is_offplan !== undefined) {
      knownInfo.push(`Property Status: ${lead.is_offplan ? 'Off-Plan' : 'Ready'}`);
    }
    if (lead?.completion_range) knownInfo.push(`Completion: ${lead.completion_range}`);

    // Build the system prompt
    const systemPrompt = `You are a smart, friendly and professional real estate assistant for ${tenant.company_name}.
Your name is ${tenant.bot_name || 'PropertyBot'}.

Your job is to help users find their perfect property through natural conversation.
You must feel like a knowledgeable human agent, not a bot.
Keep responses short, clear, and under 80 words. Be conversational and direct.

AVAILABLE PROPERTY DATA IN OUR DATABASE:
${options.availableTypes?.length > 0 ? `Property Types: ${options.availableTypes.join(', ')}` : ''}
${options.availableLocations?.length > 0 ? `Available Locations: ${options.availableLocations.join(', ')}` : ''}
${options.availableBedrooms?.length > 0 ? `Available Sizes: ${options.availableBedrooms.join(', ')}` : ''}
${options.availablePlotSizes?.length > 0 ? `Available Plot Sizes: ${options.availablePlotSizes.join(', ')}` : ''}
${options.priceRange ? `Price Range: ${options.priceRange.minFormatted} to ${options.priceRange.maxFormatted}` : ''}
${options.completionDates?.length > 0 ? `Off-Plan Completion Dates: ${options.completionDates.join(', ')}` : ''}

WHAT WE ALREADY KNOW ABOUT THIS USER:
${knownInfo.length > 0 ? knownInfo.join('\n') : 'Nothing yet - this is a new conversation'}

AGENT CONTACT (use when no properties found or user needs human help):
Agent: ${agentName || 'Our Agent'}
Phone: ${agentPhone || 'N/A'}

YOUR CONVERSATION RULES:
1. Be warm, natural and conversational. Never sound like a menu system.
2. Extract information naturally from what the user says. Do not ask for info they already gave.
3. Only suggest options that EXIST in the database above. Never make up locations, prices or availability.
4. Ask for ONE missing piece of information at a time. Never bombard with multiple questions.
5. If user mentions something not in database suggest the closest available alternative naturally.
6. Once you have enough info to search set action to "search_properties".
7. When user selects a property to view set action to "booking".
8. When user wants to cancel a booking set action to "cancel_booking".
9. Keep messages concise and WhatsApp-friendly. Use line breaks for readability.
10. Use occasional emojis but do not overdo it. Keep it professional.

INFORMATION YOU NEED TO COLLECT (in natural conversation order):
- Name (ask early and use it throughout)
- Property type (Buy/Rent/Land)
- Ready or Off-Plan preference
- Completion date preference (only if Off-Plan)
- Location (from available locations only)
- Size/Bedrooms (from available options only)
- Budget (suggest the actual price range from database)

WHEN TO SEARCH:
Set action to "search_properties" when you have:
- Property type
- Location
- Size or plot size
- Budget or budget range confirmed

RESPONSE FORMAT:
You must ALWAYS respond with valid JSON in this exact format:
{
  "message": "your natural conversational reply here",
  "action": "continue" | "search_properties" | "booking" | "cancel_booking" | "human_handoff",
  "extracted": {
    "name": null or "string",
    "interest": null or "Buy" or "Rent" or "Land",
    "location": null or "string",
    "size": null or "string like 2 bedroom or Studio",
    "bedrooms": null or number,
    "budget": null or number,
    "is_offplan": null or true or false,
    "completion_range": null or "2026" or "2027" or "2028" or "2029+" or "any",
    "property_number": null or number,
    "slot_number": null or number
  },
  "confidence": "high" or "medium" or "low"
}

IMPORTANT: Return ONLY the JSON. No text before or after. No markdown code blocks.`;

    // Build conversation messages for Claude
    const messages = [];

    // Add conversation history
    if (conversationHistory && conversationHistory.length > 0) {
      for (const msg of conversationHistory) {
        messages.push({
          role: msg.role,
          content: msg.content
        });
      }
    }

    // Add current user message
    messages.push({
      role: 'user',
      content: userMessage
    });

    console.log('Calling Claude AI...');
    console.log('Messages count:', messages.length);

    console.log('API Key present:', !!process.env.ANTHROPIC_API_KEY);
    console.log('API Key length:', process.env.ANTHROPIC_API_KEY?.length);

    // Call Claude API
    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 200,
      system: systemPrompt,
      messages: messages
    });

    const rawResponse = response.content[0].text;
    console.log('Claude response:', rawResponse);

    // Parse JSON response
    let parsed;
    try {
      // Clean response in case there are any markdown artifacts
      const cleaned = rawResponse
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();
      parsed = JSON.parse(cleaned);
    } catch (parseError) {
      console.error('Failed to parse Claude response:', parseError);
      // Return safe fallback
      return {
        message: "I am sorry, something went wrong. Please try again or send HI to restart.",
        action: "continue",
        extracted: {},
        confidence: "low"
      };
    }

    return parsed;

  } catch (error) {
    console.error('Error in AI conversation:', error);
    return {
      message: `I am sorry, something went wrong on my end.\n\nPlease contact our agent directly:\nAgent: ${agentName || 'Our Agent'}\nPhone: ${agentPhone || 'N/A'}\n\nOr reply HI to try again.`,
      action: "human_handoff",
      extracted: {},
      confidence: "low"
    };
  }
}

module.exports = { processAIConversation };