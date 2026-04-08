// aiConversation.js - Smart AI conversation engine
const Anthropic = require('@anthropic-ai/sdk');
const supabase = require('./supabase');

function getAnthropicClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ============================================
// Fetch live options from database
// lead param allows bedroom-filtered price range
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

    // Locations filtered by interest
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

    // Bedrooms, sizes, prices — filtered by interest + location + offplan
    if (interest && location) {
      let propQuery = supabase
        .from('properties')
        .select('bedrooms, plot_size, price, is_offplan, completion_date')
        .eq('tenant_id', tenantId)
        .eq('available', true)
        .ilike('type', interest)
        .ilike('location', location);

      if (isOffplan === true) propQuery = propQuery.eq('is_offplan', true);
      if (isOffplan === false) propQuery = propQuery.eq('is_offplan', false);

      // Filter by bedrooms when known — gives exact price range for budget question
      if (lead?.size) {
        const isStudio = lead.size.toLowerCase().includes('studio');
        const bedroomNum = isStudio ? 0 : parseInt(lead.size.match(/\d+/)?.[0]);
        if (!isNaN(bedroomNum)) {
          propQuery = propQuery.eq('bedrooms', bedroomNum);
        }
      }

      const { data: propData } = await propQuery;

      if (propData && propData.length > 0) {
        options.hasOffplan = propData.some(p => p.is_offplan === true);
        options.hasReady = propData.some(p => p.is_offplan === false);

        // Bedrooms — only when we don't yet know the user's size preference
        if (!lead?.size) {
          const beds = [...new Set(
            propData.map(r => r.bedrooms).filter(b => b !== null && b !== undefined)
          )].sort((a, b) => a - b);
          options.bedrooms = beds.map(b => b === 0 ? 'Studio' : `${b} Bedroom${b > 1 ? 's' : ''}`);
        }

        // Plot sizes
        const plots = [...new Set(propData.map(r => r.plot_size).filter(Boolean))];
        if (plots.length > 0) options.plotSizes = plots;

        // Price range
        let priceSource = propData;
        if (isOffplan === true) {
          const d = propData.filter(p => p.is_offplan === true);
          if (d.length > 0) priceSource = d;
        }
        if (isOffplan === false) {
          const d = propData.filter(p => p.is_offplan === false);
          if (d.length > 0) priceSource = d;
        }

        const prices = priceSource.map(r => r.price).filter(p => p && p > 0).sort((a, b) => a - b);
        if (prices.length > 0) {
          options.minPrice = prices[0];
          options.maxPrice = prices[prices.length - 1];
          options.priceRange = `KES ${Number(prices[0]).toLocaleString()} to KES ${Number(prices[prices.length - 1]).toLocaleString()}`;
        }

        // Completion dates — always filtered by interest + location + offplan + bedrooms
        // So the dates shown are only for properties matching ALL the user's preferences
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
// ORDER: interest → name → location → size
//        → offplan → completion → budget → search
// Budget is ALWAYS last — needs all other data
// to pull the exact price range from DB
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
  const { userMessage, lead, tenant, conversationHistory, agentName, agentPhone, isNewLead } = params;

  const botName = tenant.bot_name || 'PropertyBot';
  const companyName = tenant.company_name;
  const msg = userMessage.trim().toLowerCase();

  try {
    // ============================================
    // GREETINGS — handled without AI (free)
    // ============================================
    if (['hi', 'hello', 'hey', 'start', 'restart', 'helo', 'hii'].includes(msg)) {
      if (isNewLead || !lead) {
        const greetingOptions = await fetchTenantOptions(tenant.id, null, null);
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
    // Pass full lead so bedrooms filter is applied
    // when fetching price range for budget stage
    // ============================================
    const options = await fetchTenantOptions(
      tenant.id,
      lead?.interest || null,
      lead?.location || null,
      lead?.is_offplan ?? null,
      lead
    );

    const stage = getConversationStage(lead);
    console.log('Conversation stage:', stage);

    // ============================================
    // SYSTEM PROMPT
    // ============================================
    const systemPrompt = `You are ${botName}, a professional and warm real estate assistant for ${companyName}.

You help users find properties through natural friendly conversation — like a knowledgeable human agent would on WhatsApp.

=== YOUR ROLE ===
- The DATABASE is the source of truth for all options, prices, locations, dates.
- YOU handle language: make the conversation feel warm, natural, and human.
- NEVER invent options. Only suggest what exists in the database.
- NEVER ask for information the user already provided.

=== ABSOLUTE RULES ===
1. NEVER invent locations, prices, bedrooms, dates, or property details.
2. Ask for EXACTLY ONE piece of information per reply.
3. ONLY mention options that exist in the database (shown below).
4. Always use the user's name once you have it.
5. Keep replies short — max 3-4 lines. WhatsApp-friendly.
6. Currency is always KES. "10M" = KES 10,000,000.
7. Return ONLY valid JSON. No markdown, no backticks, nothing else.
8. NEVER ask about off-plan if only ready properties exist (and vice versa).
9. Budget is ALWAYS the last question — never ask it early.
10. Always show the price range when asking for budget — never ask blind.
11. Ask ONE question per message. Keep it conversational.
12. ALWAYS answer user questions BEFORE asking for next info.
13. NEVER ignore what the user said. Extract AND respond.
14. If user volunteers multiple facts in one message, extract them all, then ask only for the next MISSING field.

=== CONVERSATION STYLE ===
Sound like a friendly, knowledgeable real estate agent chatting on WhatsApp.
Use phrases like: "Great!", "Perfect", "Got it", "Nice choice", "Let me check that"
Use light emojis (max 1 per message). Vary your sentences. Never sound like a form.

=== HANDLE QUESTIONS ===
If user asks a question at any point:
1. Answer it first using only DB information.
2. If you don't have the answer, say so honestly.
3. Then continue asking for the next missing field.
Never ignore a question.

=== SMART CONTEXT EXTRACTION ===
If user says "I want a 3-bed in Kilimani":
- Extract: bedrooms=3, location=Kilimani
- Then ask only for the next missing field (don't ask for things they told you)

=== WHAT WE ALREADY KNOW ===
Name: ${lead?.name || 'NOT YET COLLECTED'}
Interest: ${lead?.interest || 'NOT YET COLLECTED'}
Location: ${lead?.location || 'NOT YET COLLECTED'}
Size/Bedrooms: ${lead?.size || 'NOT YET COLLECTED'}
Off-plan preference: ${lead?.is_offplan !== null && lead?.is_offplan !== undefined ? (lead.is_offplan ? 'Off-Plan' : 'Ready') : 'NOT YET COLLECTED'}
Completion range: ${lead?.completion_range || (lead?.is_offplan === false ? 'N/A - Ready property' : 'NOT YET COLLECTED')}
Budget: ${lead?.budget ? `KES ${Number(lead.budget).toLocaleString()}` : 'NOT YET COLLECTED'}

=== CONVERSATION FLOW — CURRENT STAGE: ${stage} ===
Follow this order STRICTLY. Do not skip ahead. Budget is ALWAYS last.

1. need_interest  → type of property
2. need_name      → user's name
3. need_location  → area (from DB, filtered by interest)
4. need_size      → bedrooms or plot size (from DB, filtered by interest + location)
5. need_offplan   → ready or off-plan (from DB)
6. need_completion→ completion date (off-plan only, from DB — filtered by ALL preferences so far)
7. need_budget    → budget LAST (show exact price range from DB filtered by ALL preferences)
8. ready_to_search→ confirm and search

${stage === 'need_interest' ? `
TASK: Ask what type of property.
DB TYPES: ${options.types?.join(', ') || 'Buy, Rent'}
RULE: ONLY mention these types.` : ''}

${stage === 'need_name' ? `
TASK: Ask for the user's name.
EXAMPLE: "What's your name? I'd love to help you personally 😊"` : ''}

${stage === 'need_location' ? `
TASK: Ask which area.
DB LOCATIONS (for ${lead?.interest}): ${options.locations?.join(', ') || 'checking database...'}
RULE: Only mention locations from the list above.
EXAMPLE: "Which area interests you? We have properties in: ${options.locations?.join(', ') || '...'}"` : ''}

${stage === 'need_size' ? `
TASK: Ask for bedrooms or plot size.
DB OPTIONS IN ${lead?.location?.toUpperCase() || 'THIS AREA'}: ${options.bedrooms?.join(', ') || options.plotSizes?.join(', ') || 'checking database...'}
RULE: Only mention options from the list. Do NOT ask about budget here.
EXAMPLE: "How many bedrooms? In ${lead?.location} we have: ${options.bedrooms?.join(', ') || '...'}"` : ''}

${stage === 'need_offplan' ? `
TASK: Ask ready or off-plan.
Off-plan available: ${options.hasOffplan ? 'YES' : 'NO'}
Ready available: ${options.hasReady ? 'YES' : 'NO'}
${!options.hasOffplan ? 'RULE: Only ready properties exist. Tell user naturally and set is_offplan=false.' : ''}
${!options.hasReady ? 'RULE: Only off-plan exists. Tell user naturally and set is_offplan=true.' : ''}
${options.hasOffplan && options.hasReady ? 'EXAMPLE: "Are you looking for a ready property or an off-plan development?"' : ''}` : ''}

${stage === 'need_completion' ? `
TASK: Ask preferred completion date.
DB COMPLETION DATES (for ${lead?.size} ${lead?.interest} in ${lead?.location}): ${options.completionDates?.join(', ') || 'checking database...'}
RULE: Only show dates from the list above. Do NOT invent dates.
EXAMPLE: "When would you like it completed? For ${lead?.size} off-plan in ${lead?.location} we have: ${options.completionDates?.join(', ') || '...'}"` : ''}

${stage === 'need_budget' ? `
TASK: Ask for budget. This is the LAST question before searching.
EXACT PRICE RANGE FOR:
  ${lead?.interest} | ${lead?.location} | ${lead?.size} | ${lead?.is_offplan ? 'Off-plan' : 'Ready'}${lead?.completion_range ? ` | ${lead?.completion_range}` : ''}
  FROM DATABASE: ${options.priceRange || 'checking database...'}
RULE: Always show the exact DB price range. Never ask blind. Never guess.
EXAMPLE: "Almost there! Properties matching your preferences in ${lead?.location} are priced from ${options.priceRange || '...'}. What is your budget?"` : ''}

${stage === 'ready_to_search' ? `
TASK: All info collected. Set action to "search_properties".
Briefly confirm preferences and say you are searching now.` : ''}

=== DATABASE REFERENCE ===
Types: ${options.types?.join(', ') || 'N/A'}
${options.locations?.length ? `Locations: ${options.locations.join(', ')}` : ''}
${options.bedrooms?.length ? `Bedrooms: ${options.bedrooms.join(', ')}` : ''}
${options.plotSizes?.length ? `Plot Sizes: ${options.plotSizes.join(', ')}` : ''}
${options.completionDates?.length ? `Completion Dates: ${options.completionDates.join(', ')}` : ''}
${options.priceRange ? `Price Range: ${options.priceRange}` : ''}
Off-plan available: ${options.hasOffplan ? 'YES' : 'NO'}
Ready available: ${options.hasReady ? 'YES' : 'NO'}

=== AGENT ===
${agentName || 'Our Agent'} — ${agentPhone || 'N/A'}

=== JSON RESPONSE — return ONLY this, no text outside ===
{
  "message": "your reply here",
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

ACTIONS: continue | search_properties | booking | cancel_booking | human_handoff

EXTRACTION RULES:
- Only extract values the user EXPLICITLY said in THIS message.
- "budget" must be a number in KES (e.g. 12000000 not "12M").
- "bedrooms" must be a number (0=studio, 1, 2, 3...).
- "is_offplan" must be true or false — never a string.
- "completion_range" must contain a 4-digit year (e.g. "Dec-2027") — never extract "12 months" or similar.
- Set action="search_properties" ONLY when stage is "ready_to_search".
- Set action="booking" when user picks a property number.
- Leave fields null if user did NOT explicitly mention them.`;

    // Build messages — last 6 only
    const recentHistory = (conversationHistory || []).slice(-6);
    const messages = [
      ...recentHistory.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content.slice(0, 400) : String(m.content).slice(0, 400)
      })),
      { role: 'user', content: userMessage.slice(0, 600) }
    ];

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
    console.log('Claude raw:', raw.substring(0, 300));

    // Parse JSON
    let parsed;
    try {
      const cleaned = raw.replace(/```json/gi, '').replace(/```/gi, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('JSON parse error:', parseError.message);
      console.error('Raw was:', raw);

      // Stage-appropriate fallback messages
      const stageFallbacks = {
        'need_interest': `Are you looking to ${options.types?.join(', ') || 'Buy or Rent'}?`,
        'need_name': `Could you share your name? 😊`,
        'need_location': options.locations?.length
          ? `Which area? We have: ${options.locations.join(', ')}`
          : `Which area do you prefer?`,
        'need_size': options.bedrooms?.length
          ? `How many bedrooms? Available: ${options.bedrooms.join(', ')}`
          : `How many bedrooms are you looking for?`,
        'need_offplan': `Are you looking for a ready property or off-plan?`,
        'need_completion': options.completionDates?.length
          ? `When would you like it completed? We have: ${options.completionDates.join(', ')}`
          : `When would you like it completed?`,
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

    // Clean nulls from extracted
    if (parsed.extracted) {
      Object.keys(parsed.extracted).forEach(key => {
        if (parsed.extracted[key] === null || parsed.extracted[key] === undefined) {
          delete parsed.extracted[key];
        }
      });
    }

    // Safety: if stage says ready but AI says continue, force search
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