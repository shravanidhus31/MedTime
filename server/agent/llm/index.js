// LLM adapter (A2.1). The one way the agent talks to a model.
//
//   const { chat } = require('./agent/llm');
//   const reply = await chat({ tier: 'fast', system, messages, tools });
//
// Flows and tools ask for a tier ('fast' | 'smart' | 'safety'), never a provider or a model.
// The provider is LLM_PROVIDER in .env (groq by default).
//
// Messages (provider-neutral):
//   { role: 'user', content: '...' }
//   { role: 'assistant', content: '...', toolCalls?: [{ id, name, input }] }
//   { role: 'tool', toolCallId, name, content }        // content: string or object
// Tools follow contract C1: { name, description, inputSchema, ... } (other fields are ignored here).
// jsonSchema: { name, schema } for a structured reply. Can't be combined with tools (Groq limit).
//
// Returns { text, toolCalls[], stopReason, usage, json?, provider, model, attempts, ms }.
//   toolCalls[i] = { id, name, input, error? }: `error` is set when the call failed our schema check.
//   stopReason: 'end' | 'tool_use' | 'max_tokens' | 'refusal' | other provider value
// Throws LlmError on failure. During a call, the caller falls back to the keypad flow.

const { LlmError } = require('./errors');
const { TIERS, TIER_DEFAULTS, getProvider, modelFor } = require('./config');
const { validateAgainst, parseJson } = require('./validate');

const BACKENDS = {
  groq: require('./groq'),
  anthropic: require('./anthropic'),
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MIN_ATTEMPT_MS = 300; // don't start a retry with less time than this left

async function chat({
  tier,
  system,
  messages,
  tools,
  jsonSchema,
  timeoutMs,
  maxTokens,
  effort,
  maxAttempts = 2,
} = {}) {
  if (!TIERS.includes(tier)) {
    throw new LlmError('config', `Unknown tier "${tier}". Use one of: ${TIERS.join(', ')}.`);
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new LlmError('config', 'chat() needs at least one message.');
  }
  if (tools && tools.length && jsonSchema) {
    throw new LlmError('config', 'Ask for tools or a JSON schema, not both in one call (Groq does not support it).');
  }

  const provider = getProvider();
  const backend = BACKENDS[provider];
  if (!backend) {
    throw new LlmError('config', `Unknown LLM_PROVIDER "${provider}". Use groq or anthropic.`);
  }
  const model = modelFor(tier, provider);
  const defaults = TIER_DEFAULTS[tier];
  const started = Date.now();
  const deadline = started + (timeoutMs ?? defaults.timeoutMs);

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < MIN_ATTEMPT_MS) break;

    try {
      const result = await backend.complete(
        {
          model,
          system,
          messages,
          tools,
          jsonSchema,
          maxTokens: maxTokens ?? defaults.maxTokens,
          effort: effort ?? defaults.effort,
        },
        { timeoutMs: remaining },
      );

      if (jsonSchema && result.stopReason !== 'refusal') {
        result.json = readJson(result.text, jsonSchema.schema);
      }
      return { ...result, provider, model, attempts: attempt, ms: Date.now() - started };
    } catch (err) {
      lastError = err instanceof LlmError ? err : new LlmError('connection', String(err && err.message), { cause: err });
      if (!lastError.retryable || attempt === maxAttempts) throw lastError;

      const wait = lastError.retryAfterMs ?? 250 * 2 ** (attempt - 1);
      if (Date.now() + wait + MIN_ATTEMPT_MS > deadline) throw lastError; // no time left to retry
      await sleep(wait);
    }
  }
  throw lastError || new LlmError('timeout', `No time left for the ${tier} tier call.`);
}

// Structured replies are parsed and checked against the schema in our own code.
function readJson(text, schema) {
  const parsed = parseJson(text);
  if (!parsed.ok) throw new LlmError('invalid_output', `Structured reply was ${parsed.error}`);
  const valid = validateAgainst(schema, parsed.value);
  if (!valid.ok) throw new LlmError('invalid_output', `Structured reply doesn't match the schema: ${valid.error}`);
  return parsed.value;
}

module.exports = { chat, LlmError, TIERS, getProvider, modelFor };
