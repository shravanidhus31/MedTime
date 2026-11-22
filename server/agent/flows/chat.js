// The weekly chat call (Feature 1, plan 6.4 / 6.5): once a week, the same open question, so her
// language can be compared with her own earlier weeks the way the speech-screening paper measures it
// (it stands in for the paper's picture-description task, which can't be shown over the phone).
//
// On/off per patient (Patient.weeklyChatEnabled, off by default: measuring someone's speech is
// opt-in). Registered on the orchestrator as 'chat'. The agent decides when it has heard enough:
//   start   "Hello {name}. … Tell me, how do you make your morning tea?"
//   turn    under 50 words → "That sounds lovely. Tell me a bit more." (at most twice, then thanks)
//           "not now" / "I don't want to" → "All right, another time. Goodbye." (nothing measured)
//           two silences → goodbye; red flags → the orchestrator's emergency mode, as on every call
//   end     ≥ 50 words → the paper's measures (agent/languageMeasures.js) + speech rate and time
//           before answering when the browser sent word timings → Observation rows (callType
//           'chat'); under 50 words → nothing measured, and the run says so. Concerns she mentions
//           go to the Planner like any call.
// Start with startChatCall({ patientId, trigger, channel }).

const mongoose = require('mongoose');
const Patient = require('../../models/Patient');
const Observation = require('../../models/Observation');
const { registerFlow, startSession } = require('../orchestrator');
const { startRun, addStep, finishRun } = require('../runs');
const { listCaregivers } = require('../../services/caregiverLinks');
const { languageMeasures, MIN_WORDS, tokens } = require('../languageMeasures');
const { planFollowUps } = require('../planner');
const { istBlock } = require('../observations');

const MAX_MORE = 2;
const LINES = {
  en: {
    greet: (s) => `Hello ${s.name}. This is MedTime, just calling for a chat. Tell me, how do you make your morning tea?`,
    more1: () => 'That sounds lovely. Tell me a bit more.',
    more2: () => 'And then what do you do?',
    thanks: (s) => `Thank you, ${s.name}. I enjoyed hearing that. Goodbye for now.`,
    later: () => "All right. We'll talk another time. Goodbye.",
  },
  hi: {
    greet: (s) => `नमस्ते ${s.name} जी। मैं MedTime से बात कर रही हूँ, बस थोड़ी बातचीत के लिए। बताइए, आप सुबह की चाय कैसे बनाते हैं?`,
    more1: () => 'यह तो बहुत अच्छा है। थोड़ा और बताइए।',
    more2: () => 'और फिर आप क्या करते हैं?',
    thanks: (s) => `धन्यवाद ${s.name} जी। आपसे बात करके अच्छा लगा। फिर बात करेंगे।`,
    later: () => 'ठीक है। फिर कभी बात करेंगे। नमस्ते।',
  },
};
const chatLineTexts = (s) => Object.values(LINES[s.lang] || LINES.en).map((f) => f(s));
// "Not now": a clear phrase in a short answer, or a plain "no" on its own (not "No, first I boil…").
const DECLINE = /(not now|i'?m busy|i am busy|don'?t want to|do not want to|call (me )?later|another time|बाद में|अभी नहीं|abhi nahi)/i;
const JUST_NO = /^\s*(no|nope|nahi|नहीं)\W*$/i;

const log = (session, step) => (session.runId ? addStep(session.runId, { at: new Date(), ms: 0, ...step }).catch(() => {}) : Promise.resolve());

async function say(session, key, then) {
  const s = session.state;
  const text = (LINES[s.lang] || LINES.en)[key](s);
  s.transcript.push({ who: 'agent', text });
  await log(session, { tool: 'agent_said', input: { lines: [`chat.${key}`] }, output: { ok: true, text }, label: 'action_taken', summaryText: text });
  return [{ type: 'play', lineId: `chat.${key}`, text, lang: s.lang }, { type: then }];
}

const chatFlow = {
  start: (session) => say(session, 'greet', 'listen'),

  turn: async (session, input) => {
    const s = session.state;
    const text = (input.transcript || '').trim();
    s.transcript.push({ who: 'patient', text });
    await log(session, { tool: 'patient_said', input: { text, asrConfidence: input.asrConfidence, timing: input.timing }, output: { ok: true }, label: 'patient_said', summaryText: text || '(says nothing)' });
    if (input.timing) s.timings.push(input.timing);

    if (!text) {
      s.silences += 1;
      if (s.silences >= 2) { s.ending = 'no_answer'; return say(session, 'later', 'hangup'); }
      return say(session, s.more === 0 ? 'more1' : 'more2', 'listen');
    }
    // "not now" as a short first answer (not "No, first I boil the water…")
    if (s.words === 0 && ((DECLINE.test(text) && tokens(text).length <= 8) || JUST_NO.test(text))) { s.ending = 'declined'; return say(session, 'later', 'hangup'); }
    s.answers.push(text);
    s.words += tokens(text).length;
    if (s.words >= MIN_WORDS || s.more >= MAX_MORE || session.turns >= session.maxTurns) {
      s.ending = 'done';
      return say(session, 'thanks', 'hangup');
    }
    s.more += 1;
    return say(session, s.more === 1 ? 'more1' : 'more2', 'listen');
  },

  onEnd: async (session) => {
    const s = session.state;
    let measured = null;
    try {
      measured = await logChatMeasures(session);
    } catch (err) {
      console.error('[flow:chat] could not measure:', err.message);
    }
    if (s.answers.length) planFollowUps({ patientId: session.patientId, runId: session.runId, lines: s.answers }).catch(() => {});
    if (!session.runId) return;
    await finishRun(session.runId, {
      outcome: session.emergency ? 'red_flag' : 'done',
      fallbackReason: session.emergency ? session.emergency.category : s.ending || 'ended',
      text: measured ? `Weekly chat: ${measured.wordCount} words measured.` : `Weekly chat: ${s.words} words, not measured (under ${MIN_WORDS}).`,
      llmCalls: 0, usage: {}, ms: Date.now() - session.createdAt,
    }).catch(() => {});
  },
};
registerFlow('chat', chatFlow);

// The paper's measures for this call (≥ 50 words), plus speech rate and time before answering when
// the browser sent timings. Returns the measures, or null when nothing was measured.
async function logChatMeasures(session) {
  const s = session.state;
  const all = s.answers.join(' ');
  const m = languageMeasures(all);
  if (!m) {
    await log(session, { tool: 'log_observation', input: { flow: 'chat' }, output: { ok: true, measured: false, words: s.words }, label: 'agent_noticed', summaryText: `Not measured: ${s.words} words (the paper's measures need at least ${MIN_WORDS}).` });
    return null;
  }
  const rows = { mtld: m.mtld, hdd: m.hdd, brunetW: m.brunetW, cttr: m.cttr, wordCount: m.wordCount, repeatedPhrasesCount: m.repeatedPhrasesCount, fillersCount: m.fillersCount };
  if (m.nounShare !== undefined) Object.assign(rows, { nounShare: m.nounShare, verbShare: m.verbShare });
  // browser calls: word timings from the voice pipeline (phone calls have none)
  const speechMs = s.timings.reduce((a, t) => a + (Number(t.speechMs) || 0), 0);
  const latencies = s.timings.map((t) => Number(t.latencyMs)).filter((x) => Number.isFinite(x) && x >= 0);
  if (speechMs > 3000) rows.speechRateWpm = Math.round((m.wordCount / speechMs) * 60000);
  if (latencies.length) rows.latencyMs = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  const at = new Date(session.createdAt || Date.now());
  await Observation.insertMany(Object.entries(rows).filter(([, v]) => typeof v === 'number').map(([metric, value]) => ({
    patient: session.patientId,
    callId: session.runId,
    callType: 'chat',
    source: 'code',
    metric,
    value,
    timeOfDay: istBlock(at),
    metadata: { flow: 'chat', method: m.method, wordCount: m.wordCount, channel: session.channel, lang: s.lang },
    timestamp: at,
  })));
  await log(session, { tool: 'log_observation', input: { flow: 'chat' }, output: { ok: true, measured: true, ...rows }, label: 'agent_noticed', summaryText: `Measured ${m.wordCount} words for the weekly review (vocabulary, repetitions, fillers${rows.speechRateWpm ? ', speech rate' : ''}).` });
  return m;
}

async function startChatCall({ patientId, trigger = 'weekly_chat', channel = 'text', turnBudgetMs }) {
  if (!mongoose.isValidObjectId(patientId)) throw Object.assign(new Error('Not a valid patient id'), { status: 400 });
  const patient = await Patient.findById(patientId).populate('user', 'name').lean();
  if (!patient) throw Object.assign(new Error('Patient not found'), { status: 404 });
  const name = ((patient.user && patient.user.name) || 'there').split(' ')[0];
  const lang = patient.language === 'hi' ? 'hi' : 'en';
  const caregiver = (await listCaregivers(patient._id)).find((c) => c.role !== 'doctor' && c.name);
  const runId = await startRun({ trigger, patientId: patient._id, flow: 'chat', promptVersion: 'chat-flow@1' }).catch(() => null);
  const { sessionId, actions } = await startSession({
    flow: 'chat',
    patientId: patient._id,
    runId,
    channel,
    turnBudgetMs,
    init: (session) => {
      session.lang = lang;
      session.state = { name, lang, caregiver: caregiver ? caregiver.name.split(' ')[0] : null, transcript: [], answers: [], words: 0, more: 0, silences: 0, timings: [], ending: null };
    },
  });
  return { sessionId, runId: runId ? String(runId) : null, patientId: String(patient._id), actions, name, lang };
}

module.exports = { startChatCall, chatLineTexts, logChatMeasures };
