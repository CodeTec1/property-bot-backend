const Anthropic = require('@anthropic-ai/sdk');
const supabase = require('./supabase');

// Initialize client
function getAnthropicClient() {
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
  });
}

// ============================================
// Fetch tenant options
// ============================================
async function fetchTenantOptions(tenantId, interest, location) {
  try {
    const options = {};

    const { data: typeData } = await supabase
      .from('properties')
      .select('type')
      .eq('tenant_id', tenantId)
      .eq('available', true);

    if (typeData) {
      options.availableTypes = [...new Set(typeData.map(r => r.type).filter(Boolean))];
    }

    if (interest) {
      const { data: locData } = await supabase
        .from('properties')
        .select('location')
        .eq('tenant_id', tenantId)
        .eq('available', true)
        .ilike('type', interest);

      if (locData) {
        options.availableLocations = [...new Set(locData.map(r => r.location).filter(Boolean))];
      }
    }

    if (interest && location) {
      const { data: bedData } = await supabase
        .from('properties')
        .select('bedrooms, plot_size')
        .eq('tenant_id', tenantId)
        .eq('available', true)
        .ilike('type', interest)
        .ilike('location', location);

      if (bedData) {
        const beds = [...new Set(bedData.map(r => r.bedrooms).filter(b => b !== null))];
        options.availableBedrooms = beds.map(b => b === 0 ? 'Studio' : `${b} Bedroom${b > 1 ? 's' : ''}`);

        const plots = [...new Set(bedData.map(r => r.plot_size).filter(Boolean))];
        if (plots.length > 0) options.availablePlotSizes = plots;
      }

      const { data: priceData } = await supabase
        .from('properties')
        .select('price')
        .eq('tenant_id', tenantId)
        .eq('available', true)
        .ilike('type', interest)
        .ilike('location', location)
        .not('price', 'is', null);

      if (priceData && priceData.length > 0) {
        const prices = priceData.map(r => r.price).filter(p => p > 0);
        prices.sort((a, b) => a - b);

        options.priceRange = {
          min: prices[0],
          max: prices[prices.length - 1]
        };
      }
    }

    return options;
  } catch (error) {
    console.error('Error fetching tenant options:', error);
    return {};
  }
}

// ============================================
// MAIN FUNCTION
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
    const anthropic = getAnthropicClient();

    const messageText = userMessage.trim().toLowerCase();

    // ============================================
    // 🚨 HANDLE GREETINGS WITHOUT AI (SAVE MONEY)
    // ============================================
    if (['hi', 'hello', 'hey'].includes(messageText)) {
      return {
        message: `Hello 👋 Welcome to ${tenant.company_name}!\n\nWhat are you looking for today?`,
        action: "continue",
        extracted: {},
        confidence: "high"
      };
    }

    // ============================================
    // 🔥 LIMIT HISTORY (REDUCE COST)
    // ============================================
    const trimmedHistory = (conversationHistory || []).slice(-10);

    // Fetch DB options
    const options = await fetchTenantOptions(
      tenant.id,
      lead?.interest || null,
      lead?.location || null
    );

    // Known info
  const knownInfo = [];
if (lead?.name) knownInfo.push(`Name: ${lead.name}`);
if (lead?.interest) knownInfo.push(`Type: ${lead.interest}`);
if (lead?.location) knownInfo.push(`Location: ${lead.location}`);
if (lead?.budget) knownInfo.push(`Budget: ${lead.budget}`);
if (lead?.bedrooms) knownInfo.push(`Bedrooms: ${lead.bedrooms}`); 
if (lead?.size) knownInfo.push(`Size: ${lead.size}`);            

    // ============================================
    // 🧠 SYSTEM PROMPT (STRICT + CONTROLLED)
    // ============================================
    const systemPrompt = `
You are a real estate assistant for ${tenant.company_name}.

STRICT RULES:
- NEVER invent property details.
- NEVER hallucinate locations, prices, or features.
- ONLY use provided data.
- If unsure, ask a question.
- Keep replies under 60 words.
- Output ONLY valid JSON. No markdown. No backticks. No explanation.

AVAILABLE DATA:
${options.availableTypes?.join(', ') || 'N/A'}
${options.availableLocations?.join(', ') || ''}
${options.availableBedrooms?.join(', ') || ''}

KNOWN USER INFO:
${knownInfo.join('\n') || 'None'}

OUTPUT FORMAT:
{
  "message": "string",
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
    "slot_number": null
  },
  "confidence": "high"
}
`;

    // ============================================
    // BUILD MESSAGES (TRIM + SAFE)
    // ============================================
    const messages = [
      ...trimmedHistory.map(m => ({
        role: m.role,
        content: m.content.slice(0, 500)
      })),
      {
        role: 'user',
        content: userMessage.slice(0, 500)
      }
    ];

    // ============================================
    // CALL CLAUDE
    // ============================================
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      temperature: 0.3,
      system: systemPrompt,
      messages
    });

    const raw = response.content?.[0]?.text || '';
    console.log('Claude response:', raw);

    // ============================================
    // CLEAN + PARSE JSON
    // ============================================
    let parsed;

    try {
      const cleaned = raw
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();

      parsed = JSON.parse(cleaned);
    } catch (err) {
      console.error('JSON parse error:', err);

      return {
        message: "I didn’t quite get that. Could you rephrase?",
        action: "continue",
        extracted: {},
        confidence: "low"
      };
    }

    return parsed;

  } catch (error) {
    console.error('AI error:', error);

    return {
      message: `Something went wrong.\nPlease contact:\n${agentName || 'Agent'} - ${agentPhone || 'N/A'}`,
      action: "human_handoff",
      extracted: {},
      confidence: "low"
    };
  }
}

module.exports = { processAIConversation };