/**
 * Proposal routes — B4 (contract C5)
 *
 * Endpoints for caregivers (Level 1) and doctors (Level 2) to review,
 * approve, or reject changes proposed by the AI agent.
 */

const express = require('express');
const ProposedChange = require('../models/ProposedChange');
const Patient = require('../models/Patient');
const { verifyToken } = require('../middleware/authMiddleware');
const { canAccess } = require('../middleware/access');
const { getProposalKind } = require('../agent/proposals');

const router = express.Router();

// ─── GET /api/v1/proposals ──────────────────────────────────────────────────
// Returns proposals. Query params: ?patient=<patientId>&status=<pending|approved|rejected>
router.get('/', verifyToken, async (req, res) => {
  try {
    let { patient: patientId, status } = req.query;

    if (!patientId) {
      // If caller is patient, default to their profile
      const patientDoc = await Patient.findOne({ user: req.user.id });
      if (patientDoc) patientId = patientDoc._id.toString();
    }

    if (!patientId) {
      return res.status(400).json({ message: 'patient query parameter required.' });
    }

    const ok = await canAccess(req.user.id, patientId, 'view');
    if (!ok) return res.status(403).json({ message: 'Forbidden.' });

    const filter = { patient: patientId };
    if (status) filter.status = status;

    const proposals = await ProposedChange.find(filter)
      .populate('decidedBy', 'name role')
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json(proposals);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ─── POST /api/v1/proposals/:id/approve ─────────────────────────────────────
// Approve a proposal. Level 1 needs 'approve' access; Level 2 needs 'doctor'.
router.post('/:id/approve', verifyToken, async (req, res) => {
  try {
    const proposal = await ProposedChange.findById(req.params.id);
    if (!proposal) return res.status(404).json({ message: 'Proposal not found.' });

    if (proposal.status !== 'pending') {
      return res.status(400).json({ message: `Cannot approve a '${proposal.status}' proposal.` });
    }

    const minRoleNeeded = proposal.level === 2 ? 'doctor' : 'approve';
    const ok = await canAccess(req.user.id, proposal.patient.toString(), minRoleNeeded);
    if (!ok) {
      return res.status(403).json({
        message: `Forbidden: Level ${proposal.level} approval requires ${minRoleNeeded} permissions.`,
      });
    }

    // Apply the proposal change via its registered kind handler
    const kindDef = getProposalKind(proposal.kind);
    if (kindDef && typeof kindDef.apply === 'function') {
      await kindDef.apply(proposal.payload, proposal);
    }

    proposal.status = 'approved';
    proposal.decidedBy = req.user.id;
    proposal.decidedAt = new Date();
    proposal.reason = req.body.reason || 'Approved by caregiver';
    await proposal.save();

    res.status(200).json({
      message: 'Proposal approved and applied successfully.',
      proposal,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ─── POST /api/v1/proposals/:id/reject ──────────────────────────────────────
// Reject a proposal.
router.post('/:id/reject', verifyToken, async (req, res) => {
  try {
    const proposal = await ProposedChange.findById(req.params.id);
    if (!proposal) return res.status(404).json({ message: 'Proposal not found.' });

    if (proposal.status !== 'pending') {
      return res.status(400).json({ message: `Cannot reject a '${proposal.status}' proposal.` });
    }

    const minRoleNeeded = proposal.level === 2 ? 'doctor' : 'approve';
    const ok = await canAccess(req.user.id, proposal.patient.toString(), minRoleNeeded);
    if (!ok) {
      return res.status(403).json({
        message: `Forbidden: Level ${proposal.level} rejection requires ${minRoleNeeded} permissions.`,
      });
    }

    proposal.status = 'rejected';
    proposal.decidedBy = req.user.id;
    proposal.decidedAt = new Date();
    proposal.reason = req.body.reason || 'Rejected by user';
    await proposal.save();

    res.status(200).json({
      message: 'Proposal rejected.',
      proposal,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
