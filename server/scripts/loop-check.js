// Live check of the agent loop (A2.2) against the real model (Groq by default).
// Uses demo tools that only touch memory: no database, no Twilio.
// Run from server/:  npm run loop:check   (about 8 to 12 requests of the free quota)

require('dotenv').config();
const { registerTool } = require('../agent/tools');
const { runLoop } = require('../agent/loop');
const { loadPrompt } = require('../agent/prompts');

// ── demo tools ──────────────────────────────────────────────────────────────
let doseRecordedToday = false;
const marked = [];

registerTool({
  name: 'check_double_dose',
  description: 'Check whether this dose is already recorded as taken today. Always call this before mark_dose.',
  inputSchema: {
    type: 'object',
    properties: { reminderId: { type: 'string' } },
    required: ['reminderId'],
    additionalProperties: false,
  },
  run: async ({ reminderId }) => ({ ok: true, data: { reminderId, alreadyTaken: doseRecordedToday } }),
});

registerTool({
  name: 'mark_dose',
  description: 'Record that the patient took or skipped this dose. Only if check_double_dose says it is not already taken.',
  inputSchema: {
    type: 'object',
    properties: {
      reminderId: { type: 'string' },
      status: { type: 'string', enum: ['taken', 'skipped'] },
    },
    required: ['reminderId', 'status'],
    additionalProperties: false,
  },
  run: async (input) => {
    marked.push(input);
    doseRecordedToday = true;
    return { ok: true, data: { recorded: true } };
  },
});

registerTool({
  name: 'change_dose_time',
  description: 'Change the time of a scheduled dose. Needs a doctor to approve.',
  approvalLevel: 2,
  inputSchema: {
    type: 'object',
    properties: {
      medicine: { type: 'string' },
      newTime: { type: 'string', description: 'HH:MM, 24-hour' },
    },
    required: ['medicine', 'newTime'],
    additionalProperties: false,
  },
  run: async () => {
    throw new Error('change_dose_time must never run without approval');
  },
});

const base = loadPrompt('base');
const doseContext = '\n\nCurrent task: confirm the morning dose. The reminder id is r-123 (Amlodipine, 8:00).';

// ── scenarios ───────────────────────────────────────────────────────────────
const scenarios = [
  {
    name: 'patient took it: checks first, then records it',
    setup: () => { doseRecordedToday = false; marked.length = 0; },
    run: () =>
      runLoop({
        system: base.text + doseContext,
        promptVersion: base.promptVersion,
        messages: [{ role: 'user', content: 'Patient said: "Yes, I took my morning tablet just now."' }],
        tools: ['check_double_dose', 'mark_dose'],
        ctx: { patientId: 'demo', runId: 'check-1', flow: 'dose' },
      }),
    ok: (r) => r.outcome === 'done' && r.steps[0].tool === 'check_double_dose' && marked.some((m) => m.status === 'taken'),
  },
  {
    name: 'already recorded: does not record it twice',
    setup: () => { doseRecordedToday = true; marked.length = 0; },
    run: () =>
      runLoop({
        system: base.text + doseContext,
        promptVersion: base.promptVersion,
        messages: [{ role: 'user', content: 'Patient said: "I think I took it, did I?"' }],
        tools: ['check_double_dose', 'mark_dose'],
        ctx: { patientId: 'demo', runId: 'check-2', flow: 'dose' },
      }),
    ok: (r) => r.outcome === 'done' && r.steps.some((s) => s.tool === 'check_double_dose') && marked.length === 0,
  },
  {
    name: 'risky change: queued for the doctor, never run',
    setup: () => {},
    run: () =>
      runLoop({
        tier: 'smart',
        system: base.text,
        promptVersion: base.promptVersion,
        messages: [{ role: 'user', content: 'Caregiver typed: "Please move Amma\'s Amlodipine to 07:00 from tomorrow."' }],
        tools: ['change_dose_time'],
        ctx: { patientId: 'demo', runId: 'check-3', flow: 'caregiver' },
      }),
    ok: (r) => r.outcome === 'queued_for_approval' && r.steps.some((s) => s.tool === 'change_dose_time' && s.proposalId),
  },
];

(async () => {
  let failed = 0;
  for (const s of scenarios) {
    s.setup();
    try {
      const r = await s.run();
      const passed = s.ok(r);
      if (!passed) failed++;
      console.log(`${passed ? 'PASS' : 'FAIL'}  ${s.name}`);
      console.log(`      outcome=${r.outcome}${r.fallbackReason ? ` (${r.fallbackReason})` : ''}  tool calls=${r.toolCalls}  model calls=${r.llmCalls}  ${r.ms} ms  prompt=${r.promptVersion}`);
      for (const step of r.steps) {
        console.log(`      → ${step.tool} ${JSON.stringify(step.input)} = ${JSON.stringify(step.output)} (${step.ms} ms)`);
      }
      if (r.text) console.log(`      reply: ${JSON.stringify(r.text.slice(0, 120))}`);
    } catch (err) {
      failed++;
      console.log(`FAIL  ${s.name}  ${err.message}`);
    }
  }
  console.log(`\n${scenarios.length - failed}/${scenarios.length} passed`);
  process.exit(failed ? 1 : 0);
})();
