// aiConversation.js - Powerful Real Estate AI Assistant
const Anthropic = require('@anthropic-ai/sdk');
const supabase = require('./supabase');

function getAnthropicClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ============================================
// Fetch live options from database
// ============================================
async function fetchTenantOptions(tenantId, interest, location, isOffplan) {
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
        options.locations = [...new Set(
          locData.map(r => r.location).filter(Boolean)
        )].sort();
      }
    }

    // Bedrooms, prices, completion dates for interest + location
    if (interest && location) {
      let propQuery = supabase
        .from('properties')
        .select('bedrooms, plot_size, price, is_offplan, completion_date')
        .eq('tenant_id', tenantId)
        .eq('available', true)
        .ilike('type', interest)
        .ilike('location', location);

      const { data: propData } = await propQuery;

      if (propData && propData.length > 0) {
        options.hasOffplan = propData.some(p => p.is_offplan === true);
        options.hasReady = propData.some(p => p.is_offplan === false);

        // Bedrooms - sort numerically
        const beds = [...new Set(
          propData.map(r => r.bedrooms)
            .filter(b => b !== null && b !== undefined)
        )].sort((a, b) => a - b);

        options.bedrooms = beds.map(b =>
          b === 0 ? 'Studio' : `${b} Bedroom${b > 1 ? 's' : ''}`
        );
        options.bedroomNumbers = beds;

        // Plot sizes for land
        const plots = [...new Set(propData.map(r => r.plot_size).filter(Boolean))];
        if (plots.length > 0) options.plotSizes = plots;

        // Completion dates for offplan
        const dates = [...new Set(
          propData
            .filter(r => r.is_offplan === true)
            .map(r => r.completion_date)
            .filter(Boolean)
        )];
        if (dates.length > 0) options.completionDates = dates;

        // Price range - filter by offplan if known
        let priceData = propData;
        if (isOffplan === true) priceData = propData.filter(p => p.is_offplan === true);
        if (isOffplan === false) priceData = propData.filter(p => p.is_offplan === false);

        const prices = priceData
          .map(r => r.price)
          .filter(p => p && p > 0)
          .sort((a, b) => a - b);

        if (prices.length > 0) {
          options.minPrice = prices[0];
          options.maxPrice = prices[prices.length - 1];
          options.priceRange =
            `KES ${Number(prices[0]).toLocaleString()} to KES ${Number(prices[prices.length - 1]).toLocaleString()}`;
        }
      }
    }

    return options;
  } catch (error) {
    console.error('Error fetching options:', error);
    return {};
  }
}

// ============================================
// Smart stage detection
// ============================================
function getConversationStage(lead) {
  if (!lead?.interest) return 'need_interest';
  if (!lead?.name) return 'need_name';
  if (!lead?.location) return 'need_location';
  if (lead?.interest !== 'Land') {
    const offplanKnown = lead?.is_offplan === true || lead?.is_offplan === false;
    if (!offplanKnown) return 'need_offplan';
    if (lead?.is_offplan === true && !lead?.completion_range) return 'need_completion';
    if (!lead?.size) return 'need_size';
  } else {
    if (!lead?.size) return 'need_size';
  }
  if (!lead?.budget) return 'need_budget';
  return 'ready_to_search';
}

// ============================================
// Main AI function
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
    // GREETINGS - NO AI NEEDED
    // ============================================
    if (['hi', 'hello', 'hey', 'start', 'restart', 'helo', 'hii'].includes(msg)) {
      if (isNewLead || !lead) {
        return {
          message:
            `Hello! 👋 Welcome to *${companyName}*\n\n` +
            `I am ${botName}, your property assistant.\n\n` +
            `Are you looking to *Buy*, *Rent*, or purchase *Land*?`,
          action: 'continue',
          extracted: {},
          confidence: 'high'
        };
      } else {
        return {
          message:
            `Welcome back${lead.name ? `, *${lead.name}*` : ''}! 👋\n\n` +
            `I am ${botName} from *${companyName}*.\n\n` +
            `Are you starting a new property search or continuing your last one?`,
          action: 'continue',
          extracted: { restart: false },
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
      lead?.location || null,
      lead?.is_offplan ?? null
    );

    const stage = getConversationStage(lead);
    console.log('Stage:', stage, '| Lead:', JSON.stringify({
      interest: lead?.interest,
      name: lead?.name,
      location: lead?.location,
      is_offplan: lead?.is_offplan,
      completion_range: lead?.completion_range,
      size: lead?.size,
      budget: lead?.budget
    }));

    // ============================================
    // SYSTEM PROMPT
    // ============================================
    const systemPrompt = `You are ${botName}, a highly professional and warm real estate assistant for ${companyName}.

Your personality: Friendly, knowledgeable, concise. You speak like a top real estate agent on WhatsApp — natural, helpful, never robotic.

=== YOUR MISSION ===
Guide the user to find a property by collecting specific information in the correct order.
Every question you ask must be answerable using the database options provided.
Never ask a question where the answer could be something you cannot process.

=== STRICT RULES ===
1. NEVER ask for information already collected (shown below).
2. Ask for EXACTLY ONE piece of missing information per reply.
3. ONLY mention options that exist in the database. Never invent options.
4. NEVER say "I did not quite catch that" — always interpret and respond intelligently.
5. If user's answer is unclear, make your best interpretation and confirm it.
   Example: User says "something big" → interpret as largest available bedroom option and confirm.
6. NEVER ask vague questions like "what kind of property are you dreaming of?"
   Always ask specific questions with specific options from the database.
7. Budget is ALWAYS the LAST question before searching. Never ask budget before size.
8. When asking budget, always show the actual price range from the database.
9. Currency is always Kenyan Shillings (KES).
10. Use the user's name once you have it — makes conversation feel personal.
11. Keep replies to 2-4 lines maximum. WhatsApp friendly.
12. Return ONLY valid JSON. No markdown. No backticks. No extra text.
13. If only one type of property exists (e.g. only Buy), set interest automatically without asking.
14. ALWAYS be able to respond to ANY user message intelligently.

=== WHAT WE ALREADY KNOW — DO NOT ASK AGAIN ===
Interest/Type: ${lead?.interest || 'NOT COLLECTED'}
Name: ${lead?.name || 'NOT COLLECTED'}
Location: ${lead?.location || 'NOT COLLECTED'}
Ready or Off-Plan: ${lead?.is_offplan === true ? 'Off-Plan' : lead?.is_offplan === false ? 'Ready' : 'NOT COLLECTED'}
Completion Date: ${lead?.completion_range || (lead?.is_offplan === false ? 'N/A' : 'NOT COLLECTED')}
Size/Bedrooms: ${lead?.size || 'NOT COLLECTED'}
Budget: ${lead?.budget ? `KES ${Number(lead.budget).toLocaleString()}` : 'NOT COLLECTED'}

=== CURRENT STAGE — WHAT TO ASK NEXT ===
${stage === 'need_interest' ? `
ASK: What they are looking for.
OPTIONS IN DATABASE: ${options.types?.join(', ') || 'Buy, Rent, Land'}
EXAMPLE: "Are you looking to Buy, Rent, or purchase Land?"
NEVER ask about types not in the database.` : ''}

${stage === 'need_name' ? `
ASK: Their name.
EXAMPLE: "Great! What is your name?"
Keep it simple and natural.` : ''}

${stage === 'need_location' ? `
ASK: Which location/area they prefer.
AVAILABLE LOCATIONS: ${options.locations?.join(', ') || 'fetching...'}
EXAMPLE: "Which area interests you? We have properties in: ${options.locations?.join(', ') || '...'}"
ONLY mention these exact locations. Nothing else.` : ''}

${stage === 'need_offplan' ? `
ASK: Ready or Off-Plan preference.
${options.hasOffplan && options.hasReady ? 'BOTH options available in database.' : ''}
${options.hasOffplan && !options.hasReady ? 'ONLY Off-Plan available. Inform user and set is_offplan to true automatically.' : ''}
${!options.hasOffplan && options.hasReady ? 'ONLY Ready properties available. Inform user and set is_offplan to false automatically.' : ''}
EXAMPLE: "Are you looking for a ready property or an off-plan development?"` : ''}

${stage === 'need_completion' ? `
ASK: Preferred completion date.
AVAILABLE COMPLETION DATES IN DATABASE: ${options.completionDates?.join(', ') || 'various dates'}
EXAMPLE: "When would you like it completed? We have properties completing in: ${options.completionDates?.join(' or ') || '...'}"
ONLY show dates from the database above.` : ''}

${stage === 'need_size' ? `
ASK: Number of bedrooms or plot size.
AVAILABLE IN DATABASE FOR ${lead?.location?.toUpperCase() || 'THIS AREA'}: ${options.bedrooms?.join(', ') || options.plotSizes?.join(', ') || 'fetching...'}
EXAMPLE: "How many bedrooms? We have: ${options.bedrooms?.join(', ') || '...'} available in ${lead?.location || 'this area'}."
ONLY show bedroom options from database. Never mention options not in the list.` : ''}

${stage === 'need_budget' ? `
ASK: Budget range.
PRICE RANGE FOR THEIR CRITERIA: ${options.priceRange || 'various prices'}
EXAMPLE: "What is your budget? Properties matching your criteria range from ${options.priceRange || '...'}"
Always show the price range. Never ask blind.` : ''}

${stage === 'ready_to_search' ? `
ALL INFORMATION COLLECTED. 
ACTION MUST BE "search_properties".
Confirm their full preferences and say you are searching now.
Be enthusiastic but brief.` : ''}

=== DATABASE OPTIONS ===
Property Types: ${options.types?.join(', ') || 'Buy, Rent, Land'}
Locations Available: ${options.locations?.join(', ') || 'N/A'}
Bedroom Options: ${options.bedrooms?.join(', ') || 'N/A'}
Plot Sizes: ${options.plotSizes?.join(', ') || 'N/A'}
Price Range: ${options.priceRange || 'N/A'}
Off-Plan Available: ${options.hasOffplan ? 'YES' : 'NO'}
Ready Properties Available: ${options.hasReady ? 'YES' : 'NO'}
Completion Dates: ${options.completionDates?.join(', ') || 'N/A'}

=== AGENT ===
${agentName || 'Our Agent'} — ${agentPhone || 'N/A'}

=== HOW TO HANDLE UNCLEAR MESSAGES ===
NEVER say "I did not catch that."
Instead:
- If user gives a partial answer → extract what you can and confirm.
- If user asks a question → answer it using database info, then continue.
- If user says something unrelated → gently guide back to property search.
- If user says a number → interpret as bedrooms if in size stage, budget if in budget stage.
- If user says a location name → accept even if slightly misspelled (Westlands = Wesrlands, Kilimani = kilimani).

ALWAYS respond intelligently. ALWAYS move conversation forward.

=== JSON RESPONSE FORMAT ===
{
  "message": "your natural WhatsApp reply here",
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

VALID ACTIONS: continue | search_properties | booking | cancel_booking | human_handoff

EXTRACTION RULES:
- "bedrooms" must be a NUMBER (0=Studio, 1, 2, 3, 4, 5...)
- "budget" must be a NUMBER in KES (10M = 10000000, 100K = 100000)
- "interest" must be exactly: "Buy", "Rent", or "Land"
- "is_offplan" must be: true, false, or null
- "completion_range" is the exact completion date string from database (e.g. "December 2027")
- Only extract what user said in THIS message
- Set action "search_properties" ONLY when stage is "ready_to_search"
- Set action "booking" when user says Property1, Property2 etc.`;

    // Last 6 messages only for cost control
    const recentHistory = (conversationHistory || []).slice(-6);
    const messages = [
      ...recentHistory.map(m => ({
        role: m.role,
        content: String(m.content || '').slice(0, 400)
      })),
      { role: 'user', content: userMessage.slice(0, 600) }
    ];

    console.log('Calling Claude AI - stage:', stage);

    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: systemPrompt,
      messages
    });

    const raw = response.content?.[0]?.text || '';
    console.log('Claude raw:', raw.substring(0, 300));

    // Parse JSON
    let parsed;
    try {
      const cleaned = raw
        .replace(/```json/gi, '')
        .replace(/```/gi, '')
        .trim();

      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in response');

      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('JSON parse error:', parseError.message);
      // Smart fallback instead of "I did not catch that"
      return {
        message: `Let me make sure I understand — could you tell me a bit more about what you are looking for? 😊`,
        action: 'continue',
        extracted: {},
        confidence: 'low'
      };
    }

    // Clean null extracted values
    if (parsed.extracted) {
      Object.keys(parsed.extracted).forEach(key => {
        if (parsed.extracted[key] === null || parsed.extracted[key] === undefined) {
          delete parsed.extracted[key];
        }
      });
    }

    // Force search if stage is ready
    if (stage === 'ready_to_search' && parsed.action !== 'search_properties') {
      parsed.action = 'search_properties';
    }

    return parsed;

  } catch (error) {
    console.error('AI error:', error.message);
    return {
      message:
        `Sorry, I ran into a small issue. 🙏\n\n` +
        `Please contact our agent directly:\n` +
        `👤 ${agentName || 'Agent'}: ${agentPhone || 'N/A'}\n\n` +
        `Or reply *HI* to try again.`,
      action: 'human_handoff',
      extracted: {},
      confidence: 'low'
    };
  }
}

module.exports = { processAIConversation };