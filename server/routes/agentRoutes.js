// Agent run endpoints (A2.3, contract C2). Read-only; used by Person B's Activity panel.
//
//   GET /api/v1/agent/runs?patient=<Patient id>&from=<ISO date>&to=<ISO date>&limit=50
//     → { runs: [ ...run without steps, with stepCount ] }, newest first
//   GET /api/v1/agent/runs/:id
//     → { run: { ...run, steps: [{ tool, input, output, ms, at, approvalLevel, proposalId }] } }
//
// Both need a login token, and the user must be allowed to see that patient.

const express = require('express');
const mongoose = require('mongoose');
const AgentRun = require('../models/AgentRun');
const { verifyToken } = require('../middleware/authMiddleware');
const { canAccess } = require('../agent/access');

const router = express.Router();
const MAX_LIMIT = 200;

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

    const runs = await AgentRun.find(filter).select('-steps').sort({ startedAt: -1 }).limit(limit).lean();
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
