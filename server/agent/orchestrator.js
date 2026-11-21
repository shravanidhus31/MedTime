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
// Flows register with registerFlow(name, { start(session), turn(session, input), onTurnLimit? }).
// Both return an actions array. `session.state` is the flow's own scratch space.

const crypto = require('crypto');
const { screen, responseFor } = require('./safety');
const { addStep } = require('./runs');

const TURN_BUDGET_MS = 4000;
const MAX_TURNS = 8;
const SESSION_TTL_MS = 30 * 60 * 1000;
const ACTION_TYPES = new Set(['play', 'neutral', 'listen', 'wait', 'fallback', 'hangup']);

const HOLD_ACTIONS = [{ type: 'neutral', text: 'Let me check that for you.' }, { type: 'wait' }];
const TURN_LIMIT_ACTIONS = [
  { type: 'neutral', text: 'Thank you. Someone from your family will call you soon. Goodbye.' },
  { type: 'hangup' },
];

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
    if (now - s.lastActiveAt > SESSION_TTL_MS) sessions.delete(id);
  }
}

// Starts a call session. The sessionId is a random UUID: it is what lets a front end talk to this
// session, so it is never guessable.
async function startSession({ flow, patientId, reminderId, runId, channel = 'text', turnBudgetMs = TURN_BUDGET_MS, maxTurns = MAX_TURNS }) {
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
  sessions.set(session.sessionId, session);

  const actions = await runHandler(session, () => handler.start(session));
  return { sessionId: session.sessionId, actions };
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
  if (text) {
    const started = Date.now();
    let verdict;
    try {
      verdict = await screen(text, { patientId: session.patientId, flow: session.flow, isFinal });
    } catch (err) {
      console.error('[agent:orchestrator] safety screen failed:', err.message);
      verdict = { verdict: 'ok' }; // the keypad 9 path still works
    }
    if (verdict && verdict.verdict === 'redflag') return emergency(session, verdict, text, Date.now() - started);
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
  const input = { transcript: text, isFinal, asrConfidence, dtmf: key || undefined };
  const work = runHandler(session, () => handler.turn(session, input));
  const actions = await withinBudget(work, session.turnBudgetMs);
  if (actions) return finishActions(session, actions);

  session.pending = work;
  return { actions: HOLD_ACTIONS };
}

async function collectPending(session) {
  const actions = await withinBudget(session.pending, session.turnBudgetMs);
  if (!actions) return { actions: HOLD_ACTIONS };
  session.pending = null;
  return finishActions(session, actions);
}

function finishActions(session, actions) {
  if (actions.some((a) => a.type === 'hangup')) session.ended = true;
  if (session.ended) setTimeout(() => endSession(session.sessionId), 60000).unref();
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
  return TURN_LIMIT_ACTIONS;
}

async function emergency(session, verdict, text, screenMs) {
  const first = !session.emergency;
  session.emergency = { category: verdict.category, at: new Date() };
  session.pending = null; // whatever the agent was doing no longer matters
  const response = responseFor(verdict);

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

  // Neutral voice only, then keep listening (A3.4: stay on the line).
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
  _reset,
};
