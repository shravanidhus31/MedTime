// Agent run endpoints (A2.3, contract C2). Read-only; used by Person B's Activity panel.
//
//   GET /api/v1/agent/runs?patient=<Patient id>&from=<ISO date>&to=<ISO date>&limit=50&steps=1
//     → { runs: [ ...run without steps, with stepCount ] }, newest first.
//       steps=1 includes each run's steps (Person B's Activity panel shows the timeline inline).
//   GET /api/v1/agent/runs/:id
//     → { run: { ...run, steps: [{ tool, input, output, ms, at, approvalLevel, proposalId }] } }
//
// Both need a login token, and the user must be allowed to see that patient.
//
//   POST /api/v1/agent/turn { sessionId, flow?, transcript?, isFinal?, asrConfidence?, dtmf? }
//     → { actions: [...] }   (A2.4, contract C8; see agent/orchestrator.js)
//   No login token: the caller is the voice pipeline, not a person. The sessionId is a random
//   UUID handed out when the call starts, and only works for that one live call.

const express = require('express');
const mongoose = require('mongoose');
const AgentRun = require('../models/AgentRun');
const { verifyToken } = require('../middleware/authMiddleware');
const { canAccess } = require('../agent/access');
const { handleTurn, TurnError } = require('../agent/orchestrator');

const router = express.Router();
const MAX_LIMIT = 200;
const MAX_TRANSCRIPT_CHARS = 2000;

router.post('/turn', async (req, res) => {
  const { sessionId, flow, transcript, isFinal, asrConfidence, dtmf } = req.body || {};
  if (typeof sessionId !== 'string' || !sessionId) {
    return res.status(400).json({ message: '"sessionId" is required.' });
  }
  if (transcript !== undefined && (typeof transcript !== 'string' || transcript.length > MAX_TRANSCRIPT_CHARS)) {
    return res.status(400).json({ message: `"transcript" must be text of at most ${MAX_TRANSCRIPT_CHARS} characters.` });
  }
  if (isFinal !== undefined && typeof isFinal !== 'boolean') {
    return res.status(400).json({ message: '"isFinal" must be true or false.' });
  }
  if (dtmf !== undefined && !/^[0-9*#]$/.test(String(dtmf))) {
    return res.status(400).json({ message: '"dtmf" must be a single keypad key.' });
  }
  try {
    const result = await handleTurn({ sessionId, flow, transcript, isFinal, asrConfidence, dtmf });
    return res.json(result);
  } catch (err) {
    if (err instanceof TurnError) return res.status(err.status).json({ message: err.message });
    console.error('[agentRoutes] turn failed:', err.message);
    // Never leave a caller with nothing to do: the keypad menu still works.
    return res.status(500).json({ actions: [{ type: 'fallback', reason: 'server_error' }] });
  }
});

function parseDate(value) {
  if (value === undefined) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

router.get('/runs', verifyToken, async (req, res) => {
  try {
    const { patient } = req.query;
    if (!patient || !mongoose.isValidObjectId(patient)) {
      return res.status(400).json({ message: 'Query parameter "patient" must be a Patient id.' });
    }
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    if (from === null || to === null) {
      return res.status(400).json({ message: '"from" and "to" must be dates, for example 2026-11-21.' });
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), MAX_LIMIT);

    if (!(await canAccess(req.user, patient, 'view'))) {
      return res.status(403).json({ message: 'You do not have access to this patient.' });
    }

    const filter = { patient };
    if (from || to) {
      filter.startedAt = {};
      if (from) filter.startedAt.$gte = from;
      if (to) filter.startedAt.$lte = to;
    }

    const withSteps = req.query.steps === '1' || req.query.steps === 'true';
    let query = AgentRun.find(filter).sort({ startedAt: -1 }).limit(limit);
    if (!withSteps) query = query.select('-steps');
    const runs = await query.lean();
    return res.json({ runs });
  } catch (err) {
    console.error('[agentRoutes] list runs failed:', err.message);
    return res.status(500).json({ message: 'Could not load agent runs.' });
  }
});

router.get('/runs/:id', verifyToken, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Not a valid run id.' });
    }
    const run = await AgentRun.findById(req.params.id).lean();
    // Same answer for "not found" and "no access", so ids of other patients' runs can't be probed.
    if (!run || !run.patient || !(await canAccess(req.user, run.patient, 'view'))) {
      return res.status(404).json({ message: 'Run not found.' });
    }
    return res.json({ run });
  } catch (err) {
    console.error('[agentRoutes] get run failed:', err.message);
    return res.status(500).json({ message: 'Could not load the agent run.' });
  }
});

module.exports = router;
