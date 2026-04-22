const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: false, // Optional for elderly patients who might only use phone
    trim: true,
    lowercase: true,
    sparse: true 
  },
  phone: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  passwordHash: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['patient', 'caregiver', 'nurse', 'doctor', 'admin'],
    default: 'patient'
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  refreshToken: {
    type: String,
    default: null
  },
  // ─── Inbox-First Doctor Reporting Engine ────────────────────────────────────
  linkedDoctor: {
    name: {
      type: String,
      trim: true,
      default: ''
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: ''
    },
    // When true, monthlyReportCron will auto-email this doctor every 1st of month
    autoSendMonthly: {
      type: Boolean,
      default: false
    }
  }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);