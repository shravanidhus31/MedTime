// Which model serves which tier. Code only ever asks for a tier (contract C11).

const TIERS = ['fast', 'smart', 'safety'];

const DEFAULT_MODELS = {
  groq: {
    fast: 'openai/gpt-oss-20b',
    smart: 'openai/gpt-oss-120b',
    safety: 'openai/gpt-oss-safeguard-20b',
  },
  anthropic: {
    fast: 'claude-haiku-5-5',
    smart: 'claude-sonnet-5-5',
    safety: 'claude-haiku-5-5',
  },
};

// Per-tier defaults. Callers can override any of them per call.
// timeoutMs covers the whole chat() call, including any retry.
// maxTokens includes the model's reasoning tokens on gpt-oss, so it is kept generous.
const TIER_DEFAULTS = {
  fast: { timeoutMs: 4000, maxTokens: 1024, effort: 'low' }, // live call turns: 4 s budget (A2.1)
  smart: { timeoutMs: 60000, maxTokens: 4096, effort: 'medium' }, // background work
  safety: { timeoutMs: 4000, maxTokens: 1024, effort: 'low' }, // safety screen, runs inside a call turn
};

function getProvider() {
  return (process.env.LLM_PROVIDER || 'groq').trim().toLowerCase();
}

function modelFor(tier, provider = getProvider()) {
  const fromEnv = process.env[`LLM_MODEL_${tier.toUpperCase()}`];
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  const defaults = DEFAULT_MODELS[provider];
  return defaults ? defaults[tier] : undefined;
}

module.exports = { TIERS, DEFAULT_MODELS, TIER_DEFAULTS, getProvider, modelFor };
