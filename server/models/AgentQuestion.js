const mongoose = require('mongoose');

/**
 * AgentQuestion — B4 (contract C6)
 *
 * Rare, targeted questions asked by the agent to caregivers when clarifying
 * ambiguous input or routine preferences (CHI 2025).
 * Answering resumes the corresponding AgentRun.
 */
const agentQuestionSchema = new mongoose.Schema(
  {
    run: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AgentRun',
      index: true,
    },
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
      index: true,
    },
    askedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User', // specific caregiver if targeted, or null for any authorized caregiver
    },
    question: {
      type: String,
      required: true,
    },
    choices: [{
      type: String, // e.g. ['Yes, take after lunch', 'No, keep current time']
    }],
    answer: {
      type: String,
      default: null,
    },
    answeredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    answeredAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ['pending', 'answered', 'expired'],
      default: 'pending',
      index: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AgentQuestion', agentQuestionSchema);
