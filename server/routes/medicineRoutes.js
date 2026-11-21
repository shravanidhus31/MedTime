/**
 * Medicine routes — ISSUES #1, #19, B1.3
 *
 * Changes vs. original:
 *  - PUT /:id and DELETE /:id require requirePatientAccess('approve')
 *  - POST /:id/status requires requirePatientAccess('view') (patient can mark their own)
 *  - PUT /:id whitelists updatable fields; prevents overwriting patient, _id, escalation fields
 *  - DELETE /:id is a SOFT DELETE: sets isActive=false, deletedAt, deletedBy;
 *      keeps past Reminders (for history), deletes only future ones
 *  - Duplicate DELETE /:id removed (#19 — Express runs the first match; the second was dead code)
 *  - GET / still filters isActive: true (unchanged)
 */

const express  = require('express');
const Medicine = require('../models/Medicine');
const Reminder = require('../models/Reminder');
const Patient  = require('../models/Patient');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');
const { requirePatientAccess }     = require('../middleware/access');

const router = express.Router();

// ─── Whitelist of fields that PUT /:id is allowed to change ─────────────────
// Prevents overwriting patient, _id, soft-delete fields, or escalation state.
const ALLOWED_UPDATE_FIELDS = new Set([
  'name', 'dosage', 'type', 'frequency', 'scheduledTimes',
  'mealTiming', 'notificationType', 'startDate', 'endDate',
  'tabletCount', 'refillThreshold',
  // C10 step-by-step guidance fields
  'pillDescription', 'pillboxSlot', 'locationHint',
]);

// ─── POST /api/v1/medicines ─────────────────────────────────────────────────
// Add a new medicine and auto-generate reminders for the next 7 days.
// (Patient's own record or a caregiver with 'approve'+ access)
router.post('/', verifyToken, requireRole(['patient', 'caregiver']), async (req, res) => {
  try {
    const {
      name, dosage, type, frequency, scheduledTimes,
      mealTiming, startDate, tabletCount, notificationType,
      pillDescription, pillboxSlot, locationHint,
    } = req.body;
    const userId = req.user.id;

    // 1. Ensure the Patient profile exists (auto-create if missing)
    let patient = await Patient.findOne({ user: userId });
    if (!patient) {
      patient = new Patient({
        user: userId,
        emergencyContact: req.body.emergencyContact || '0000000000',
      });
      await patient.save();
    }

    // 2. Create the Medicine document
    const newMedicine = new Medicine({
      patient: patient._id,
      name, dosage, type, frequency,
      scheduledTimes,
      mealTiming,
      startDate: new Date(startDate),
      tabletCount,
      notificationType: notificationType || 'sms',
      // C10 fields
      pillDescription, pillboxSlot, locationHint,
    });

    await newMedicine.save();

    // 3. Auto-generate reminders for the next 7 days
    const remindersToCreate = [];
    const today = new Date();

    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const currentDate = new Date(today);
      currentDate.setDate(today.getDate() + dayOffset);

      for (const timeStr of scheduledTimes) {
        const [hours, minutes] = timeStr.split(':').map(Number);
        const reminderTime = new Date(currentDate);
        // Render runs UTC; scheduledTimes are IST strings → subtract 5 h 30 m
        reminderTime.setUTCHours(hours - 5, minutes - 30, 0, 0);

        if (reminderTime > new Date()) {
          remindersToCreate.push({
            medicine:      newMedicine._id,
            patient:       patient._id,
            scheduledTime: reminderTime,
            status:        'pending',
          });
        }
      }
    }

    if (remindersToCreate.length > 0) {
      await Reminder.insertMany(remindersToCreate);
    }

    res.status(201).json({
      message: 'Medicine added and reminders generated successfully.',
      medicine: newMedicine,
      remindersGenerated: remindersToCreate.length,
    });

  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ─── GET /api/v1/medicines ──────────────────────────────────────────────────
// Get all active medicines for the logged-in patient, with current dose status.
router.get('/', verifyToken, async (req, res) => {
  try {
    const patient = await Patient.findOne({ user: req.user.id });
    if (!patient) return res.status(200).json([]);

    const medicines = await Medicine.find({ patient: patient._id, isActive: true }).lean();
    const now = new Date();

    const medicinesWithStatus = await Promise.all(medicines.map(async (med) => {
      const currentReminder = await Reminder.findOne({
        medicine:      med._id,
        scheduledTime: { $lte: now },
      }).sort({ scheduledTime: -1 });

      let displayStatus = 'upcoming';
      if (currentReminder) {
        if (currentReminder.status === 'taken')   displayStatus = 'taken';
        else if (currentReminder.status === 'skipped') displayStatus = 'skipped';
        else displayStatus = 'due';
      }

      return { ...med, status: displayStatus };
    }));

    res.status(200).json(medicinesWithStatus);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ─── POST /api/v1/medicines/:id/status ─────────────────────────────────────
// Manually mark a dose taken or skipped from the web UI.
// Requires at least 'view' access (the patient themselves, or any linked caregiver).
// NOTE: Person A will move this handler to doseRoutes.js on Friday (section 0.2).
//       The ownership check below stays; A imports it from this file or keeps it.
router.post(
  '/:id/status',
  verifyToken,
  requirePatientAccess('view'),   // #1: ownership check added
  async (req, res) => {
    try {
      const { status } = req.body; // 'taken' or 'skipped'

      const recentReminder = await Reminder.findOne({
        medicine:      req.params.id,
        scheduledTime: { $lte: new Date() },
      }).sort({ scheduledTime: -1 });

      if (recentReminder) {
        recentReminder.status = status;
        await recentReminder.save();
        res.status(200).json({ message: `Medicine marked as ${status}` });
      } else {
        res.status(404).json({ message: 'No pending reminder found to update right now.' });
      }
    } catch (error) {
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }
);

// ─── PUT /api/v1/medicines/:id ──────────────────────────────────────────────
// Edit an existing medicine.
// Requires 'approve' access (caregiver or patient themselves).
// Whitelists updatable fields; silently ignores anything not on the list.
router.put(
  '/:id',
  verifyToken,
  requirePatientAccess('approve'),  // #1
  async (req, res) => {
    try {
      // Build a safe update object from whitelisted fields only (#1)
      const safeUpdate = {};
      for (const [key, value] of Object.entries(req.body)) {
        if (ALLOWED_UPDATE_FIELDS.has(key)) {
          safeUpdate[key] = value;
        }
      }

      const updatedMed = await Medicine.findByIdAndUpdate(
        req.params.id,
        safeUpdate,
        { new: true, runValidators: true }
      );

      if (!updatedMed) return res.status(404).json({ message: 'Medicine not found.' });

      // Note: future-reminder regeneration on time change is tracked as #6 (week 3).
      res.status(200).json({ message: 'Medicine updated', medicine: updatedMed });
    } catch (error) {
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }
);

// ─── DELETE /api/v1/medicines/:id ──────────────────────────────────────────
// Soft-delete: marks isActive=false, records who deleted it and when.
// Keeps past Reminders (history/journal), deletes only future ones.
// Requires 'approve' access.
// (The second duplicate DELETE from the original file is removed — #19.)
router.delete(
  '/:id',
  verifyToken,
  requirePatientAccess('approve'),  // #1
  async (req, res) => {
    try {
      const medicine = await Medicine.findById(req.params.id);
      if (!medicine) return res.status(404).json({ message: 'Medicine not found.' });

      // Soft-delete the medicine
      medicine.isActive   = false;
      medicine.deletedAt  = new Date();
      medicine.deletedBy  = req.user.id;
      await medicine.save();

      // Delete only FUTURE reminders (past ones stay for history and the journal)
      await Reminder.deleteMany({
        medicine:      medicine._id,
        scheduledTime: { $gt: new Date() },
        status:        'pending',  // don't remove already-alerted ones
      });

      res.status(200).json({ message: 'Medicine deactivated and future reminders cleared.' });
    } catch (error) {
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }
);

module.exports = router;
