// Orchestrator (A2.4, contract C8). Every turn of a live call passes through here.
//
// Front ends (the browser call screen, the Twilio phone adapter, the text simulator) send:
//   POST /api/v1/agent/turn { sessionId, flow, transcript, isFinal, asrConfidence, dtmf? }
// and get back:
//   { actions: [ { type: 'play', lineId, slots }      // a phrase-bank line (family voice)
//              | { type: 'neutral', text }           // spoken in the neutral voice
//              | { type: 'listen' }                  // wait for the patient's reply
//              | { type: 'wait' }                    // still working: pause, then send an empty turn
//              | { type: 'fallback', reason }        // agent failed: use the keypad menu
//              | { type: 'hangup' } ] }
//
// Order on every turn:
//   1. keypad 9, or a red flag in ANY transcript (partial or final) → fixed emergency reply in the
//      neutral voice + caregiver alert. The flow and the LLM are skipped.
//   2. a partial transcript stops there (the agent waits for the finished sentence).
//   3. the flow's handler runs, inside the turn budget (4 s: Twilio waits at most 5 s).
//      Too slow → "Let me check that" + wait; the next (empty) turn collects the answer.
//      Crash or bad actions → fallback to the keypad.
//   4. after maxTurns (8: the Twilio trial allows ~10 hops per call) → hand over and hang up.
//
// Flows register with registerFlow(name, { start(session), turn(session, input), onTurnLimit?, onEnd? }).
// start and turn return an actions array. `session.state` is the flow's own scratch space
// (startSession's `init(session)` can set it up). onEnd(session) runs once when the call ends:
// on hang-up, at the turn limit, or when an abandoned session expires.

const crypto = require('crypto');
const { screen, responseFor } = require('./safety');
const { addStep } = require('./runs');

const TURN_BUDGET_MS = 4000;
const MAX_TURNS = 8;
const SESSION_TTL_MS = 30 * 60 * 1000;
const ACTION_TYPES = new Set(['play', 'neutral', 'listen', 'wait', 'fallback', 'hangup']);

const HOLD_TEXT = 'Let me check that for you.';
// After a red flag the call stays in emergency mode: this, in the neutral voice, on every turn.
const STAY_TEXT = "I'm still here with you, and your family has been told. Please stay on the line.";
const TURN_LIMIT_TEXT = 'Thank you. Someone from your family will call you soon. Goodbye.';
// The same lines in Hindi (core scenario 9: a Hindi speaker hears only Hindi). session.lang is set
// by the flow from the patient's language; anything else gets English.
const HI = {
  hold: 'एक पल, मैं देख रही हूँ।',
  stay: 'मैं आपके साथ हूँ, और आपके परिवार को बता दिया गया है। कृपया फ़ोन पर बने रहिए।',
  limit: 'धन्यवाद। आपके परिवार से कोई जल्दी ही आपको फ़ोन करेगा। नमस्ते।',
};
const hindi = (session) => session && session.lang === 'hi';
const stayText = (session) => (hindi(session) ? HI.stay : STAY_TEXT);
const holdActions = (session) => [{ type: 'neutral', text: hindi(session) ? HI.hold : HOLD_TEXT }, { type: 'wait' }];
const turnLimitActions = (session) => [{ type: 'neutral', text: hindi(session) ? HI.limit : TURN_LIMIT_TEXT }, { type: 'hangup' }];

const flows = new Map();
const sessions = new Map();

// ── flows ───────────────────────────────────────────────────────────────────

function registerFlow(name, handler) {
  if (typeof name !== 'string' || !name) throw new TypeError('registerFlow needs a flow name');
  if (flows.has(name)) throw new Error(`Flow "${name}" is already registered`);
  if (!handler || typeof handler.start !== 'function' || typeof handler.turn !== 'function') {
    throw new TypeError(`Flow "${name}" needs start(session) and turn(session, input) functions`);
  }
  flows.set(name, handler);
}

// ── emergencies ─────────────────────────────────────────────────────────────

// Called on every red flag. A2.5 replaces this with notify_caregiver (a phone call to the
// primary caregiver, then the second one).
let emergencyHandler = async (session, verdict) => {
  console.warn(`[agent:orchestrator] RED FLAG (${verdict.category}) in session ${session.sessionId}, patient ${session.patientId}. Caregiver alert not wired yet (A2.5).`);
};

function setEmergencyHandler(fn) {
  if (typeof fn !== 'function') throw new TypeError('setEmergencyHandler needs a function');
  emergencyHandler = fn;
}

// ── sessions ────────────────────────────────────────────────────────────────

function sweepSessions(now = Date.now()) {
  for (const [id, s] of sessions) {
    if (now - s.lastActiveAt > SESSION_TTL_MS) {
      sessions.delete(id);
      callOnEnd(s); // abandoned call: still close its record
    }
  }
}

// Runs the flow's onEnd once per session.
async function callOnEnd(session) {
  if (session.onEndCalled) return;
  session.onEndCalled = true;
  const handler = flows.get(session.flow);
  if (!handler || typeof handler.onEnd !== 'function') return;
  try {
    await handler.onEnd(session);
  } catch (err) {
    console.error(`[agent:orchestrator] onEnd for "${session.flow}" failed:`, err.message);
  }
}

// Starts a call session. The sessionId is a random UUID: it is what lets a front end talk to this
// session, so it is never guessable.
async function startSession({ flow, patientId, reminderId, runId, channel = 'text', turnBudgetMs = TURN_BUDGET_MS, maxTurns = MAX_TURNS, init }) {
  const handler = flows.get(flow);
  if (!handler) throw new Error(`No flow registered with the name "${flow}"`);
  sweepSessions();

  const session = {
    sessionId: crypto.randomUUID(),
    flow,
    patientId: patientId ? String(patientId) : undefined,
    reminderId: reminderId ? String(reminderId) : undefined,
    runId: runId ? String(runId) : undefined,
    channel,
    turnBudgetMs,
    maxTurns,
    turns: 0,
    emergency: null,
    pending: null,
    ended: false,
    state: {},
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };
  if (typeof init === 'function') init(session);
  sessions.set(session.sessionId, session);

  const actions = await runHandler(session, () => handler.start(session));
  const result = await finishActions(session, actions); // the first reply may already end the call
  return { sessionId: session.sessionId, actions: result.actions };
}

function getSession(sessionId) {
  return sessions.get(sessionId);
}

function endSession(sessionId) {
  sessions.delete(sessionId);
}

// ── turns ───────────────────────────────────────────────────────────────────

class TurnError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function handleTurn({ sessionId, flow, transcript, isFinal = true, asrConfidence, dtmf } = {}) {
  const session = sessions.get(sessionId);
  if (!session || session.ended) throw new TurnError(404, 'No active session with that id');
  if (flow && flow !== session.flow) throw new TurnError(400, `Session is a "${session.flow}" call, not "${flow}"`);
  session.lastActiveAt = Date.now();

  const text = typeof transcript === 'string' ? transcript.trim() : '';
  const key = dtmf !== undefined && dtmf !== null ? String(dtmf).trim() : '';

  // 1. emergencies first: keypad 9, or a red flag in what she said
  if (key === '9') return emergency(session, { verdict: 'redflag', category: 'help_key' }, text);
  let verdict; // passed on to the flow, so it can handle 'unsafe' (e.g. a request to change a dose)
  if (text) {
    const started = Date.now();
    try {
      verdict = await screen(text, { patientId: session.patientId, flow: session.flow, isFinal });
    } catch (err) {
      console.error('[agent:orchestrator] safety screen failed:', err.message);
      verdict = { verdict: 'ok' }; // the keypad 9 path still works
    }
    if (verdict && verdict.verdict === 'redflag') return emergency(session, verdict, text, Date.now() - started);
  }

  // Emergency mode (A3.4, plan 6.1): once a red flag has been raised, the call is no longer about
  // the dose. She is reassured in the neutral voice and the agent keeps listening; the flow never
  // runs again in this call. Found in the first live voice test: after "I have fallen down", her
  // "Okay, bye" went back to the dose flow and was answered "Well done. Which tablet did you take?"
  if (session.emergency) {
    if (!isFinal) return { actions: [] };
    return { actions: [{ type: 'neutral', text: stayText(session) }, { type: 'listen' }], inEmergency: session.emergency.category };
  }

  // 2. partial transcripts only get the safety check
  if (!isFinal && !key) return { actions: [] };

  // a slow earlier turn is still running: collect it if it's ready, otherwise keep holding
  if (session.pending) return collectPending(session);

  // 4. turn limit
  session.turns += 1;
  if (session.turns > session.maxTurns) return finishActions(session, limitActions(session));

  // 3. the flow
  const handler = flows.get(session.flow);
  const input = { transcript: text, isFinal, asrConfidence, dtmf: key || undefined, safety: verdict };
  const work = runHandler(session, () => handler.turn(session, input));
  const actions = await withinBudget(work, session.turnBudgetMs);
  if (actions) return finishActions(session, actions);

  session.pending = work;
  return { actions: holdActions(session) };
}

async function collectPending(session) {
  const actions = await withinBudget(session.pending, session.turnBudgetMs);
  if (!actions) return { actions: holdActions(session) };
  session.pending = null;
  return finishActions(session, actions);
}

async function finishActions(session, actions) {
  // A hang-up ends the call; so does a fallback (the front end switches to the keypad menu).
  if (!session.ended && actions.some((a) => a.type === 'hangup' || a.type === 'fallback')) {
    session.ended = true;
    await callOnEnd(session);
    setTimeout(() => endSession(session.sessionId), 60000).unref();
  }
  return { actions };
}

function limitActions(session) {
  const handler = flows.get(session.flow);
  if (handler && typeof handler.onTurnLimit === 'function') {
    try {
      const custom = handler.onTurnLimit(session);
      if (isValidActions(custom)) return custom;
    } catch (err) {
      console.error('[agent:orchestrator] onTurnLimit failed:', err.message);
    }
  }
  return turnLimitActions(session);
}

async function emergency(session, verdict, text, screenMs) {
  // The family is phoned once per kind of emergency in a call (a fall, then chest pain: twice).
  const alerted = (session.emergency && session.emergency.alerted) || new Set();
  const first = !alerted.has(verdict.category);
  alerted.add(verdict.category);
  session.emergency = { category: verdict.category, at: new Date(), alerted };
  session.pending = null; // whatever the agent was doing no longer matters
  const response = responseFor(verdict, session.lang);

  if (session.runId) {
    addStep(session.runId, {
      tool: 'safety_screen',
      input: { transcript: text || undefined, dtmf: verdict.category === 'help_key' ? '9' : undefined },
      output: { verdict: 'redflag', category: verdict.category },
      ms: screenMs || 0,
      at: new Date(),
    }).catch((err) => console.error('[agent:orchestrator] could not log red flag:', err.message));
  }
  if (first) {
    Promise.resolve()
      .then(() => emergencyHandler(session, verdict))
      .catch((err) => console.error('[agent:orchestrator] emergency handler failed:', err.message));
  }

  // Neutral voice only, then keep listening (A3.4: stay on the line). `emergency` is set only when
  // the family was alerted just now; a repeat of the same red flag is reassured, not re-alerted.
  if (!first) return { actions: [{ type: 'neutral', text: stayText(session) }, { type: 'listen' }], inEmergency: verdict.category };
  return { actions: [{ type: 'neutral', text: response.neutralText }, { type: 'listen' }], emergency: verdict.category };
}

// Runs a flow handler and turns any crash or malformed reply into a keypad fallback.
async function runHandler(session, fn) {
  try {
    const actions = await fn();
    if (!isValidActions(actions)) {
      console.error(`[agent:orchestrator] flow "${session.flow}" returned invalid actions`, actions);
      return [{ type: 'fallback', reason: 'invalid_actions' }];
    }
    return actions;
  } catch (err) {
    console.error(`[agent:orchestrator] flow "${session.flow}" failed:`, err.message);
    return [{ type: 'fallback', reason: 'flow_error' }];
  }
}

function isValidActions(actions) {
  return (
    Array.isArray(actions) &&
    actions.every((a) => {
      if (!a || !ACTION_TYPES.has(a.type)) return false;
      if (a.type === 'play') return typeof a.lineId === 'string' && a.lineId.length > 0;
      if (a.type === 'neutral') return typeof a.text === 'string' && a.text.length > 0;
      return true;
    })
  );
}

// Resolves to the actions if `work` finishes in time, otherwise to null (work keeps running).
function withinBudget(work, ms) {
  let timer;
  return Promise.race([
    work,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// For tests only.
function _reset() {
  flows.clear();
  sessions.clear();
}

module.exports = {
  registerFlow,
  startSession,
  handleTurn,
  getSession,
  endSession,
  setEmergencyHandler,
  isValidActions,
  TurnError,
  TURN_BUDGET_MS,
  MAX_TURNS,
  HOLD_TEXT,
  TURN_LIMIT_TEXT,
  STAY_TEXT,
  _reset,
};
