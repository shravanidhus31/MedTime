/**
 * JournalEntry — model file only (B8 fields; logic added in week 2)
 *
 * Each entry is one evening's care note for a dementia-mode patient.
 * Every line must have a source that links it back to an AgentRun or
 * Observation; a line without a source is rejected by the write_journal tool.
 */

const mongoose = require('mongoose');

const lineSchema = new mongoose.Schema(
  {
    text:        { type: String, required: true },
    source: {
      type: String,
      enum: ['patient_said', 'agent_noticed', 'action_taken'],
      required: true,
    },
    runId:          { type: mongoose.Schema.Types.ObjectId, ref: 'AgentRun' },
    observationId:  { type: mongoose.Schema.Types.ObjectId },
    markedWrong:    { type: Boolean, default: false },
  },
  { _id: false }
);

const journalEntrySchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
      index: true,
    },
    // Calendar date (midnight UTC) — one entry per patient per day
    date: {
      type: Date,
      required: true,
    },
    lines: [lineSchema],
    // Set to true once the caregiver has been notified (dashboard badge)
    notified: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

journalEntrySchema.index({ patient: 1, date: -1 });

module.exports = mongoose.model('JournalEntry', journalEntrySchema);
