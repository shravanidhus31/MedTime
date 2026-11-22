// Text simulate endpoints (A2.7). A dose call in text: the same flow, tools and AgentRun log as a
// real call, with Twilio replaced by text. Person B's evaluation harness uses these.
//
//   POST /api/v1/simulate/call { reminderId }
//     → { callId, runId, actions, ended }        the agent's opening turn
//   POST /api/v1/simulate/call/:callId/say { text } or { dtmf: '9' }
//     → { callId, runId, actions, ended, emergency? }
//
// Login required, with access to the reminder's patient. A simulated call records REAL doses in
// the database it runs on, so it is off in production unless SIMULATE_ENABLED=true.

const express = require('express');
const mongoose = require('mongoose');
const Reminder = require('../models/Reminder');
const { verifyToken } = require('../middleware/authMiddleware');
const { canAccess } = require('../agent/access');
const { startDoseCall } = require('../agent/flows/dose');
const { handleTurn, getSession, TurnError } = require('../agent/orchestrator');

const router = express.Router();
const MAX_TEXT_CHARS = 2000;
const TEXT_TURN_BUDGET_MS = 30000; // no Twilio 5-second limit in text mode

function simulateAllowed() {
  return process.env.NODE_ENV !== 'production' || process.env.SIMULATE_ENABLED === 'true';
}

router.use((req, res, next) => {
  if (!simulateAllowed()) return res.status(403).json({ message: 'Simulated calls are off in production (set SIMULATE_ENABLED=true to allow).' });
  next();
});

const isEnded = (actions) => actions.some((a) => a.type === 'hangup' || a.type === 'fallback');

router.post('/call', verifyToken, async (req, res) => {
  try {
    const { reminderId } = req.body || {};
    if (!mongoose.isValidObjectId(reminderId)) return res.status(400).json({ message: '"reminderId" must be a Reminder id.' });
    const reminder = await Reminder.findById(reminderId).select('patient').lean();
    if (!reminder || !(await canAccess(req.user, reminder.patient, 'primary'))) {
      return res.status(404).json({ message: 'Reminder not found.' });
    }
    const call = await startDoseCall({ reminderId, trigger: 'simulate', channel: 'text', turnBudgetMs: TEXT_TURN_BUDGET_MS });
    return res.status(201).json({ callId: call.sessionId, runId: call.runId, actions: call.actions, ended: isEnded(call.actions) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error('[simulateRoutes] start failed:', err.message);
    return res.status(500).json({ message: 'Could not start the simulated call.' });
  }
});

router.post('/call/:callId/say', verifyToken, async (req, res) => {
  const { callId } = req.params;
  const { text, dtmf } = req.body || {};
  if (text === undefined && dtmf === undefined) return res.status(400).json({ message: 'Send "text" (what the patient says) or "dtmf" (a key).' });
  if (text !== undefined && (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT_CHARS)) {
    return res.status(400).json({ message: `"text" must be 1 to ${MAX_TEXT_CHARS} characters.` });
  }
  if (dtmf !== undefined && !/^[0-9*#]$/.test(String(dtmf))) return res.status(400).json({ message: '"dtmf" must be a single keypad key.' });

  const session = getSession(callId);
  if (!session || session.channel !== 'text' || !(await canAccess(req.user, session.patientId, 'primary'))) {
    return res.status(404).json({ message: 'No active simulated call with that id.' });
  }
  try {
    const result = await handleTurn({ sessionId: callId, flow: 'dose', transcript: text, isFinal: true, dtmf });
    return res.json({ callId, runId: session.runId || null, ...result, ended: isEnded(result.actions) });
  } catch (err) {
    if (err instanceof TurnError) return res.status(err.status === 404 ? 409 : err.status).json({ message: err.status === 404 ? 'This call has ended.' : err.message });
    console.error('[simulateRoutes] turn failed:', err.message);
    return res.status(500).json({ message: 'The simulated turn failed.' });
  }
});

module.exports = router;
