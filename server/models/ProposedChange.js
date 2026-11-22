const mongoose = require('mongoose');

/**
 * ProposedChange — B4 (contract C5)
 *
 * Supervised agent proposals (L1 caregiver approval, L2 doctor approval).
 * Created by tools such as propose_change (Planner, Prescription agent, etc.)
 */
const proposedChangeSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
      index: true,
    },
    kind: {
      type: String, // e.g. 'new_schedule', 'schedule_override', 'call_time_change', 'calming_clip_first'
      required: true,
      index: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    evidence: {
      type: String, // Why the agent is proposing this (quotes, OCR snippets, timing patterns)
      required: true,
    },
    level: {
      type: Number,
      enum: [1, 2], // 1 = Caregiver approval, 2 = Doctor approval
      required: true,
      default: 1,
    },
    status: {
      type: String,
      // 'escalated': sent to the doctor (prescription review); was missing, so escalating failed
      enum: ['pending', 'approved', 'rejected', 'expired', 'escalated'],
      default: 'pending',
      index: true,
    },
    createdByRun: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AgentRun',
    },
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    decidedAt: {
      type: Date,
    },
    reason: {
      type: String, // Caregiver or doctor's note on decision
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ProposedChange', proposedChangeSchema);
