// Anthropic back end (optional, for final runs and the demo).
// Not built yet: development uses Groq. Fill this in with @anthropic-ai/sdk when a Claude key
// is added, following the API notes in docs/TASKS_PERSON_A.md (A2.1). It must return the same
// shape as groq.complete(): { text, toolCalls[], stopReason, usage }.

const { LlmError } = require('./errors');

async function complete() {
  throw new LlmError('config', 'The Anthropic back end is not built yet. Set LLM_PROVIDER=groq.');
}

module.exports = { name: 'anthropic', complete };
