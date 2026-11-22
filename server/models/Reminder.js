const mongoose = require('mongoose');

const reminderSchema = new mongoose.Schema({
  medicine: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Medicine',
    required: true
  },
  patient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Patient',
    required: true
  },
  scheduledTime: {
    type: Date, // Exact Date and Time this specific dose is due
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'alerted', 'taken', 'skipped', 'missed'],
    default: 'pending'
  },
  alertedAt: {
    type: Date // Populated when Twilio fires the message
  },
  confirmedAt: {
    type: Date // Populated when patient responds
  },
  confirmedBy: {
    type: String,
    enum: ['app', 'sms', 'ivr', 'speech', 'agent'], // How did they confirm? (speech/agent: A2.5)
  },
  caregiverNotified: {
    type: Boolean,
    default: false
  },
  caregiverNotifiedAt: {
    type: Date
  },
  // ─── Per-dose escalation (A1.3) ─────────────────────────────────────────────
  // Moved here from Medicine, so each dose is called, snoozed and escalated on its
  // own. The old Medicine fields stay in that schema, unused, until Person B removes them.
  // When snoozed: when to call again. null = not snoozed.
  snoozeUntil: {
    type: Date,
    default: null
  },
  // If the dose isn't confirmed by this time, the caregiver is alerted. null = disarmed.
  caregiverAlertTime: {
    type: Date,
    default: null
  },
  // Persists the "missed, caregiver alerted" state for the UI. Cleared on confirmation.
  caregiverAlerted: {
    type: Boolean,
    default: false
  },
  attempts: {
    type: Number, // calls tried for this dose (first call + re-calls after a snooze)
    default: 0
  },
  lastCallAt: {
    type: Date
  },
  callError: {
    type: String // why the last call couldn't be placed, if it couldn't
  },
  // Missed-dose alert to the caregiver (a phone call on the trial). If no call could be
  // placed, alertFailed is set and the next ticks retry, up to 3 tries in all.
  alertAttempts: {
    type: Number,
    default: 0
  },
  alertFailed: {
    type: Boolean,
    default: false
  },
  alertError: {
    type: String
  },
  // SMS reminder retries (A1.2): at most 3 tries, then smsFailed stops the job
  // picking this reminder up again every 10 seconds.
  smsAttempts: {
    type: Number,
    default: 0
  },
  smsFailed: {
    type: Boolean,
    default: false
  },
  smsFailReason: {
    type: String
  }
}, { timestamps: true });

// We will need to query pending reminders quickly, so let's add an index
reminderSchema.index({ scheduledTime: 1, status: 1 });
// The escalation cron (A1.3) looks these up every minute.
reminderSchema.index({ medicine: 1, scheduledTime: 1 });
reminderSchema.index({ caregiverAlertTime: 1 });
reminderSchema.index({ snoozeUntil: 1 });

module.exports = mongoose.model('Reminder', reminderSchema);