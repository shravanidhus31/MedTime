// The dose call (A4.1). Replaces the basic A2.7 flow.
//
// Registered on the orchestrator as 'dose'. One AgentRun per call (session.runId): the patient's
// words, what the agent understood, every tool call and every line it said are steps on it.
//
// How a call goes (PRD call flow, plan section 6.1):
//   start: get_patient_context and check_double_dose run first. Already taken → "don't take
//          another one", no reminder. Otherwise the reminder line for this attempt (calm, firmer,
//          concerned) and listen.
//   each turn: the fast-tier model labels what she said (intent, pill mentioned, does it match),
//          or ruleLabel() if the model is unavailable; dosePolicy.decide() picks the lines, the
//          tools and the next phase; the tools run; the lines are said.
// The model only understands. What is said comes from the fixed lines (doseLines.js), so the
// family voice can only ever say approved lines (Phase 3), and the rules can't be skipped.
//
// Start the call with startDoseCall({ reminderId, trigger, channel }).

const mongoose = require('mongoose');
const Reminder = require('../../models/Reminder');
const Patient = require('../../models/Patient');
const { registerFlow, startSession } = require('../orchestrator');
const { registerTool, getTool } = require('../tools');
const { chat } = require('../llm');
const { loadPrompt } = require('../prompts');
const { startRun, addStep, finishRun } = require('../runs');
const { listCaregivers } = require('../../services/caregiverLinks');
const { notifyCaregivers } = require('../../services/caregiverAlerts');
const { snoozeDose, noteCaregiverInformed } = require('../../services/doseService');
const { line } = require('./doseLines');
const policy = require('./dosePolicy');

// Person B's ask_caregiver tool (C6): a question on the caregiver's dashboard.
if (!getTool('ask_caregiver')) registerTool(require('../tools/askCaregiver'));

const FLOW_VERSION = 'dose-flow@2';
const LABEL_TIMEOUT_MS = 3000; // inside the 4 s phone turn budget
// A label is a short JSON reply. gpt-oss counts its reasoning in this too, so not too tight, but
// well under the tier default (1024): Groq counts the requested maximum against the minute's budget.
const LABEL_MAX_TOKENS = 400;
const SNOOZE_MINUTES = 10;
const FOOD = { before: ' Please take it before food.', after: ' Please take it after food.', with: ' Please take it with food.', any: '' };

const LABEL_SCHEMA = {
  name: 'dose_turn_label',
  schema: {
    type: 'object',
    properties: {
      intent: { type: 'string', enum: policy.INTENTS },
      pill_mentioned: { type: ['string', 'null'] },
      matches_expected: { type: 'boolean' },
      confidence: { type: 'number' },
    },
    required: ['intent', 'pill_mentioned', 'matches_expected', 'confidence'],
    additionalProperties: false,
  },
};

// ── helpers ─────────────────────────────────────────────────────────────────

const log = (session, step) => {
  if (!session.runId) return Promise.resolve();
  return addStep(session.runId, step).catch((err) => console.error('[flow:dose] could not save step:', err.message));
};

const toolCtx = (session) => ({ patientId: String(session.patientId), runId: session.runId ? String(session.runId) : undefined, flow: 'dose', now: new Date() });

// Runs one registered tool and saves it as a step.
async function runTool(session, name, input) {
  const tool = getTool(name);
  const at = new Date();
  const t0 = Date.now();
  let output;
  try {
    output = tool ? await tool.run(input, toolCtx(session)) : { ok: false, error: `No tool "${name}"` };
  } catch (err) {
    output = { ok: false, error: err.message };
  }
  await log(session, { tool: name, input, output, ms: Date.now() - t0, at, approvalLevel: tool ? tool.approvalLevel : 0 });
  return output;
}

// "8:05 PM" in IST, for the caregiver's words.
function spokenTime(date) {
  const d = new Date(date.getTime() + 5.5 * 3600 * 1000);
  const h = d.getUTCHours();
  return `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// "morning" / "afternoon" / "evening" / "night", from the dose time in IST.
function timeOfDay(date) {
  const h = new Date(date.getTime() + 5.5 * 3600 * 1000).getUTCHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night';
}

// Speaks lines: the actions, plus an agent_said step with the words.
async function say(session, lineIds, then) {
  const s = session.state;
  const actions = lineIds.map((id) => line(id, s.slots));
  const text = actions.map((a) => a.text).join(' ');
  s.transcript.push({ who: 'agent', text });
  s.lastQuestion = actions.length ? actions[actions.length - 1].text : s.lastQuestion;
  await log(session, { tool: 'agent_said', input: { lines: lineIds }, output: { ok: true, text }, ms: 0, at: new Date(), label: 'action_taken', summaryText: text });
  return [...actions, { type: then }];
}

// What she meant: the fast-tier model's label, or the rules if the model is unavailable.
async function understand(session, text) {
  const s = session.state;
  const t0 = Date.now();
  let label;
  try {
    const prompt = loadPrompt('dose_label', {
      medicine: s.expected.medicine,
      pillDescribed: s.expected.pill ? ` (${s.expected.pill})` : '',
      question: s.lastQuestion || '',
    });
    const r = await chat({
      tier: 'fast',
      system: prompt.text,
      messages: [{ role: 'user', content: `Patient said: "${String(text).replace(/"/g, "'")}"` }],
      jsonSchema: LABEL_SCHEMA,
      timeoutMs: LABEL_TIMEOUT_MS,
      maxTokens: LABEL_MAX_TOKENS,
    });
    s.llmCalls += 1;
    for (const k of ['inputTokens', 'outputTokens', 'reasoningTokens']) s.usage[k] += (r.usage && r.usage[k]) || 0;
    s.model = r.model || s.model;
    if (!r.json) throw new Error('no label in the reply');
    label = { ...r.json, source: 'model' };
  } catch (err) {
    label = { ...policy.ruleLabel(text, s.expected), fallbackReason: err.message };
  }
  // The pill match is rule-first: her words name the medicine or describe the pill (record data).
  // A model "match" only counts when the model also says which pill she mentioned (it helps with
  // Hindi/Marathi descriptions the rule doesn't know). Found in the live check: the model said
  // "matches" for "Yes, I have taken it" (no pill named) and "no match" for "the small white one".
  const ruleMatch = policy.matchesExpected(text, s.expected);
  label.matches_expected = ruleMatch || (label.source === 'model' && label.matches_expected === true && !!label.pill_mentioned);
  const normal = policy.normaliseLabel(label);
  await log(session, { tool: 'understand', input: { text }, output: { ok: true, ...normal, source: label.source, fallbackReason: label.fallbackReason }, ms: Date.now() - t0, at: new Date(), label: 'agent_noticed', summaryText: `Understood: ${normal.intent}${normal.pill_mentioned ? ` (${normal.pill_mentioned})` : ''}` });
  return normal;
}

// The caregiver message and dashboard question for each `why` code from the policy.
function caregiverWords(s, why) {
  const { name, medicine } = s.slots;
  const when = s.dueTime;
  switch (why) {
    case 'claims_taken_not_recorded':
      return {
        message: `${name} says the ${when} ${medicine} was already taken, but it isn't recorded. ${name} was asked not to take another one. Please check.`,
        question: `Did ${name} take the ${when} ${medicine}? ${name} says yes, but it isn't recorded.`,
      };
    case 'unsure':
      return { message: `${name} couldn't confirm which tablet was taken for the ${when} ${medicine}, and was asked not to take any more. Please check.` };
    case 'refused':
      return { message: `${name} didn't want to take the ${when} ${medicine}. It is recorded as skipped.` };
    default:
      return { message: `${name} needs help with the ${when} ${medicine}. Please call.` };
  }
}

// Runs the tools the policy asked for. Returns whether any caregiver call was placed.
async function runDecisionTools(session, tools) {
  const s = session.state;
  let informed = false;
  for (const t of tools) {
    if (t.name === 'mark_dose') {
      const r = await runTool(session, 'mark_dose', { reminderId: s.reminderId, status: t.input.status });
      if (r.ok) s.recorded = t.input.status;
    } else if (t.name === 'notify_caregiver') {
      const r = await runTool(session, 'notify_caregiver', { reason: t.input.reason, message: caregiverWords(s, t.input.why).message });
      if (r.ok) informed = true;
    } else if (t.name === 'ask_caregiver') {
      const q = caregiverWords(s, t.input.why).question;
      if (q) await runTool(session, 'ask_caregiver', { question: q, choices: ['Yes, it was taken', 'No, not taken', "I'll check with them"] });
    }
  }
  return informed;
}

// ── the flow ────────────────────────────────────────────────────────────────

registerFlow('dose', {
  start: async (session) => {
    const s = session.state;
    await runTool(session, 'get_patient_context', {});
    const check = await runTool(session, 'check_double_dose', { reminderId: s.reminderId });
    if (check.ok && check.data && check.data.alreadyTaken) {
      s.ending = { outcome: 'done' };
      s.settled = true;
      return say(session, ['dose.already_done'], 'hangup');
    }
    return say(session, [policy.greetLine(s.attempt)], 'listen');
  },

  turn: async (session, input) => {
    const s = session.state;
    const said = input.transcript || (input.dtmf ? `(pressed key ${input.dtmf})` : '');
    s.transcript.push({ who: 'patient', text: said });
    await log(session, { tool: 'patient_said', input: { text: said, asrConfidence: input.asrConfidence }, output: { ok: true }, ms: 0, at: new Date(), label: 'patient_said', summaryText: said });

    // Keypad: 1 = taken (the check question still follows), 2 = later.
    let label;
    if (!input.transcript && input.dtmf === '1') label = { intent: 'taken', pill_mentioned: null, matches_expected: false, confidence: 1 };
    else if (!input.transcript && input.dtmf === '2') label = { intent: 'later', pill_mentioned: null, matches_expected: false, confidence: 1 };
    else label = await understand(session, said);

    const info = {
      ...s.info,
      attempt: s.attempt,
      turnsLeft: session.maxTurns - session.turns,
      unsafe: !!(input.safety && input.safety.verdict === 'unsafe'),
    };
    if (s.policy.phase === 'reminder' && label.intent === 'already_took') {
      const check = await runTool(session, 'check_double_dose', { reminderId: s.reminderId });
      info.recorded = !!(check.ok && check.data && check.data.alreadyTaken);
    }

    const d = policy.decide(s.policy, label, info);
    s.policy = d.state;

    const informed = await runDecisionTools(session, d.tools);
    if (d.informCaregiver && informed) await noteCaregiverInformed(s.reminderId);
    if (d.snooze) await snoozeDose(s.reminderId, SNOOZE_MINUTES);

    if (d.end) {
      s.settled = true;
      s.ending = { outcome: 'done' };
    }
    return say(session, d.say, d.end ? 'hangup' : 'listen');
  },

  // Called once when the call ends (hang-up, turn limit, expiry): closes the AgentRun. If the
  // call hit the turn limit before the dose was settled, the orchestrator has told her "someone
  // from your family will call you", so the caregiver is phoned here.
  onEnd: async (session) => {
    const s = session.state;
    if (!s.settled && !session.emergency && session.turns > session.maxTurns) {
      const r = await notifyCaregivers({ patientId: session.patientId, reason: 'handover', message: caregiverWords(s, 'handover').message, runId: session.runId })
        .catch((err) => ({ ok: false, error: err.message }));
      if (r.ok) await noteCaregiverInformed(s.reminderId).catch(() => {});
      s.ending = { outcome: 'done', fallbackReason: 'turn_limit' };
    }
    if (!session.runId) return;
    // A red flag ends the dose part of the call; 'red_flag' is what Person B's journal looks for.
    const ending = session.emergency
      ? { outcome: 'red_flag', fallbackReason: session.emergency.category }
      : s.ending || { outcome: 'fallback', fallbackReason: 'ended' };
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

// The slot values for this patient's lines (doseLines.js). patient.user must be populated.
// Free text from the medicine form, made speakable: trimmed, no trailing full stop, and a lower-case
// first letter so it reads inside a sentence ("Kitchen table" → "kitchen table").
function phrase(text) {
  const t = String(text || '').trim().replace(/[.\s]+$/, '');
  return t ? t[0].toLowerCase() + t.slice(1) : '';
}

function buildSlots({ med, patient, caregiver, scheduledTime }) {
  return {
    name: ((patient.user && patient.user.name) || 'there').split(' ')[0],
    medicine: med.name,
    pill: phrase(med.pillDescription),
    slot: timeOfDay(scheduledTime),
    box: String(med.pillboxSlot || '').trim().replace(/\s*\/\s*/g, ', '),
    food: FOOD[med.mealTiming] || '',
    caregiver: caregiver ? caregiver.name.split(' ')[0] : 'your family',
    location: phrase(med.locationHint),
  };
}

// Every line a dose call about this medicine can say, for this patient (A3.1): the voice server
// renders them before the call. scheduledTime: the dose's time (picks "morning"/"evening").
async function doseLineTexts({ med, patient, scheduledTime = new Date() }) {
  const { LINES, render } = require('./doseLines');
  const caregiver = (await listCaregivers(patient._id)).find((c) => c.role !== 'doctor' && c.name);
  const slots = buildSlots({ med, patient, caregiver, scheduledTime });
  return Object.keys(LINES).map((id) => render(id, slots));
}

// Starts a dose call for one Reminder. Returns { sessionId, runId, patientId, actions }.
async function startDoseCall({ reminderId, trigger = 'simulate', channel = 'text', turnBudgetMs }) {
  if (!mongoose.isValidObjectId(reminderId)) throw Object.assign(new Error('Not a valid reminder id'), { status: 400 });
  const reminder = await Reminder.findById(reminderId).populate('medicine');
  if (!reminder || !reminder.medicine) throw Object.assign(new Error('Reminder not found'), { status: 404 });
  const patient = await Patient.findById(reminder.patient).populate('user', 'name').lean();
  if (!patient) throw Object.assign(new Error('Patient not found'), { status: 404 });

  const med = reminder.medicine;
  const caregiver = (await listCaregivers(patient._id)).find((c) => c.role !== 'doctor' && c.name);
  const label = loadPrompt('dose_label', { medicine: '', pillDescribed: '', question: '' });
  const promptVersion = `${FLOW_VERSION}+${label.promptVersion}`;

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
        reminderId: String(reminder._id),
        attempt: Math.max(1, reminder.attempts || 0),
        dueTime: spokenTime(reminder.scheduledTime),
        slots: buildSlots({ med, patient, caregiver, scheduledTime: reminder.scheduledTime }),
        expected: { medicine: med.name, pill: med.pillDescription || '' },
        info: { hasLocation: !!med.locationHint, hasPillbox: !!med.pillboxSlot, hasPill: !!med.pillDescription },
        policy: policy.newState(),
        promptVersion,
        transcript: [],
        lastQuestion: '',
        llmCalls: 0,
        usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
        model: undefined,
        settled: false,
        recorded: null,
        ending: null,
      };
    },
  });
  return { sessionId, runId: runId ? String(runId) : null, patientId: String(patient._id), actions };
}

module.exports = { startDoseCall, doseLineTexts, LABEL_SCHEMA };
