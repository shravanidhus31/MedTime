const mongoose = require('mongoose');

// One alert to one caregiver (A2.5). On the Twilio trial, alerts are phone calls: Twilio fetches
// the spoken message from POST /api/v1/webhooks/voice/alert?alertId=..., because the trial
// rejects inline TwiML. The record also lets the dashboard and journal show what was sent.

const caregiverAlertSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    caregiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // null when sent to emergencyContact
    phone: { type: String, required: true },
    reason: {
      type: String,
      enum: ['red_flag', 'missed_dose', 'unsure_dose', 'handover', 'other'],
      required: true,
    },
    message: { type: String, required: true }, // what the caregiver hears
    channel: { type: String, enum: ['call', 'sms'], default: 'call' },
    status: {
      type: String,
      enum: ['queued', 'calling', 'simulated', 'failed'],
      default: 'queued',
    },
    callSid: { type: String },
    error: { type: String },
    run: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentRun' },
  },
  { timestamps: true },
);

module.exports = mongoose.model('CaregiverAlert', caregiverAlertSchema);
