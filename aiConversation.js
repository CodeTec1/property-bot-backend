// aiConversation.js - Smart AI conversation engine
const Anthropic = require('@anthropic-ai/sdk');
const supabase = require('./supabase');

function getAnthropicClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ============================================
// Fetch live options from database
// ============================================
async function fetchTenantOptions(tenantId, interest, location) {
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
      const { data: propData } = await supabase
        .from('properties')
        .select('bedrooms, plot_size, price, is_offplan, completion_date')
        .eq('tenant_id', tenantId)
        .eq('available', true)
        .ilike('type', interest)
        .ilike('location', location);

      if (propData && propData.length > 0) {

        // Detect availability
options.hasOffplan = propData.some(p => p.is_offplan === true);
options.hasReady = propData.some(p => p.is_offplan === false);
        // Bedrooms
        const beds = [...new Set(
          propData.map(r => r.bedrooms).filter(b => b !== null && b !== undefined)
        )].sort((a, b) => a - b);
        options.bedrooms = beds.map(b => b === 0 ? 'Studio' : `${b} Bedroom${b > 1 ? 's' : ''}`);

        // Plot sizes
        const plots = [...new Set(propData.map(r => r.plot_size).filter(Boolean))];
        if (plots.length > 0) options.plotSizes = plots;

        // Price range
        const prices = propData.map(r => r.price).filter(p => p && p > 0).sort((a, b) => a - b);
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
// ============================================
function getConversationStage(lead) {
  if (!lead?.interest) return 'need_interest';
  if (!lead?.name) return 'need_name';
  if (lead?.interest !== 'Land' &&
    lead?.is_offplan === null &&
    lead?.is_offplan === undefined) return 'need_offplan';
  if (lead?.is_offplan === true && !lead?.completion_range) return 'need_completion';
  if (!lead?.location) return 'need_location';
  if (!lead?.size) return 'need_size';
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
    if (['hi', 'hello', 'hey', 'start', 'restart'].includes(msg)) {
      if (isNewLead || !lead) {
        return {
          message:
            `Hello! 👋 Welcome to *${companyName}*\n\n` +
            `I am ${botName}, your property assistant.\n\n` +
            `What is your name?`,
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
    // ============================================
    const options = await fetchTenantOptions(
      tenant.id,
      lead?.interest || null,
      lead?.location || null
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
2. NEVER ask for information already collected (listed below).
3. Ask for EXACTLY ONE missing piece of information per reply.
4. ONLY mention locations, bedrooms, and prices that exist in our database.
5. If user mentions unavailable option, naturally suggest the closest available one.
6. Use the user's name once you have it.
7. Keep replies short and WhatsApp-friendly — max 3-4 lines.
8. Currency is always Kenyan Shillings (KES). When user says 10M mean KES 10,000,000.
9. Return ONLY valid JSON. No markdown. No backticks. Nothing else.
10. If off-plan properties are NOT available, NEVER ask about off-plan.
11. If only one type (ready or off-plan) exists, assume it automatically and do not ask.
12. ALWAYS suggest a budget range when asking about budget.
13. NEVER ask "what is your budget?" without giving a range first.
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
   3. Continue conversation flow

22. Even if you are in a specific stage (e.g. need_budget), if the user asks a question, ALWAYS answer the question first before continuing the stage.

=== HUMAN CONVERSATION STYLE ===
- Speak like a real estate agent on WhatsApp.
- Use natural phrases like:
  "Great", "Perfect", "Got it", "Nice choice", "Let me check that for you"
- Vary sentence structure. Do NOT repeat the same pattern.
- Avoid sounding like a questionnaire.
- Keep responses friendly, warm, and slightly conversational.
- You can use light emojis (1 max per message).
- Never sound robotic or scripted.

=== HANDLE USER QUESTIONS ===
If the user asks a question:

1. Answer it directly and naturally first.
2. Use only available database information.
3. If information is not available, say so honestly.
4. After answering, gently guide the conversation forward.

Examples:
- If user asks "Do you have off-plan?" and off-plan is NOT available:
  → Say it is not available and suggest ready properties.

- If user asks about payment plans:
  → Say it depends on the property and suggest contacting the agent.

- If user asks about viewing:
  → Explain booking process briefly.

NEVER ignore a user question.

=== WHAT WE ALREADY KNOW ===
Name: ${lead?.name || 'NOT YET COLLECTED'}
Interest: ${lead?.interest || 'NOT YET COLLECTED'}
Off-plan preference: ${lead?.is_offplan !== null && lead?.is_offplan !== undefined ? (lead.is_offplan ? 'Off-Plan' : 'Ready') : 'NOT YET COLLECTED'}
Completion range: ${lead?.completion_range || (lead?.is_offplan === false ? 'N/A - Ready property' : 'NOT YET COLLECTED')}
Location: ${lead?.location || 'NOT YET COLLECTED'}
Size: ${lead?.size || 'NOT YET COLLECTED'}
Budget: ${lead?.budget ? `KES ${Number(lead.budget).toLocaleString()}` : 'NOT YET COLLECTED'}

=== INTENT UNDERSTANDING ===

The user may ask questions at ANY time.

Your job:

1. ALWAYS detect if the user is asking a question.
2. ALWAYS answer the question first (based only on available data).
3. THEN continue the conversation naturally.

Examples:

- If user asks:
  "Do you have off-plan properties?"

  → Check database.
  → If available:
     "Yes, we do have off-plan options in [location]."

  → If NOT available:
     "We currently don’t have off-plan properties, but we have ready units available."

- If user asks:
  "Can I pay in installments?"

  → Answer:
     "Yes, installment plans are available depending on the property."

- If user asks:
  "Can I view tomorrow?"

  → Answer:
     "Yes, viewings can be arranged. I can connect you with an agent."

4. After answering, continue the flow:
   - Ask the next missing piece of information ONLY if needed.
   - NEVER ignore the user's question.
   - NEVER respond like a script.

5. If the question is unrelated to property:
   - Politely guide them back to property conversation.


=== WHAT TO COLLECT NEXT ===
Current stage: ${stage}
${stage === 'need_interest' ? `Ask what they are looking for. Available types in our database: ${options.types?.join(', ') || 'Buy, Rent, Land'}. Do not mention other types.` : ''}
${stage === 'need_name' ? 'Ask for their name naturally.' : ''}
${stage === 'need_offplan' ? 'Ask if they want a ready property or off-plan development. Both options exist in our database.' : ''}
${stage === 'need_completion' ? `Ask when they would like it completed. We have off-plan properties completing in: ${options.completionDates?.join(', ') || 'various dates'}. Present these exact options.` : ''}
${stage === 'need_location' ? `Ask which area they prefer. We have properties in ONLY these locations: ${options.locations?.join(', ') || 'checking...'}. Only mention these exact locations.` : ''}
${stage === 'need_size' ? `Ask for size or bedrooms. Available options in ${lead?.location || 'this area'}: ${options.bedrooms?.join(', ') || options.plotSizes?.join(', ') || 'checking...'}. Only mention these exact options.` : ''}
${stage === 'need_budget' ? `Ask for budget. Properties matching their criteria range from ${options.priceRange || 'various prices'}. Mention this range to guide them.` : ''}
${stage === 'ready_to_search' ? 'ALL information collected. You MUST set action to "search_properties". Confirm their full criteria and say you are searching.' : ''}


=== DATABASE OPTIONS ===
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

=== JSON FORMAT ===
{
  "message": "your natural reply",
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

IMPORTANT: Only extract values the user EXPLICITLY said in THIS message.
Set action to "search_properties" ONLY when stage is "ready_to_search".
Set action to "booking" when user mentions a property number to view.`;

    // ============================================
    // BUILD MESSAGES - LAST 6 ONLY FOR COST
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

      // Find JSON object in response
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');

      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('JSON parse error:', parseError.message);
      console.error('Raw was:', raw);

      return {
        message: `I did not quite catch that. Could you rephrase? 😊`,
        action: 'continue',
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

    // Safety: override action if stage says ready_to_search
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