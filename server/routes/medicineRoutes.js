/**
 * Medicine routes — ISSUES #1, #19, B1.3
 *
 * Changes vs. original:
 *  - PUT /:id and DELETE /:id require requirePatientAccess('approve')
 *  - Taken/skipped moved to POST /api/v1/doses/:id/status (A1.4, routes/doseRoutes.js)
 *  - PUT /:id whitelists updatable fields; prevents overwriting patient, _id, escalation fields
 *  - DELETE /:id is a SOFT DELETE: sets isActive=false, deletedAt, deletedBy;
 *      keeps past Reminders (for history), deletes only future ones
 *  - Duplicate DELETE /:id removed (#19 — Express runs the first match; the second was dead code)
 *  - GET / still filters isActive: true (unchanged)
 */

const express = require('express');
const Medicine = require('../models/Medicine');
const Reminder = require('../models/Reminder');
const Patient = require('../models/Patient');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');
const { requirePatientAccess } = require('../middleware/access');
const { generateRemindersForMedicine, regenerateFutureReminders } = require('../jobs/reminderTopUpJob');
const RoutineProfile = require('../models/RoutineProfile');
const { foodTimingConflicts } = require('../services/scheduleFit');

const router = express.Router();

// ─── Whitelist of fields that PUT /:id is allowed to change ─────────────────
// Prevents overwriting patient, _id, soft-delete fields, or escalation state.
const ALLOWED_UPDATE_FIELDS = new Set([
  'name', 'dosage', 'type', 'frequency', 'scheduledTimes',
  'mealTiming', 'notificationType', 'startDate', 'endDate',
  'tabletCount', 'refillThreshold',
  // B12 extended frequencies
  'intervalDays', 'daysOfWeek',
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
      intervalDays, daysOfWeek,
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

    // 2. The same medicine at the same time already active? (22 Nov: the Save button could be pressed
    //    twice while the server was slow, making two medicines and so two reminder calls, a
    //    double-dose risk.) Refused unless the person confirms it is wanted (allowDuplicate).
    if (!req.body.allowDuplicate && name) {
      const escaped = String(name).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // the name, literally
      const same = await Medicine.findOne({
        patient: patient._id,
        isActive: true,
        name: { $regex: `^${escaped}$`, $options: 'i' },
        scheduledTimes: { $in: Array.isArray(scheduledTimes) ? scheduledTimes : [] },
      }).lean();
      if (same) {
        return res.status(409).json({
          message: `${same.name} at ${(same.scheduledTimes || []).join(', ')} is already in the list.`,
          duplicateOf: same._id,
        });
      }
    }

    // 3. Create the Medicine document
    const newMedicine = new Medicine({
      patient: patient._id,
      name, dosage, type, frequency,
      scheduledTimes,
      mealTiming,
      startDate: new Date(startDate),
      tabletCount,
      notificationType: notificationType || 'sms',
      intervalDays: intervalDays || null,
      daysOfWeek: daysOfWeek || undefined,
      // C10 fields
      pillDescription, pillboxSlot, locationHint,
    });

    await newMedicine.save();

    // 4. Auto-generate reminders for the next 7 days (B12 #5, #7)
    const { created } = await generateRemindersForMedicine(newMedicine);
    const routine = await RoutineProfile.findOne({ patient: patient._id }).lean();

    res.status(201).json({
      message: 'Medicine added and reminders generated successfully.',
      medicine: newMedicine,
      remindersGenerated: created,
      warnings: foodTimingConflicts(newMedicine, routine), // food rule vs her meals (B12)
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
      // The current dose: the latest one due in the last 24 hours, else the next one today.
      // Its escalation state is per dose (A1.3), so the badges come from the dose, not the medicine.
      const currentReminder =
        (await Reminder.findOne({ medicine: med._id, scheduledTime: { $lte: now, $gte: new Date(now - 24 * 3600 * 1000) } }).sort({ scheduledTime: -1 }).lean()) ||
        (await Reminder.findOne({ medicine: med._id, scheduledTime: { $gt: now, $lte: new Date(+now + 24 * 3600 * 1000) } }).sort({ scheduledTime: 1 }).lean());

      let displayStatus = 'upcoming';
      if (currentReminder && currentReminder.scheduledTime <= now) {
        if (currentReminder.status === 'taken') displayStatus = 'taken';
        else if (currentReminder.status === 'skipped') displayStatus = 'skipped';
        else if (currentReminder.status === 'missed') displayStatus = 'missed';
        else displayStatus = 'due';
      }

      // A1.4: the dose to send to POST /doses/:id/status, and its own escalation state. These
      // replace the old Medicine-level snoozeUntil / caregiverAlerted, which no longer change.
      return {
        ...med,
        status: displayStatus,
        todayReminderId: currentReminder ? String(currentReminder._id) : null,
        doseTime: currentReminder ? currentReminder.scheduledTime : null,
        caregiverAlerted: !!(currentReminder && currentReminder.caregiverAlerted),
        snoozeUntil: currentReminder && currentReminder.snoozeUntil && currentReminder.snoozeUntil > now ? currentReminder.snoozeUntil : null,
      };
    }));

    res.status(200).json(medicinesWithStatus);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// POST /api/v1/medicines/:id/status was removed in A1.4: taken / skipped now goes to
// POST /api/v1/doses/:id/status (routes/doseRoutes.js), one dose at a time, through markDose,
// which also disarms that dose's caregiver alert.

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
        { returnDocument: 'after', runValidators: true }
      );

      if (!updatedMed) return res.status(404).json({ message: 'Medicine not found.' });

      // Regenerate future reminders on edit (#6, B12)
      const regenResult = await regenerateFutureReminders(updatedMed._id);

      // Food rule vs her meals (B12): saved as asked, but the editor is told and offered a time.
      const routine = await RoutineProfile.findOne({ patient: updatedMed.patient }).lean();
      const warnings = foodTimingConflicts(updatedMed, routine);

      res.status(200).json({
        message: 'Medicine updated and future reminders regenerated.',
        medicine: updatedMed,
        reminders: regenResult,
        warnings,
      });
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
      medicine.isActive = false;
      medicine.deletedAt = new Date();
      medicine.deletedBy = req.user.id;
      await medicine.save();

      // Delete only FUTURE reminders (past ones stay for history and the journal)
      await Reminder.deleteMany({
        medicine: medicine._id,
        scheduledTime: { $gt: new Date() },
        status: 'pending',  // don't remove already-alerted ones
      });

      res.status(200).json({ message: 'Medicine deactivated and future reminders cleared.' });
    } catch (error) {
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }
);

module.exports = router;
