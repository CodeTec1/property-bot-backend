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

        // Completion dates for offplan
        const dates = [...new Set(
          propData.filter(r => r.is_offplan).map(r => r.completion_date).filter(Boolean)
        )];
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
  if (!lead?.size) return 'need_size';
  if (lead?.interest !== 'Land') {
    const offplanKnown = lead?.is_offplan === true || lead?.is_offplan === false;
    if (!offplanKnown) return 'need_offplan';
    if (lead?.is_offplan === true && !lead?.completion_range) return 'need_completion';
  }
  if (!lead?.budget) return 'need_budget';
  return 'ready_to_search';
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
    agentPhone,
    isNewLead
  } = params;

  const botName = tenant.bot_name || 'PropertyBot';
  const companyName = tenant.company_name;
  const msg = userMessage.trim().toLowerCase();

  try {
    // ============================================
    // HANDLE GREETINGS WITHOUT AI - FREE
    // ============================================
    if (['hi', 'hello', 'hey', 'start', 'restart', 'helo', 'hii'].includes(msg)) {
      if (isNewLead || !lead) {
        const greetingOptions = await fetchTenantOptions(tenant.id, null, null);
        // CHANGE: Safe fallback — never show wrong types if DB fails
        const typesList = greetingOptions.types?.length
          ? greetingOptions.types.join(', ')
          : 'Buy or Rent';
        return {
          message:
            `Hello! 👋 Welcome to *${companyName}*\n\n` +
            `I am ${botName}, your property assistant.\n\n` +
            `Are you looking to *${typesList}*?`,
          action: 'continue',
          extracted: {},
          confidence: 'high'
        };
      } else {
        return {
          message:
            `Welcome back${lead.name ? `, ${lead.name}` : ''}! 👋\n\n` +
            `I am ${botName} from *${companyName}*.\n\n` +
            `Are you looking for a new property or continuing your previous search?`,
          action: 'continue',
          extracted: { restart: true },
          confidence: 'high'
        };
      }
    }

    // ============================================
    // FETCH DATABASE OPTIONS
    // CHANGE: Pass full `lead` object so bedrooms
    // filter applies when fetching price range
    // ============================================
    const options = await fetchTenantOptions(
      tenant.id,
      lead?.interest || null,
      lead?.location || null,
      lead?.is_offplan ?? null,
      lead   // full lead — used to filter by bedrooms for accurate price range
    );

    const stage = getConversationStage(lead);
    console.log('Conversation stage:', stage);

    // ============================================
    // BUILD SMART SYSTEM PROMPT
    // ============================================
    const systemPrompt = `You are ${botName}, a professional and warm real estate assistant for ${companyName}.

You help users find properties through natural friendly conversation — like a knowledgeable human agent.

=== ABSOLUTE RULES ===
1. NEVER invent names, locations, prices, or property details.
2. NEVER ask for information already collected (listed below under WHAT WE ALREADY KNOW).
3. Ask for EXACTLY ONE missing piece of information per reply.
4. ONLY mention locations, bedrooms, and prices that exist in our database.
5. If user mentions unavailable option, naturally suggest the closest available one.
6. Use the user's name once you have it.
7. Keep replies short and WhatsApp-friendly — max 3-4 lines.
8. Currency is always Kenyan Shillings (KES). When user says 10M mean KES 10,000,000.
9. Return ONLY valid JSON. No markdown. No backticks. Nothing else.
10. If off-plan properties are NOT available, NEVER ask about off-plan.
11. If only one type (ready or off-plan) exists, assume it automatically and do not ask.
12. ALWAYS suggest a budget range when asking about budget — pulled from the database.
13. NEVER ask "what is your budget?" without giving the actual price range first.
14. Help the user choose instead of forcing them to guess.
15. Do not ask all questions at once.
16. Ask one question per message and keep the flow natural.
17. ALWAYS answer user questions before asking for information.
18. NEVER ignore a user message.
19. If a user message contains both a question and an answer, extract and process both.
20. Respond like a human agent, not a form.
21. PRIORITY ORDER (VERY IMPORTANT):
   1. Answer user question (if any)
   2. Extract any information from the message
   3. Continue conversation flow — ask ONLY the current stage question

22. Even if you are in a specific stage (e.g. need_budget), if the user asks a question,
    ALWAYS answer the question first before continuing the stage.
23. If user gives unclear answer, DO NOT say you didn't understand.
    Instead: rephrase the question and show available options again.
24. NEVER skip the flow order. Budget ALWAYS comes last.
25. If a user volunteers information early (e.g. says "I want a 2-bed in Kilimani"),
    extract it, save it, then ask ONLY for the next missing field in the flow.

=== HUMAN CONVERSATION STYLE ===
- Speak like a real estate agent chatting on WhatsApp.
- Use natural phrases like:
  "Great", "Perfect", "Got it", "Nice choice", "Let me check that for you"
- Vary sentence structure. Do NOT repeat the same pattern every message.
- Avoid sounding like a questionnaire or a form.
- Keep responses friendly, warm, and slightly conversational.
- You can use light emojis (1 max per message).
- Never sound robotic or scripted.

=== HANDLE USER QUESTIONS ===
If the user asks a question:
1. Answer it directly and naturally first using only available database information.
2. If information is not available, say so honestly.
3. After answering, gently guide the conversation forward by asking the current stage question.

Examples:
- If user asks "Do you have off-plan?" and off-plan is NOT available:
  → Say it is not available and suggest ready properties.
- If user asks about payment plans:
  → Say it depends on the property and suggest contacting the agent.
- If user asks about viewing:
  → Explain booking process briefly.

NEVER ignore a user question.

=== SMART CONTEXT EXTRACTION ===
If the user volunteers multiple pieces of information in one message
(e.g. "I'm looking for a 3-bed apartment in Westlands"):
- Extract ALL the information you can from that message.
- Save it all.
- Then ask ONLY for the next field in the flow that is still missing.
- Do NOT ask for things the user already told you.

=== WHAT WE ALREADY KNOW ===
Name: ${lead?.name || 'NOT YET COLLECTED'}
Interest: ${lead?.interest || 'NOT YET COLLECTED'}
Location: ${lead?.location || 'NOT YET COLLECTED'}
Size/Bedrooms: ${lead?.size || 'NOT YET COLLECTED'}
Off-plan preference: ${lead?.is_offplan !== null && lead?.is_offplan !== undefined ? (lead.is_offplan ? 'Off-Plan' : 'Ready') : 'NOT YET COLLECTED'}
Completion range: ${lead?.completion_range || (lead?.is_offplan === false ? 'N/A - Ready property' : 'NOT YET COLLECTED')}
Budget: ${lead?.budget ? `KES ${Number(lead.budget).toLocaleString()}` : 'NOT YET COLLECTED'}

=== CONVERSATION FLOW — CURRENT STAGE: ${stage} ===

YOU MUST FOLLOW THIS ORDER STRICTLY. DO NOT SKIP AHEAD. DO NOT ASK BUDGET EARLY.

FLOW ORDER:
1. need_interest  → What type of property (Buy / Rent / Land)
2. need_name      → User's name
3. need_location  → Which area (from DB, filtered by interest)
4. need_size      → Bedrooms or plot size (from DB, filtered by interest + location)
5. need_offplan   → Ready or off-plan (from DB, filtered by interest + location)
6. need_completion→ Completion date (ONLY if off-plan, from DB)
7. need_budget    → Budget LAST — shown with exact price range from DB using ALL filters
8. ready_to_search→ Confirm and trigger search

${stage === 'need_interest' ? `
TASK: Ask what type of property they want.
AVAILABLE TYPES IN DATABASE: ${options.types?.join(', ') || 'Buy, Rent'}
RULE: ONLY mention types from the list above. Nothing else.
EXAMPLE: "Are you looking to Buy, Rent, or purchase Land?"` : ''}

${stage === 'need_name' ? `
TASK: Ask for the user's name naturally.
EXAMPLE: "What's your name? I'd love to address you personally 😊"` : ''}

${stage === 'need_location' ? `
TASK: Ask which area/location they prefer.
AVAILABLE LOCATIONS IN DATABASE: ${options.locations?.join(', ') || 'fetching...'}
RULE: ONLY mention locations from the list above. Nothing else.
EXAMPLE: "Which area interests you? We have properties in: ${options.locations?.join(', ') || '...'}"` : ''}

${stage === 'need_size' ? `
TASK: Ask for number of bedrooms or plot size.
AVAILABLE IN ${lead?.location?.toUpperCase() || 'THIS AREA'}: ${options.bedrooms?.join(', ') || options.plotSizes?.join(', ') || 'fetching...'}
RULE: ONLY mention options from the list above. Do NOT ask about budget here.
EXAMPLE: "How many bedrooms are you looking for? We have: ${options.bedrooms?.join(', ') || '...'}"` : ''}

${stage === 'need_offplan' ? `
TASK: Ask if they want a ready property or off-plan.
Off-plan available: ${options.hasOffplan ? 'YES' : 'NO'}
Ready available: ${options.hasReady ? 'YES' : 'NO'}
${!options.hasOffplan ? 'RULE: Only ready properties exist. Tell user naturally and set is_offplan=false automatically.' : ''}
${!options.hasReady ? 'RULE: Only off-plan exists. Tell user naturally and set is_offplan=true automatically.' : ''}
${options.hasOffplan && options.hasReady ? 'EXAMPLE: "Are you looking for a ready-to-move-in property or an off-plan development?"' : ''}` : ''}

${stage === 'need_completion' ? `
TASK: Ask preferred completion date. This is for off-plan properties only.
COMPLETION DATES IN DATABASE: ${options.completionDates?.join(', ') || 'various dates'}
RULE: Only show dates from above. Do not invent dates.
EXAMPLE: "When would you like it completed? We have options for: ${options.completionDates?.join(', ') || '...'}"` : ''}

${stage === 'need_budget' ? `
TASK: Ask for budget. This is the LAST question before searching.
PRICE RANGE FOR THEIR EXACT CRITERIA:
  Type: ${lead?.interest} | Location: ${lead?.location} | Size: ${lead?.size} | ${lead?.is_offplan ? 'Off-plan' : 'Ready'} ${lead?.completion_range ? `| Completion: ${lead?.completion_range}` : ''}
  PRICE RANGE FROM DATABASE: ${options.priceRange || 'various prices'}
RULE: ALWAYS show the exact price range. NEVER ask blind. NEVER guess a range.
EXAMPLE: "What is your budget? Properties matching your preferences in ${lead?.location} are priced from ${options.priceRange || '...'}"` : ''}

${stage === 'ready_to_search' ? `
TASK: ALL INFO COLLECTED. Set action to "search_properties".
Briefly confirm their preferences and say you are searching now.` : ''}

=== DATABASE OPTIONS (for reference) ===
Types: ${options.types?.join(', ') || 'Buy, Rent, Land'}
${options.locations?.length ? `Locations: ${options.locations.join(', ')}` : ''}
${options.bedrooms?.length ? `Bedrooms: ${options.bedrooms.join(', ')}` : ''}
${options.plotSizes?.length ? `Plot Sizes: ${options.plotSizes.join(', ')}` : ''}
${options.priceRange ? `Price Range: ${options.priceRange}` : ''}
Off-plan available: ${options.hasOffplan ? 'YES' : 'NO'}
Ready properties available: ${options.hasReady ? 'YES' : 'NO'}

=== AGENT CONTACT ===
Agent: ${agentName || 'Our Agent'}
Phone: ${agentPhone || 'N/A'}

=== JSON RESPONSE FORMAT ===
Return ONLY this JSON object. No text before or after. No markdown.

{
  "message": "your natural reply here",
  "action": "continue",
  "extracted": {
    "name": null,
    "interest": null,
    "location": null,
    "size": null,
    "bedrooms": null,
    "budget": null,
    "is_offplan": null,
    "completion_range": null,
    "property_number": null,
    "slot_number": null,
    "restart": null
  },
  "confidence": "high"
}

ACTIONS:
- "continue"          → still collecting information
- "search_properties" → all fields collected, ready to search
- "booking"           → user wants to book a specific property
- "cancel_booking"    → user wants to cancel their booking
- "human_handoff"     → user needs human agent

EXTRACTION RULES:
- Only extract values the user EXPLICITLY said in THIS message.
- Set "action" to "search_properties" ONLY when stage is "ready_to_search".
- Set "action" to "booking" when user mentions a property number to view.
- Set "bedrooms" as a number (e.g. 0 for studio, 1, 2, 3...).
- Set "budget" as a number in KES (e.g. 6000000 not "6M").
- Set "is_offplan" as true or false only — never a string.
- Leave fields as null if the user did NOT mention them in this message.`;

    // ============================================
    // BUILD MESSAGES — last 6 only for cost control
    // ============================================
    const recentHistory = (conversationHistory || []).slice(-6);

    const messages = [
      ...recentHistory.map(m => ({
        role: m.role,
        content: typeof m.content === 'string'
          ? m.content.slice(0, 400)
          : String(m.content).slice(0, 400)
      })),
      { role: 'user', content: userMessage.slice(0, 600) }
    ];

    // ============================================
    // CALL CLAUDE HAIKU
    // NOTE: quickExtract block REMOVED — all pre-extraction
    // is handled in webhook.js to avoid double extraction conflicts
    // ============================================
    console.log('Calling Claude AI - stage:', stage);
    console.log('API Key present:', !!process.env.ANTHROPIC_API_KEY);

    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: systemPrompt,
      messages
    });

    const raw = response.content?.[0]?.text || '';
    console.log('Claude raw:', raw.substring(0, 200));

    // ============================================
    // PARSE JSON RESPONSE
    // ============================================
    let parsed;
    try {
      const cleaned = raw
        .replace(/```json/gi, '')
        .replace(/```/gi, '')
        .trim();

      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');

      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('JSON parse error:', parseError.message);
      console.error('Raw was:', raw);

      // Smart fallback based on current stage
      const stageFallbacks = {
        'need_interest': `Are you looking to ${options.types?.join(', ') || 'Buy or Rent'}?`,
        'need_name': `Could you share your name? 😊`,
        'need_location': options.locations?.length
          ? `Which area are you interested in? We have: ${options.locations.join(', ')}`
          : `Which area do you prefer?`,
        'need_size': options.bedrooms?.length
          ? `How many bedrooms? Available: ${options.bedrooms.join(', ')}`
          : `How many bedrooms are you looking for?`,
        'need_offplan': `Are you looking for a ready property or an off-plan development?`,
        'need_completion': options.completionDates?.length
          ? `When would you like it completed? We have: ${options.completionDates.join(', ')}`
          : `When would you like the property completed?`,
        'need_budget': options.priceRange
          ? `What is your budget? Properties range from ${options.priceRange}`
          : `What is your budget range?`,
        'ready_to_search': `Let me search for properties matching your criteria...`
      };

      const currentStage = getConversationStage(lead);
      return {
        message: stageFallbacks[currentStage] || `Could you tell me more about what you are looking for? 😊`,
        action: currentStage === 'ready_to_search' ? 'search_properties' : 'continue',
        extracted: {},
        confidence: 'low'
      };
    }

    // Remove null extracted values
    if (parsed.extracted) {
      Object.keys(parsed.extracted).forEach(key => {
        if (parsed.extracted[key] === null || parsed.extracted[key] === undefined) {
          delete parsed.extracted[key];
        }
      });
    }

    // Safety: override action if stage says ready_to_search but AI said continue
    if (stage === 'ready_to_search' && parsed.action === 'continue') {
      parsed.action = 'search_properties';
    }

    return parsed;

  } catch (error) {
    console.error('AI error:', error.message);
    return {
      message:
        `Sorry, something went wrong.\n\n` +
        `Please contact our agent:\n` +
        `${agentName || 'Agent'}: ${agentPhone || 'N/A'}\n\n` +
        `Or reply *HI* to try again.`,
      action: 'human_handoff',
      extracted: {},
      confidence: 'low'
    };
  }
}

module.exports = { processAIConversation };