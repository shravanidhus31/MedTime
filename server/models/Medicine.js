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
  }
}, { timestamps: true });

module.exports = mongoose.model('Medicine', medicineSchema);