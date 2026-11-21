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
  // ─── Agent Flags (Contract C2, C7, PRD) ──────────────────────────────────
  dementiaMode: {
    type: Boolean,
    default: true
  },
  language: {
    type: String,
    enum: ['en', 'hi', 'mr'],
    default: 'en'
  },
  familyClipsEnabled: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

module.exports = mongoose.model('Patient', patientSchema);