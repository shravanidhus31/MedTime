// Live check of the LLM adapter against the real provider (Groq by default).
// Needs GROQ_API_KEY in server/.env. Run from server/:  npm run llm:check
// Uses about 5 requests of the free quota.

require('dotenv').config();
const { chat, getProvider, modelFor } = require('../agent/llm');

const markDoseTool = {
  name: 'mark_dose',
  description: 'Record that the patient took or skipped a dose.',
  inputSchema: {
    type: 'object',
    properties: {
      reminderId: { type: 'string', description: 'The reminder being confirmed' },
      status: { type: 'string', enum: ['taken', 'skipped'] },
    },
    required: ['reminderId', 'status'],
    additionalProperties: false,
  },
};

// The per-turn label from A2.1 (intent, pill_mentioned, matches_expected, confidence).
const turnLabel = {
  name: 'turn_label',
  schema: {
    type: 'object',
    properties: {
      intent: { type: 'string', enum: ['done', 'cant_find', 'already_took', 'unsure', 'other'] },
      pill_mentioned: { type: ['string', 'null'] },
      matches_expected: { type: 'boolean' },
      confidence: { type: 'number' },
    },
    required: ['intent', 'pill_mentioned', 'matches_expected', 'confidence'],
    additionalProperties: false,
  },
};

const checks = [
  {
    name: 'fast tier: plain reply',
    run: () => chat({ tier: 'fast', messages: [{ role: 'user', content: 'Reply with exactly the word: ready' }] }),
    ok: (r) => /ready/i.test(r.text),
  },
  {
    name: 'fast tier: tool call',
    run: () =>
      chat({
        tier: 'fast',
        system: 'You record medicine doses. The current reminder id is r-123.',
        messages: [{ role: 'user', content: 'Patient said: "Yes, I took my morning tablet just now."' }],
        tools: [markDoseTool],
      }),
    ok: (r) => r.toolCalls.length > 0 && r.toolCalls[0].name === 'mark_dose' && !r.toolCalls[0].error,
  },
  {
    name: 'fast tier: structured turn label',
    run: () =>
      chat({
        tier: 'fast',
        system: 'Label the patient reply. Expected pill: white Amlodipine.',
        messages: [{ role: 'user', content: 'Patient said: "I took the white one, the Amlodipine."' }],
        jsonSchema: turnLabel,
      }),
    ok: (r) => r.json && r.json.intent === 'done',
  },
  {
    name: 'smart tier: plain reply',
    run: () => chat({ tier: 'smart', messages: [{ role: 'user', content: 'In one short sentence, why should a missed dose never be doubled?' }] }),
    ok: (r) => r.text.length > 0,
  },
  {
    name: 'safety tier: structured verdict (best-effort JSON)',
    run: () =>
      chat({
        tier: 'safety',
        system: 'Classify the patient utterance. Reply with JSON only: {"verdict": "ok" | "redflag", "category": string}.',
        messages: [{ role: 'user', content: 'Patient said: "I fell in the bathroom and my chest hurts."' }],
        jsonSchema: {
          name: 'verdict',
          schema: {
            type: 'object',
            properties: { verdict: { type: 'string', enum: ['ok', 'redflag'] }, category: { type: 'string' } },
            required: ['verdict', 'category'],
          },
        },
        timeoutMs: 15000,
      }),
    ok: (r) => r.json && r.json.verdict === 'redflag',
  },
];

(async () => {
  const provider = getProvider();
  console.log(`Provider: ${provider}  fast=${modelFor('fast')}  smart=${modelFor('smart')}  safety=${modelFor('safety')}\n`);
  let failed = 0;
  for (const check of checks) {
    try {
      const r = await check.run();
      const passed = check.ok(r);
      if (!passed) failed++;
      const detail = r.json ? JSON.stringify(r.json) : r.toolCalls.length ? JSON.stringify(r.toolCalls) : JSON.stringify(r.text.slice(0, 80));
      console.log(`${passed ? 'PASS' : 'FAIL'}  ${check.name}  (${r.ms} ms, ${r.attempts} attempt(s), stop=${r.stopReason}, tokens in/out ${r.usage.inputTokens}/${r.usage.outputTokens})`);
      console.log(`      ${detail}`);
    } catch (err) {
      failed++;
      console.log(`FAIL  ${check.name}  [${err.kind || 'error'}] ${err.message}`);
    }
  }
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  process.exit(failed ? 1 : 0);
})();
