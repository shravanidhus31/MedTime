const mongoose = require('mongoose');

const patientSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  age: {
    type: Number
  },
  bloodGroup: {
    type: String
  },
  emergencyContact: {
    type: String, // Phone number
    required: true
  },
  conditions: [{
    type: String // e.g., 'hypertension', 'diabetes'
  }],
  caregivers: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    role: {
      type: String,
      default: 'primary'
    },
    permissions: {
      type: String,
      default: 'all'
    }
  }],
  preferredChannel: {
    type: String,
    enum: ['sms', 'whatsapp', 'voice', 'all'],
    default: 'sms'
  },
  elderlyMode: {
    type: Boolean,
    default: true
  },
  // ─── Agent settings (A2.6, Person A) ─────────────────────────────────────────
  // When true, dose calls are handed to the agent instead of the keypad flow.
  dementiaMode: {
    type: Boolean,
    default: false
  },
  // Language the agent speaks and listens in.
  language: {
    type: String,
    enum: ['en', 'hi', 'mr'],
    default: 'en'
  },
  // When true, approved family-voice clips are played on calls (Feature 5).
  familyClipsEnabled: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

module.exports = mongoose.model('Patient', patientSchema);