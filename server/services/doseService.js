// Dose service (contract C4). The one place a dose's status changes.
//
//   const { markDose } = require('./services/doseService');
//   const r = await markDose(reminderId, 'taken', 'agent');
//   // r = { ok: true, reminder, changed: true } | { ok: true, reminder, changed: false, alreadyRecorded: true }
//   //   | { ok: false, error }
//
// status: 'taken' | 'skipped' | 'missed'
// source: 'app' | 'sms' | 'ivr' | 'speech' | 'agent' | 'scheduler'
//         ('scheduler' = the escalation cron marking a dose missed, A1.3)
//
// Rules:
// - A dose already recorded as taken is never changed: no double recording, no flip-flopping.
//   The check is in the database write itself, so two calls at the same moment can't both win.
// - Confirming (taken/skipped) clears that dose's escalation in the same write (A1.3: the
//   fields live on each Reminder), so no more calls or caregiver alerts fire for it. Other
//   doses of the same medicine are not touched.
// - Emits 'dose.taken' | 'dose.skipped' | 'dose.missed' on server/events.js.

const mongoose = require('mongoose');
const Reminder = require('../models/Reminder');
const events = require('../events');

const STATUSES = ['taken', 'skipped', 'missed'];
const SOURCES = ['app', 'sms', 'ivr', 'speech', 'agent', 'scheduler'];

async function markDose(reminderId, status, source) {
  if (!mongoose.isValidObjectId(reminderId)) return { ok: false, error: 'Not a valid reminder id' };
  if (!STATUSES.includes(status)) return { ok: false, error: `status must be one of ${STATUSES.join(', ')}` };
  if (!SOURCES.includes(source)) return { ok: false, error: `source must be one of ${SOURCES.join(', ')}` };

  const now = new Date();
  const set = { status };
  if (status === 'taken' || status === 'skipped') {
    set.confirmedAt = now;
    set.confirmedBy = source;
    // Disarm this dose's escalation: no re-call, no caregiver alert, no red badge.
    set.snoozeUntil = null;
    set.caregiverAlertTime = null;
    set.caregiverAlerted = false;
  }

  // Only a dose that isn't already taken can change.
  const updated = await Reminder.findOneAndUpdate(
    { _id: reminderId, status: { $ne: 'taken' } },
    { $set: set },
    { returnDocument: 'after' },
  );

  if (!updated) {
    const existing = await Reminder.findById(reminderId);
    if (!existing) return { ok: false, error: 'Reminder not found' };
    return { ok: true, reminder: existing, changed: false, alreadyRecorded: true };
  }

  events.emit(`dose.${status}`, {
    reminderId: String(updated._id),
    medicineId: String(updated.medicine),
    patientId: String(updated.patient),
    status,
    source,
    at: now,
  });

  return { ok: true, reminder: updated, changed: true };
}

module.exports = { markDose, STATUSES, SOURCES };
