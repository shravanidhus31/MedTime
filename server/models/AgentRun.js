const mongoose = require('mongoose');

// One run of the agent: a dose call, a call-in, a journal write ... (A2.3, contract C2).
// Every step is stored as it happens, so a run is recorded even if the server stops mid-call.
// Person B's Activity panel, the journal and the evaluation harness read these.

const stepSchema = new mongoose.Schema(
  {
    tool: { type: String, required: true },
    input: { type: mongoose.Schema.Types.Mixed },
    output: { type: mongoose.Schema.Types.Mixed },
    ms: { type: Number },
    at: { type: Date, required: true },
    approvalLevel: { type: Number }, // 0 agent alone, 1 caregiver, 2 doctor
    proposalId: { type: String }, // set when the step was queued for approval
  },
  { _id: false },
);

const agentRunSchema = new mongoose.Schema(
  {
    trigger: {
      type: String,
      required: true, // e.g. 'dose_due', 'patient_call', 'simulate', 'evening_journal', 'prescription_scanned'
    },
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', index: true },
    reminder: { type: mongoose.Schema.Types.ObjectId, ref: 'Reminder' },
    flow: { type: String }, // 'dose' | 'callin' | 'chat' | 'journal' | ...
    status: {
      type: String,
      enum: ['running', 'finished', 'failed'],
      default: 'running',
    },
    outcome: {
      type: String,
      enum: ['done', 'queued_for_approval', 'fallback', null],
      default: null,
    },
    fallbackReason: { type: String },
    error: {
      kind: { type: String },
      message: { type: String },
    },
    text: { type: String }, // the agent's final reply, if any
    steps: [stepSchema],
    stepCount: { type: Number, default: 0 },
    promptVersion: { type: String },
    model: { type: String },
    llmCalls: { type: Number, default: 0 },
    usage: {
      inputTokens: { type: Number, default: 0 },
      outputTokens: { type: Number, default: 0 },
      reasoningTokens: { type: Number, default: 0 },
    },
    // Who approved a queued change, once someone does (filled by B's approval gate).
    approver: {
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      at: { type: Date },
    },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date },
    ms: { type: Number },
  },
  { timestamps: true },
);

agentRunSchema.index({ patient: 1, startedAt: -1 });

module.exports = mongoose.model('AgentRun', agentRunSchema);
