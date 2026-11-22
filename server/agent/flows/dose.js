// Basic dose call flow (A2.7). A first, minimal version of A4.1: enough for a simulated dose call
// to run from start to finish. A4.1 replaces it with the full flow (phrase bank, steps, retries,
// follow-ups, the 8-turn phone budget).
//
// Registered on the orchestrator as 'dose'. One AgentRun per call (session.runId): every turn's
// patient words, the agent's reply and every tool call are steps on it.
//
// Start the call with startDoseCall({ reminderId, trigger, channel }).

const mongoose = require('mongoose');
const Reminder = require('../../models/Reminder');
const Patient = require('../../models/Patient');
const { registerFlow, startSession } = require('../orchestrator');
const { registerTool } = require('../tools');
const { runLoop } = require('../loop');
const { loadPrompt } = require('../prompts');
const { startRun, addStep, finishRun } = require('../runs');
const { ist } = require('../tools/core');

const TOOLS = ['get_patient_context', 'get_dose_history', 'check_double_dose', 'mark_dose', 'notify_caregiver', 'end_call'];
// Before she has said anything, the agent can only look things up and end the call. Found in the
// live check: offered every tool on the opening turn, the model recorded the dose as taken before
// the patient had spoken. So mark_dose and notify_caregiver only exist once she has.
const OPENING_TOOLS = ['get_patient_context', 'get_dose_history', 'check_double_dose', 'end_call'];
const FOOD = { before: 'take it before food', after: 'take it after food', with: 'take it with food', any: 'no food rule' };
const TURN_TIMEOUT_MS = 25000;

// The agent ends the call by calling this, so "the call is over" is an action, not a guess from
// its wording.
registerTool({
  name: 'end_call',
  description: 'End the call. Call this once the dose is settled, after your last sentence to her.',
  inputSchema: {
    type: 'object',
    properties: { reason: { type: 'string', description: 'Why the call is ending, in a few words' } },
    required: ['reason'],
    additionalProperties: false,
  },
  approvalLevel: 0,
  run: async ({ reason }) => ({ ok: true, data: { ended: true, reason } }),
});

const log = (session, step) => {
  if (!session.runId) return Promise.resolve();
  return addStep(session.runId, step).catch((err) => console.error('[flow:dose] could not save step:', err.message));
};

// Runs the agent for one turn and turns its reply into orchestrator actions.
async function agentTurn(session, userMessage) {
  const s = session.state;
  s.messages.push({ role: 'user', content: userMessage });

  const result = await runLoop({
    tier: 'fast',
    system: s.system,
    promptVersion: s.promptVersion,
    messages: s.messages,
    tools: s.patientSpoke ? TOOLS : OPENING_TOOLS,
    ctx: { patientId: session.patientId, runId: session.runId, flow: 'dose' },
    timeoutMs: TURN_TIMEOUT_MS,
    onStep: (step) => log(session, step),
  });

  s.messages = result.messages;
  s.llmCalls += result.llmCalls;
  for (const k of ['inputTokens', 'outputTokens', 'reasoningTokens']) s.usage[k] += result.usage[k] || 0;
  s.model = result.model || s.model;
  if (result.outcome === 'queued_for_approval') s.queued = true;

  if (result.outcome === 'fallback') {
    s.ending = { outcome: 'fallback', fallbackReason: result.fallbackReason, error: result.error };
    return [{ type: 'fallback', reason: result.fallbackReason }];
  }

  const text = (result.text || '').trim();
  if (text) {
    s.messages.push({ role: 'assistant', content: text });
    s.transcript.push({ who: 'agent', text });
    await log(session, { tool: 'agent_said', input: {}, output: { ok: true, text }, ms: 0, at: new Date() });
  }

  // The call ends once the dose is settled: recorded, family contacted, already taken when the call
  // began, or end_call. Found in the live check: the model often said "Goodbye" without calling
  // end_call, so the call stayed open and it contacted the family a second time.
  const ok = (st, tool) => st.tool === tool && st.output && st.output.ok;
  const settled = result.steps.some(
    (st) =>
      ok(st, 'end_call') ||
      ok(st, 'mark_dose') ||
      ok(st, 'notify_caregiver') ||
      (!s.patientSpoke && ok(st, 'check_double_dose') && st.output.data && st.output.data.alreadyTaken),
  );
  if (settled) {
    s.ending = { outcome: s.queued ? 'queued_for_approval' : 'done' };
    return text ? [{ type: 'neutral', text }, { type: 'hangup' }] : [{ type: 'hangup' }];
  }
  if (!text) {
    s.ending = { outcome: 'fallback', fallbackReason: 'empty_reply' };
    return [{ type: 'fallback', reason: 'empty_reply' }];
  }
  // Phrase-bank lines come in Phase 3; until then every line is spoken in the neutral voice.
  return [{ type: 'neutral', text }, { type: 'listen' }];
}

registerFlow('dose', {
  start: (session) => agentTurn(session, '[The call has just connected. Begin.]'),

  turn: async (session, input) => {
    const said = input.transcript || (input.dtmf ? `(pressed key ${input.dtmf})` : '');
    session.state.patientSpoke = true;
    session.state.transcript.push({ who: 'patient', text: said });
    await log(session, { tool: 'patient_said', input: { text: said, asrConfidence: input.asrConfidence }, output: { ok: true }, ms: 0, at: new Date() });
    const msg = input.transcript ? `Patient said: "${input.transcript.replace(/"/g, "'")}"` : `Patient pressed key ${input.dtmf}.`;
    return agentTurn(session, msg);
  },

  // Called once when the call ends (hang-up or turn limit): closes the AgentRun.
  onEnd: async (session) => {
    if (!session.runId) return;
    const s = session.state;
    const ending = s.ending || { outcome: 'fallback', fallbackReason: session.turns > session.maxTurns ? 'turn_limit' : 'ended' };
    const last = [...s.transcript].reverse().find((t) => t.who === 'agent');
    await finishRun(session.runId, {
      outcome: ending.outcome,
      fallbackReason: ending.fallbackReason,
      error: ending.error,
      text: last ? last.text : '',
      model: s.model,
      promptVersion: s.promptVersion,
      llmCalls: s.llmCalls,
      usage: s.usage,
      ms: Date.now() - session.createdAt,
    }).catch((err) => console.error('[flow:dose] could not finish run:', err.message));
  },
});

// Starts a dose call for one Reminder. Returns { sessionId, runId, patientId, actions }.
async function startDoseCall({ reminderId, trigger = 'simulate', channel = 'text', turnBudgetMs }) {
  if (!mongoose.isValidObjectId(reminderId)) throw Object.assign(new Error('Not a valid reminder id'), { status: 400 });
  const reminder = await Reminder.findById(reminderId).populate('medicine');
  if (!reminder || !reminder.medicine) throw Object.assign(new Error('Reminder not found'), { status: 404 });
  const patient = await Patient.findById(reminder.patient).populate('user', 'name').lean();
  if (!patient) throw Object.assign(new Error('Patient not found'), { status: 404 });

  const med = reminder.medicine;
  const prompt = loadPrompt('base');
  const dose = loadPrompt('dose', {
    firstName: ((patient.user && patient.user.name) || 'there').split(' ')[0],
    medicine: med.name,
    dosage: med.dosage || '',
    type: med.type || 'medicine',
    dueTime: ist(reminder.scheduledTime),
    food: FOOD[med.mealTiming] || FOOD.any,
    reminderId: String(reminder._id),
  });
  const promptVersion = `${prompt.promptVersion}+${dose.promptVersion}`;

  const runId = await startRun({ trigger, patientId: patient._id, reminderId: reminder._id, flow: 'dose', promptVersion }).catch((err) => {
    console.error('[flow:dose] could not start run:', err.message);
    return null;
  });

  const { sessionId, actions } = await startSession({
    flow: 'dose',
    patientId: patient._id,
    reminderId: reminder._id,
    runId,
    channel,
    turnBudgetMs,
    init: (session) => {
      session.state = {
        system: `${prompt.text}\n\n${dose.text}`,
        promptVersion,
        messages: [],
        transcript: [],
        llmCalls: 0,
        usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
        model: undefined,
        queued: false,
        ending: null,
      };
    },
  });
  return { sessionId, runId: runId ? String(runId) : null, patientId: String(patient._id), actions };
}

module.exports = { startDoseCall };
