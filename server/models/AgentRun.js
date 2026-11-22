const mongoose = require('mongoose');

// One run of the agent: a dose call, a call-in, a journal write, a prescription read ...
// (contract C2; A2.3, merged with Person B's fields at integration).
// Every step is stored as it happens, so a run is recorded even if the server stops mid-call.
// Person B's Activity panel, the journal and the evaluation harness read these.
//
// Written by both sides, so a few fields are deliberately loose:
// - trigger: free text. Person A uses 'dose_due', 'simulate', ...; Person B uses 'callin',
//   'journal', 'prescription_upload', 'dose' (seed data), ...
// - outcome: free text. Person A's loop uses 'done' | 'queued_for_approval' | 'fallback';
//   Person B writes a short sentence ("Journal generated with 5 lines").
// - status: the union of both sides' values.

const stepSchema = new mongoose.Schema(
  {
    tool: { type: String, required: true },
    input: { type: mongoose.Schema.Types.Mixed },
    output: { type: mongoose.Schema.Types.Mixed },
    ms: { type: Number },
    at: { type: Date, required: true, default: Date.now },
    approvalLevel: { type: Number }, // 0 agent alone, 1 caregiver, 2 doctor
    proposalId: { type: String }, // set when the step was queued for approval
    // Person B's timeline fields (Activity panel, journal): where the line comes from, and a
    // plain-language line to show instead of the raw input.
    label: { type: String, enum: ['patient_said', 'agent_noticed', 'action_taken'] },
    summaryText: { type: String },
    // Older step shape used by some of Person B's writers ({ step, summary }); mapped onto
    // tool / summaryText before validation, so those runs save instead of failing (review, 22 Nov).
    step: { type: String },
    type: { type: String },
    summary: { type: String },
  },
  { _id: false },
);

stepSchema.pre('validate', function mapOldShape() {
  if (!this.tool) this.tool = this.step || this.type || 'note';
  if (!this.summaryText && this.summary) this.summaryText = this.summary;
});

const agentRunSchema = new mongoose.Schema(
  {
    trigger: { type: String, required: true },
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', index: true },
    reminder: { type: mongoose.Schema.Types.ObjectId, ref: 'Reminder' },
    flow: { type: String }, // 'dose' | 'callin' | 'chat' | 'journal' | ...
    status: {
      type: String,
      // 'running' → 'finished' | 'failed' (Person A); 'completed' | 'waiting_for_approval' |
      // 'waiting_for_caregiver' | 'cancelled' (Person B).
      enum: ['running', 'finished', 'completed', 'waiting_for_approval', 'waiting_for_caregiver', 'failed', 'cancelled'],
      default: 'running',
      index: true,
    },
    outcome: { type: String, default: null },
    fallbackReason: { type: String },
    error: {
      kind: { type: String },
      message: { type: String },
    },
    text: { type: String }, // the agent's final reply or a one-line summary, if any
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
agentRunSchema.index({ patient: 1, createdAt: -1 });

module.exports = mongoose.model('AgentRun', agentRunSchema);
