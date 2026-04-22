const mongoose = require('mongoose');

const medicineSchema = new mongoose.Schema({
  patient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Patient',
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  dosage: {
    type: String, // e.g., '500mg'
    required: true
  },
  type: {
    type: String, // e.g., 'tablet', 'syrup', 'injection'
    required: true
  },
  frequency: {
    type: String,
    enum: ['once', 'twice', 'thrice', 'custom'],
    required: true
  },
  scheduledTimes: [{
    type: String, // Stored as 'HH:mm' format (e.g., '08:00')
    required: true
  }],
  mealTiming: {
    type: String,
    enum: ['before', 'after', 'with', 'any'],
    default: 'any'
  },
  notificationType: {
    type: String,
    enum: ['sms', 'call'],
    default: 'sms'
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date // Optional: if null, it's a continuous prescription
  },
  tabletCount: {
    type: Number, // Current stock for refill tracking
    default: 0
  },
  refillThreshold: {
    type: Number,
    default: 5
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // ─── Escalation Engine Fields ────────────────────────────────────────────────
  // When snoozed: holds the future time to re-call the patient. null = not snoozed.
  snoozeUntil: {
    type: Date,
    default: null
  },
  // The deadline: if patient hasn't pressed 1 by this time, alert the caregiver.
  // null = clock is disarmed (confirmed, snoozed-pending, or Normal status).
  caregiverAlertTime: {
    type: Date,
    default: null
  },
  // Persists the "missed" state for the UI even after caregiverAlertTime is cleared.
  // Set to true when the caregiver SMS is sent. Reset to false when patient confirms (presses 1).
  caregiverAlerted: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

module.exports = mongoose.model('Medicine', medicineSchema);