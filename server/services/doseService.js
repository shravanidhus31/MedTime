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

// Snooze one open dose: call again in `minutes`, caregiver clock paused till then (same as keypad 2).
// Returns true if the dose was still open and is now snoozed.
async function snoozeDose(reminderId, minutes = 10, now = new Date()) {
  if (!mongoose.isValidObjectId(reminderId)) return false;
  const r = await Reminder.updateOne(
    { _id: reminderId, status: { $in: ['pending', 'alerted'] } },
    { $set: { snoozeUntil: new Date(now.getTime() + minutes * 60 * 1000), caregiverAlertTime: null } },
  );
  return r.modifiedCount > 0;
}

// The agent has already phoned the caregiver about this dose (unsure, hand-over, "took it but it
// isn't recorded"): disarm its escalation clock so they don't also get a "missed dose" call.
// The dose itself stays open: nothing is recorded as taken or missed.
async function noteCaregiverInformed(reminderId, now = new Date()) {
  if (!mongoose.isValidObjectId(reminderId)) return false;
  const r = await Reminder.updateOne(
    { _id: reminderId, status: { $in: ['pending', 'alerted'] } },
    { $set: { caregiverAlertTime: null, snoozeUntil: null, caregiverNotified: true, caregiverNotifiedAt: now } },
  );
  return r.modifiedCount > 0;
}

module.exports = { markDose, snoozeDose, noteCaregiverInformed, STATUSES, SOURCES };
