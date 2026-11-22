// Dose endpoint (A1.4, PRD #14). Taken / skipped from the web app, for ONE dose.
//
//   POST /api/v1/doses/:id/status { status: 'taken' | 'skipped' }      (:id = the Reminder, i.e. the dose)
//     → { ok: true, reminder: { id, status, confirmedBy, confirmedAt }, alreadyRecorded? }
//
// Goes through markDose(..., 'app') (contract C4), so this dose's escalation is disarmed in the
// same write: no re-call and no caregiver alert after the patient has confirmed. The old
// POST /medicines/:id/status changed the status only, and the 10-minute caregiver clock kept
// running.
//
// Access: requirePatientAccess('primary') (Person B's C3): the patient themself, or a primary
// caregiver. The patient comes from the dose itself, never from the request body.

const express = require('express');
const { verifyToken } = require('../middleware/authMiddleware');
const { requirePatientAccess } = require('../middleware/access');
const { markDose } = require('../services/doseService');

const router = express.Router();
const ALLOWED = ['taken', 'skipped'];

router.post('/:id/status', verifyToken, requirePatientAccess('primary'), async (req, res) => {
  const { status } = req.body || {};
  if (!ALLOWED.includes(status)) return res.status(400).json({ message: `"status" must be one of ${ALLOWED.join(', ')}.` });
  try {
    const r = await markDose(req.params.id, status, 'app');
    if (!r.ok) return res.status(400).json({ message: r.error });
    const d = r.reminder;
    return res.json({
      ok: true,
      alreadyRecorded: !!r.alreadyRecorded, // a dose already taken stays taken
      reminder: { id: String(d._id), status: d.status, confirmedBy: d.confirmedBy, confirmedAt: d.confirmedAt },
    });
  } catch (err) {
    console.error('[doseRoutes] status failed:', err.message);
    return res.status(500).json({ message: 'Could not record the dose.' });
  }
});

module.exports = router;
