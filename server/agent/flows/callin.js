// The call-in flow (Feature 7, plan 6.2), on the agent runtime, so "Did I take my pills?" works on
// the voice call like the dose call (integration of Person B's B11, 22 Nov).
//
// Registered on the orchestrator as 'callin'. The answers come from Person B's logic
// (callinFlow.js handleCallinQuestion: classify, look up the dose log or life notes, fixed dose
// rules). This flow adds what plan 6.2 needs around it:
//   - a dose that is not recorded and still due → the dose flow starts in the same call
//     (switchToDose), so the double-dose check applies; it used to stop at "Shall I check?"
//   - the caregiver is really phoned when the answer says so (once per call)
//   - one follow-up question at most, then a hand-over to the caregiver
//   - "Is there anything else?" after an answer, and goodbye on "no"
//   - red flags: the orchestrator's emergency mode, as on every call
//
// Start a call-in with startCallinCall({ patientId, trigger, channel }).

const mongoose = require('mongoose');
const Patient = require('../../models/Patient');
const { registerFlow, startSession } = require('../orchestrator');
const { startRun, addStep, finishRun } = require('../runs');
const { listCaregivers } = require('../../services/caregiverLinks');
const { notifyCaregivers } = require('../../services/caregiverAlerts');
const { handleCallinQuestion } = require('./callinFlow');
const { switchToDose } = require('./dose');

// The call-in's own fixed lines (neutral voice until the phrase bank, A5).
const LINES = {
  greet: (s) => `Hello ${s.name}. This is MedTime. What would you like to know?`,
  more: () => 'Is there anything else?',
  bye: (s) => `All right. Goodbye, ${s.name}.`,
  handover: (s) => `I'll ask ${s.caregiver} to call you. Goodbye.`,
  doseBridge: () => "That dose isn't recorded yet, so let's do it together now.",
};
const callinLineTexts = (s) => Object.values(LINES).map((f) => f(s));

const log = (session, step) => {
  if (!session.runId) return Promise.resolve();
  return addStep(session.runId, { at: new Date(), ms: 0, ...step }).catch((err) => console.error('[flow:callin] could not save step:', err.message));
};

const say = async (session, texts, then) => {
  const text = texts.join(' ');
  session.state.transcript.push({ who: 'agent', text });
  await log(session, { tool: 'agent_said', input: {}, output: { ok: true, text }, label: 'action_taken', summaryText: text });
  return [...texts.map((t) => ({ type: 'neutral', text: t })), { type: then }];
};

const isDone = (t) => /^\s*(no\b|nope|nothing|that'?s all|that is all|no,? thank|bye|goodbye|thank you|thanks)/i.test(t || '');

async function informCaregiver(session, question, reply, intent) {
  const s = session.state;
  if (s.informed) return;
  s.informed = true;
  const r = await notifyCaregivers({
    patientId: session.patientId,
    reason: intent === 'doses' ? 'unsure_dose' : 'other',
    message: `${s.name} called MedTime and asked: "${String(question).slice(0, 120)}". The answer was: "${String(reply).slice(0, 140)}" Please check with ${s.name}.`,
    runId: session.runId,
  }).catch((err) => ({ ok: false, error: err.message }));
  await log(session, { tool: 'notify_caregiver', input: { reason: intent === 'doses' ? 'unsure_dose' : 'other' }, output: r });
}

const callinFlow = {
  start: (session) => say(session, [LINES.greet(session.state)], 'listen'),

  turn: async (session, input) => {
    const s = session.state;
    const text = (input.transcript || '').trim();
    s.transcript.push({ who: 'patient', text });
    await log(session, { tool: 'patient_said', input: { text, asrConfidence: input.asrConfidence }, output: { ok: true }, label: 'patient_said', summaryText: text });
    const lastTurn = session.turns >= session.maxTurns;

    if (s.awaitingMore && isDone(text)) {
      s.ending = { outcome: 'done' };
      return say(session, [LINES.bye(s)], 'hangup');
    }

    // After a follow-up question, search again with what she added (plan 6.2: "search again with
    // other words"); if that still finds nothing, hand over instead of guessing.
    const question = s.followUpFor ? `${s.followUpFor} ${text}` : text;
    const afterFollowUp = !!s.followUpFor;
    s.followUpFor = null;
    const r = await handleCallinQuestion({ patientId: session.patientId, question, runId: session.runId });
    await log(session, { tool: 'callin_answer', input: { question }, output: { intent: r.intent, action: r.action || null, done: !!r.done, source: r.source || null, unanswered: !!r.unanswered } });

    if (afterFollowUp && (r.requiresFollowUp || r.unanswered)) {
      await informCaregiver(session, question, 'not found in the notes or the dose log', r.intent);
      s.ending = { outcome: 'done', fallbackReason: 'handover' };
      return say(session, [LINES.handover(s)], 'hangup');
    }

    // Not recorded and still due: the dose flow takes over in this call (double-dose check first).
    if (r.action === 'start_dose_flow' && r.reminderId) {
      const bridge = await say(session, [LINES.doseBridge()], 'listen');
      const dose = await switchToDose(session, r.reminderId);
      return [...bridge.filter((a) => a.type !== 'listen'), ...dose];
    }

    if (r.requiresFollowUp) {
      s.followUps += 1;
      s.followUpFor = question;
      if (s.followUps >= 2 || lastTurn) { // one follow-up only, then the caregiver
        await informCaregiver(session, text, r.reply, r.intent);
        s.ending = { outcome: 'done', fallbackReason: 'handover' };
        return say(session, [LINES.handover(s)], 'hangup');
      }
      return say(session, [r.reply], 'listen');
    }

    if (r.action === 'notify_caregiver') await informCaregiver(session, text, r.reply, r.intent);

    if (r.done) {
      if (lastTurn) {
        s.ending = { outcome: 'done' };
        return say(session, [r.reply, LINES.bye(s)], 'hangup');
      }
      s.awaitingMore = true;
      return say(session, [r.reply, LINES.more()], 'listen');
    }
    s.awaitingMore = false;
    return say(session, [r.reply], 'listen');
  },

  onEnd: async (session) => {
    if (!session.runId) return;
    const s = session.state;
    const ending = session.emergency
      ? { outcome: 'red_flag', fallbackReason: session.emergency.category }
      : s.ending || { outcome: 'done', fallbackReason: 'ended' };
    const last = [...s.transcript].reverse().find((t) => t.who === 'agent');
    await finishRun(session.runId, { outcome: ending.outcome, fallbackReason: ending.fallbackReason, text: last ? last.text : '', llmCalls: 0, usage: {}, ms: Date.now() - session.createdAt })
      .catch((err) => console.error('[flow:callin] could not finish run:', err.message));
  },
};
registerFlow('callin', callinFlow);

// Starts a call-in for one patient. Returns { sessionId, runId, patientId, actions, name, caregiver }.
async function startCallinCall({ patientId, trigger = 'callin', channel = 'text', turnBudgetMs }) {
  if (!mongoose.isValidObjectId(patientId)) throw Object.assign(new Error('Not a valid patient id'), { status: 400 });
  const patient = await Patient.findById(patientId).populate('user', 'name').lean();
  if (!patient) throw Object.assign(new Error('Patient not found'), { status: 404 });
  const caregiver = (await listCaregivers(patient._id)).find((c) => c.role !== 'doctor' && c.name);
  const name = ((patient.user && patient.user.name) || 'there').split(' ')[0];
  const cg = caregiver ? caregiver.name.split(' ')[0] : 'your family';

  const runId = await startRun({ trigger, patientId: patient._id, flow: 'callin', promptVersion: 'callin-flow@1' }).catch(() => null);
  const { sessionId, actions } = await startSession({
    flow: 'callin',
    patientId: patient._id,
    runId,
    channel,
    turnBudgetMs,
    init: (session) => {
      session.state = { name, caregiver: cg, followUps: 0, followUpFor: null, informed: false, awaitingMore: false, transcript: [], ending: null };
    },
  });
  return { sessionId, runId: runId ? String(runId) : null, patientId: String(patient._id), actions, name, caregiver: cg };
}

module.exports = { startCallinCall, callinLineTexts };
