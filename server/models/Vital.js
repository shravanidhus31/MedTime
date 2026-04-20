const mongoose = require('mongoose');

const vitalSchema = new mongoose.Schema({
  patientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    // required: true // Uncomment if you have auth wired up perfectly
  },
  sys: { type: Number, required: true }, // Systolic (Top number)
  dia: { type: Number, required: true }, // Diastolic (Bottom number)
  sugar: { type: Number }, // mg/dL
  pulse: { type: Number }, // bpm
  status: {
    type: String,
    enum: ['Normal', 'Elevated', 'High', 'Critical'],
    default: 'Normal'
  },
  recordedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Vital', vitalSchema);