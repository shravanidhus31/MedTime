/**
 * Caregiver routes — B1.1 (#2 + #8)
 *
 * Full MeBo-style revocable access:
 *   - POST /caregiver/link         — caregiver role required; creates a PENDING request
 *   - GET  /caregiver/access       — list access records for a patient (requires view)
 *   - POST /caregiver/access/:id/approve — primary caregiver only
 *   - POST /caregiver/access/:id/revoke  — primary caregiver only
 *   - GET  /caregiver/dashboard    — existing dashboard (now scoped to active links)
 *   - GET  /caregiver/patients/:patientId/history — 7-day reminder history
 *
 * #8 fix: missed-count now checks status 'missed' (and 'alerted' for overdue),
 *         NOT 'due' which was never a valid Reminder status.
 */

const express         = require('express');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');
const { canAccess }   = require('../middleware/access');
const Patient         = require('../models/Patient');
const User            = require('../models/User');
const Medicine        = require('../models/Medicine');
const Reminder        = require('../models/Reminder');
const CaregiverAccess = require('../models/CaregiverAccess');

const router = express.Router();

// ─── POST /api/v1/caregiver/link ────────────────────────────────────────────
// Creates a PENDING access request. The patient's primary caregiver must approve.
// Requires: caller must have role === 'caregiver' in JWT.
router.post('/link', verifyToken, requireRole(['caregiver']), async (req, res) => {
  try {
    const { patientPhone, role = 'view' } = req.body;

    // Validate requested role (callers can't self-grant 'primary')
    const allowedRoles = ['view', 'approve', 'doctor'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ message: `Role must be one of: ${allowedRoles.join(', ')}.` });
    }

    // Find the target patient by phone
    const targetUser = await User.findOne({ phone: patientPhone });
    if (!targetUser) {
      return res.status(404).json({ message: 'No account found with that phone number.' });
    }

    const patientProfile = await Patient.findOne({ user: targetUser._id });
    if (!patientProfile) {
      return res.status(404).json({ message: 'Patient profile not set up yet.' });
    }

    // Check for an existing link (any status)
    const existing = await CaregiverAccess.findOne({
      patient: patientProfile._id,
      user:    req.user.id,
    });

    if (existing) {
      if (existing.status === 'active') {
        return res.status(400).json({ message: 'You are already linked to this patient.' });
      }
      if (existing.status === 'pending') {
        return res.status(400).json({ message: 'Your link request is already pending approval.' });
      }
      // 'revoked' — allow re-request (create a new record below)
      // But first clean up the old revoked record so the unique index allows re-insert
      await CaregiverAccess.deleteOne({ _id: existing._id });
    }

    await CaregiverAccess.create({
      patient:   patientProfile._id,
      user:      req.user.id,
      role,
      invitedBy: req.user.id,
      status:    'pending',
    });

    res.status(201).json({
      message: `Link request sent to ${targetUser.name}. Waiting for primary caregiver approval.`,
    });

  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ─── GET /api/v1/caregiver/access?patient=<patientId> ───────────────────────
// List all access records for a patient (useful for the approval UI).
// Requires: caller has at least 'view' access to that patient.
router.get('/access', verifyToken, async (req, res) => {
  try {
    const { patient: patientId } = req.query;
    if (!patientId) return res.status(400).json({ message: 'patient query param required.' });

    const ok = await canAccess(req.user.id, patientId, 'view');
    if (!ok) return res.status(403).json({ message: 'Forbidden.' });

    const links = await CaregiverAccess.find({ patient: patientId })
      .populate('user', 'name phone')
      .populate('invitedBy', 'name')
      .lean();

    res.status(200).json(links);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ─── POST /api/v1/caregiver/access/:id/approve ──────────────────────────────
// Approve a pending access request. Primary caregiver only.
router.post('/access/:id/approve', verifyToken, async (req, res) => {
  try {
    const link = await CaregiverAccess.findById(req.params.id);
    if (!link) return res.status(404).json({ message: 'Access request not found.' });
    if (link.status !== 'pending') {
      return res.status(400).json({ message: `Cannot approve a '${link.status}' request.` });
    }

    // Only the primary caregiver of this patient can approve
    const ok = await canAccess(req.user.id, link.patient.toString(), 'primary');
    if (!ok) return res.status(403).json({ message: 'Only the primary caregiver can approve.' });

    link.status     = 'active';
    link.approvedAt = new Date();
    await link.save();

    res.status(200).json({ message: 'Access approved.', link });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ─── POST /api/v1/caregiver/access/:id/revoke ───────────────────────────────
// Revoke an active or pending link. Takes effect immediately. Primary caregiver only.
router.post('/access/:id/revoke', verifyToken, async (req, res) => {
  try {
    const link = await CaregiverAccess.findById(req.params.id);
    if (!link) return res.status(404).json({ message: 'Access record not found.' });
    if (link.status === 'revoked') {
      return res.status(400).json({ message: 'Already revoked.' });
    }

    const ok = await canAccess(req.user.id, link.patient.toString(), 'primary');
    if (!ok) return res.status(403).json({ message: 'Only the primary caregiver can revoke.' });

    link.status    = 'revoked';
    link.revokedAt = new Date();
    await link.save();

    res.status(200).json({ message: 'Access revoked immediately.', link });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ─── GET /api/v1/caregiver/dashboard ────────────────────────────────────────
// Return the list of patients this caregiver has ACTIVE access to, with
// their medication status summary.
// #8 fix: missed count uses status 'missed' and 'alerted', not 'due'.
router.get('/dashboard', verifyToken, async (req, res) => {
  try {
    // Find all ACTIVE access records for this user
    const activeLinks = await CaregiverAccess.find({
      user:   req.user.id,
      status: 'active',
    }).lean();

    if (activeLinks.length === 0) return res.status(200).json([]);

    const patientIds = activeLinks.map(l => l.patient);
    const patients   = await Patient.find({ _id: { $in: patientIds } })
      .populate('user', 'name phone')
      .lean();

    const now = new Date();

    const dashboardData = await Promise.all(patients.map(async (patient) => {
      const medicines = await Medicine.find({ patient: patient._id, isActive: true }).lean();

      let skippedCount = 0;
      let missedCount  = 0;
      const actionRequired = [];

      for (const med of medicines) {
        const currentReminder = await Reminder.findOne({
          medicine:      med._id,
          scheduledTime: { $lte: now },
        }).sort({ scheduledTime: -1 });

        if (currentReminder) {
          if (currentReminder.status === 'skipped') {
            skippedCount++;
            actionRequired.push({ ...med, alert: 'Skipped intentionally' });
          } else if (
            currentReminder.status === 'missed' ||    // #8: 'missed' (was 'due')
            currentReminder.status === 'alerted'      // overdue and caregiver alerted
          ) {
            missedCount++;
            actionRequired.push({ ...med, alert: 'No response from patient' });
          }
        }
      }

      const healthStatus = (skippedCount > 0 || missedCount > 0) ? 'critical' : 'good';

      return {
        patientId: patient._id,
        name:      patient.user.name,
        phone:     patient.user.phone,
        healthStatus,
        activePrescriptions: medicines.length,
        actionRequired,
      };
    }));

    res.status(200).json(dashboardData);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ─── GET /api/v1/caregiver/patients/:patientId/history ──────────────────────
// 7-day reminder history for a specific patient.
// Requires: active 'view' access or higher.
router.get('/patients/:patientId/history', verifyToken, async (req, res) => {
  try {
    const ok = await canAccess(req.user.id, req.params.patientId, 'view');
    if (!ok) return res.status(403).json({ message: 'Unauthorized' });

    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - 6);
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const history = await Reminder.find({
      patient:       req.params.patientId,
      scheduledTime: { $gte: startOfWeek, $lte: endOfToday },
    })
      .populate('medicine', 'name dosage mealTiming')
      .sort({ scheduledTime: -1 })
      .lean();

    res.status(200).json(history);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
