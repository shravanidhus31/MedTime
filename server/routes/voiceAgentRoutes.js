// Twilio phone adapter (A3.5): a real phone call runs the same agent as the browser call and the
// eval. Turn by turn, so it works on the Twilio free trial (no <Stream>, no inline TwiML):
//
//   the scheduler places the call → Twilio fetches  POST /api/v1/voice/agent/dose?reminderId=…
//     → startDoseCall() → the agent's actions as TwiML: <Say> the lines, <Gather input="speech dtmf">
//   she answers → Twilio's speech recognition → POST /api/v1/voice/agent/turn?sid=…
//     (SpeechResult, Confidence, Digits) → handleTurn() (C8) → TwiML again
//   'wait' (the agent is still working) → a hold line and <Redirect> to /turn?collect=1
//   'hangup' → <Hangup/>; 'fallback' (the agent failed) → <Redirect> to the keypad menu
//   the call ends (she hangs up) → POST /api/v1/voice/agent/status → the call's AgentRun is closed
//   a patient phones in → /api/v1/voice/incoming (voiceIncoming.js) → startCallinCall() → here
//
// Speech: en-IN by default. Hindi patients get hi-IN with Twilio's experimental_conversations
// model (Twilio lists Hindi for it; it needs a numeric speechTimeout). The agent's own lines are
// spoken with Twilio <Say> (TWILIO_VOICE, default Polly.Aditi, which reads English and Hindi);
// the family voice (A5) will replace them with <Play>.
//
// Trial limits respected: the flows finish within 8 turns (≈10 hops), each turn answers within the
// 4 s budget (a slower one becomes a hold line + redirect), calls only reach verified numbers.
// Every route checks Twilio's signature (A1.1).

const express = require('express');
const router = express.Router();
const Reminder = require('../models/Reminder');
const Patient = require('../models/Patient');
const { verifyTwilioSignature } = require('../middleware/twilioSignature');
const { publicBaseUrl } = require('../utils/publicUrl');
const { initAgent } = require('../agent');
const { handleTurn, getSession, endSession, closeSession, TurnError } = require('../agent/orchestrator');
const { startDoseCall } = require('../agent/flows/dose');

const BASE = '/api/v1/voice/agent';
const callSessions = new Map(); // Twilio CallSid → our sessionId, to close the run on hang-up

const escapeXml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const url = (path) => `${publicBaseUrl()}${path}`;

// Speech settings per language.
function speech(lang) {
  if (lang === 'hi') return { language: 'hi-IN', model: 'experimental_conversations', timeout: '2' };
  return { language: 'en-IN', model: null, timeout: 'auto' };
}
const voice = () => process.env.TWILIO_VOICE || 'Polly.Aditi';

// <Say> for one line of text, in the call's language.
const say = (text, lang) => `<Say voice="${escapeXml(voice())}" language="${speech(lang).language}">${escapeXml(text)}</Say>`;

// The agent's actions (contract C8) as TwiML.
function toTwiml(actions, { sessionId, lang = 'en', hints = [], keypadUrl }) {
  const texts = actions.filter((a) => (a.type === 'play' || a.type === 'neutral') && a.text).map((a) => say(a.text, lang)).join('');
  const turnUrl = url(`${BASE}/turn?sid=${encodeURIComponent(sessionId)}`);
  const types = new Set(actions.map((a) => a.type));
  let body;
  if (types.has('fallback')) {
    // the agent failed: the keypad menu still gets the dose confirmed
    body = keypadUrl ? `${texts}<Redirect method="POST">${escapeXml(keypadUrl)}</Redirect>` : `${texts}<Hangup/>`;
  } else if (types.has('hangup')) {
    body = `${texts}<Hangup/>`;
  } else if (types.has('wait')) {
    body = `${texts}<Pause length="1"/><Redirect method="POST">${escapeXml(`${turnUrl}&collect=1`)}</Redirect>`;
  } else {
    // listen: the question is spoken inside the Gather, so she can answer (or press a key) over it.
    // actionOnEmptyResult: silence still reaches the agent ("no answer twice" → hand over).
    const s = speech(lang);
    const attrs = [
      'input="speech dtmf"', 'numDigits="1"', 'method="POST"', 'actionOnEmptyResult="true"',
      `action="${escapeXml(turnUrl)}"`, `language="${s.language}"`, `speechTimeout="${s.timeout}"`,
      s.model ? `speechModel="${s.model}"` : '',
      hints.length ? `hints="${escapeXml(hints.join(', '))}"` : '',
    ].filter(Boolean).join(' ');
    body = `<Gather ${attrs}>${texts}</Gather>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
}

const sendTwiml = (res, xml) => res.type('text/xml').send(xml);
const sorry = (lang) => `<?xml version="1.0" encoding="UTF-8"?><Response>${say(lang === 'hi'
  ? 'माफ़ कीजिए, अभी कुछ गड़बड़ हो गई। आपके परिवार से कोई आपको फ़ोन करेगा। नमस्ते।'
  : "Sorry, something went wrong. Someone from your family will call you. Goodbye.", lang)}<Hangup/></Response>`;

// What a call needs to keep speaking her language and to fall back to the keypad.
async function callContext(session) {
  const patient = session.patientId ? await Patient.findById(session.patientId).select('language').lean() : null;
  const lang = (patient && patient.language) || 'en';
  const expected = session.state && session.state.expected;
  const hints = [expected && expected.medicine, session.state && session.state.slots && session.state.slots.name].filter(Boolean);
  const keypadUrl = session.reminderId ? url(`/api/v1/webhooks/voice/prompt?reminderId=${encodeURIComponent(session.reminderId)}`) : null;
  return { lang, hints, keypadUrl };
}

// Exported for voiceIncoming.js (call-in) and the tests: TwiML for a session's opening actions.
async function openingTwiml({ sessionId, actions, callSid }) {
  if (callSid) callSessions.set(callSid, sessionId);
  const session = getSession(sessionId);
  const ctx = session ? await callContext(session) : { lang: 'en', hints: [] };
  return toTwiml(actions, { sessionId, ...ctx });
}

// ── the dose call: Twilio fetches this when she picks up ─────────────────────
router.post('/dose', verifyTwilioSignature, async (req, res) => {
  initAgent();
  const { reminderId } = req.query;
  let lang = 'en';
  try {
    const reminder = await Reminder.findById(reminderId).select('patient').lean();
    const patient = reminder ? await Patient.findById(reminder.patient).select('language').lean() : null;
    lang = (patient && patient.language) || 'en';
    const call = await startDoseCall({ reminderId, trigger: 'phone_call', channel: 'phone' }); // the scheduler's decision is its own 'dose_due' run
    console.log(`📞 [Voice agent] Dose call started (reminder ${reminderId}, run ${call.runId}, CallSid ${req.body.CallSid || '-'}).`);
    return sendTwiml(res, await openingTwiml({ sessionId: call.sessionId, actions: call.actions, callSid: req.body.CallSid }));
  } catch (err) {
    console.error('[Voice agent] Could not start the dose call:', err.message);
    // the agent can't run: the keypad menu still gets the dose confirmed
    if (reminderId) {
      return sendTwiml(res, `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${escapeXml(url(`/api/v1/webhooks/voice/prompt?reminderId=${encodeURIComponent(reminderId)}`))}</Redirect></Response>`);
    }
    return sendTwiml(res, sorry(lang));
  }
});

// ── each turn: Twilio posts what she said ────────────────────────────────────
router.post('/turn', verifyTwilioSignature, async (req, res) => {
  const sessionId = String(req.query.sid || '');
  const session = getSession(sessionId);
  if (!session || session.ended) return sendTwiml(res, sorry('en'));
  const ctx = await callContext(session);
  try {
    const collecting = req.query.collect === '1';
    const transcript = collecting ? '' : String(req.body.SpeechResult || '');
    const digits = collecting ? undefined : (req.body.Digits || undefined);
    const confidence = req.body.Confidence !== undefined ? Number(req.body.Confidence) : undefined;
    // A redirect to collect a slow turn must not count as a silent answer.
    if (collecting && !session.pending) return sendTwiml(res, toTwiml([{ type: 'listen' }], { sessionId, ...ctx }));
    const r = await handleTurn({ sessionId, transcript, isFinal: true, asrConfidence: confidence, dtmf: digits });
    return sendTwiml(res, toTwiml(r.actions, { sessionId, ...ctx }));
  } catch (err) {
    console.error('[Voice agent] Turn failed:', err instanceof TurnError ? err.message : err.stack);
    return sendTwiml(res, ctx.keypadUrl ? toTwiml([{ type: 'fallback' }], { sessionId, ...ctx }) : sorry(ctx.lang));
  }
});

// ── the call ended (Twilio statusCallback): close the session and its AgentRun ─
router.post('/status', verifyTwilioSignature, async (req, res) => {
  const { CallSid, CallStatus } = req.body || {};
  const sessionId = callSessions.get(CallSid);
  if (sessionId && ['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(CallStatus)) {
    callSessions.delete(CallSid);
    const session = getSession(sessionId);
    if (session && !session.ended) {
      await closeSession(sessionId);
      console.log(`📞 [Voice agent] Call ${CallSid} ended (${CallStatus}); run closed.`);
    } else endSession(sessionId);
  }
  res.status(204).end();
});

module.exports = router;
module.exports.toTwiml = toTwiml;
module.exports.openingTwiml = openingTwiml;
