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
  }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);