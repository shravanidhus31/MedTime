const mongoose = require('mongoose');

/**
 * AgentRun — Contract C2
 *
 * Comprehensive audit trail of every autonomous or supervised job
 * performed by the AI agents (dose calls, call-ins, journal generation, etc.).
 *
 * Each run logs:
 * - trigger: 'dose' | 'callin' | 'chat' | 'journal' | 'prescription' | 'copilot'
 * - steps: tool calls with timing, inputs, outputs, and role origin
 * - outcome: structured final decision and status
 */
const agentStepSchema = new mongoose.Schema(
  {
    tool: {
      type: String,
      required: true,
    },
    input: {
      type: mongoose.Schema.Types.Mixed,
    },
    output: {
      type: mongoose.Schema.Types.Mixed,
    },
    label: {
      type: String,
      enum: ['patient_said', 'agent_noticed', 'action_taken'],
      default: 'action_taken',
    },
    summaryText: {
      type: String, // Plain-language summary for the UI timeline
    },
    ms: {
      type: Number,
      default: 0,
    },
    at: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const agentRunSchema = new mongoose.Schema(
  {
    trigger: {
      type: String,
      enum: ['dose', 'callin', 'chat', 'journal', 'prescription', 'copilot', 'manual'],
      required: true,
      index: true,
    },
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
      index: true,
    },
    reminder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Reminder',
      default: null,
    },
    flow: {
      type: String,
      default: 'dose',
    },
    steps: [agentStepSchema],
    outcome: {
      type: String, // e.g. 'Dose verified and recorded as taken', 'Caregiver alert queued'
      default: '',
    },
    status: {
      type: String,
      enum: ['running', 'completed', 'waiting_for_approval', 'failed', 'cancelled'],
      default: 'completed',
      index: true,
    },
    promptVersion: {
      type: String,
      default: '1.0.0',
    },
    model: {
      type: String,
      default: 'groq/gpt-oss-20b',
    },
    approver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

agentRunSchema.index({ patient: 1, createdAt: -1 });

module.exports = mongoose.model('AgentRun', agentRunSchema);
