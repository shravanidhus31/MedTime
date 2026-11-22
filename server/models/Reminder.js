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

module.exports = mongoose.model('Reminder', reminderSchema);