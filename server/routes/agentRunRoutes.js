/**
 * Agent Run Routes — Contract C2
 *
 * Provides endpoints for caregivers and the Activity panel to inspect
 * autonomous AI agent execution runs, tool steps, and decisions.
 */

const express = require('express');
const AgentRun = require('../models/AgentRun');
const Patient = require('../models/Patient');
const { verifyToken } = require('../middleware/authMiddleware');
const { canAccess } = require('../middleware/access');

const router = express.Router();

// ─── GET /api/v1/agent/runs ─────────────────────────────────────────────────
// Query: ?patient=<patientId>&from=<date>&to=<date>&trigger=<trigger>&status=<status>
router.get('/runs', verifyToken, async (req, res) => {
  try {
    let { patient: patientId, from, to, trigger, status } = req.query;

    if (!patientId) {
      const patientDoc = await Patient.findOne({ user: req.user.id });
      if (patientDoc) patientId = patientDoc._id.toString();
    }

    if (!patientId) {
      return res.status(400).json({ message: 'patient query parameter required.' });
    }

    const ok = await canAccess(req.user.id, patientId, 'view');
    if (!ok) return res.status(403).json({ message: 'Forbidden.' });

    const filter = { patient: patientId };
    if (trigger) filter.trigger = trigger;
    if (status) filter.status = status;

    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }

    const runs = await AgentRun.find(filter)
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();

    res.status(200).json(runs);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ─── GET /api/v1/agent/runs/:id ─────────────────────────────────────────────
router.get('/runs/:id', verifyToken, async (req, res) => {
  try {
    const run = await AgentRun.findById(req.params.id)
      .populate('patient')
      .populate('reminder')
      .populate('approver', 'name role')
      .lean();

    if (!run) return res.status(404).json({ message: 'Agent run not found.' });

    const ok = await canAccess(req.user.id, run.patient._id.toString(), 'view');
    if (!ok) return res.status(403).json({ message: 'Forbidden.' });

    res.status(200).json(run);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
