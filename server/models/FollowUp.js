// A concern she mentioned on a call, to ask about once on a later call (A4.3, the Planner).
// PRD model: patient, concern, sourceRun, quote, status, nextAsk.
//   concern   one of the fixed list (agent/flows/followups.js CONCERNS), so every question line
//             exists in the phrase bank
//   quote     her own words, exactly
//   asks      how many times it has been asked; closed after 3
//   status    open → closed ('better', 'asked_3_times', 'caregiver', 'visited')
const mongoose = require('mongoose');

const followUpSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    concern: { type: String, required: true },
    sourceRun: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentRun' },
    quote: { type: String, default: '' },
    status: { type: String, enum: ['open', 'closed'], default: 'open', index: true },
    nextAsk: { type: Date, default: Date.now },
    asks: { type: Number, default: 0 },
    lastAskedAt: { type: Date },
    lastAskedRun: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentRun' },
    lastAnswer: { type: String },
    closedReason: { type: String },
    closedAt: { type: Date },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

module.exports = mongoose.model('FollowUp', followUpSchema);
