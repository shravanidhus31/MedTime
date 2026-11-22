const mongoose = require('mongoose');

/**
 * WeeklyReview Schema — B14 (Features 1 & 3: Weekly Cognitive & Behavioral Review)
 *
 * Generated weekly (Sundays) per PRD Feature 1 & Plan Section 6.5.
 * Analyzes speech latency, repetition, and vocabulary richness against patient's
 * 4-week baseline at the same time of day.
 *
 * Rules:
 * 1. Change must persist 2 weeks in a row (>25% margin to start).
 * 2. Checks non-cognitive explanations (medicine change, poor call quality).
 * 3. Feature 3: Sundowning evening-only patterns propose schedule/calming changes.
 */

const WeeklyReviewSchema = new mongoose.Schema({
  patient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Patient',
    required: true,
    index: true,
  },
  weekStartDate: {
    type: Date,
    required: true,
  },
  weekEndDate: {
    type: Date,
    required: true,
  },
  baselineMetrics: {
    latencyMs: { type: Number, default: 0 },
    speechRateWpm: { type: Number, default: 0 },
    repeatedPhrasesAvg: { type: Number, default: 0 },
  },
  currentWeekMetrics: {
    latencyMs: { type: Number, default: 0 },
    speechRateWpm: { type: Number, default: 0 },
    repeatedPhrasesAvg: { type: Number, default: 0 },
  },
  deltas: {
    latencyPercent: { type: Number, default: 0 },
    speechRatePercent: { type: Number, default: 0 },
    repeatedPhrasesPercent: { type: Number, default: 0 },
  },
  findings: [
    {
      metric: String,
      flagged: Boolean,
      severity: { type: String, enum: ['info', 'warning', 'clinical_flag'], default: 'info' },
      observedChange: String,
      explanation: String,      // e.g. "Likely side effect of Metoprolol dose increase on Nov 10"
      hasAlternativeCause: Boolean,
      quotes: [String],         // Quotes only, no invented differences
    },
  ],
  sundowning: {
    detected: { type: Boolean, default: false },
    eveningEventCount: { type: Number, default: 0 },
    weeksObserved: { type: Number, default: 0 },
    suggestedIntervention: {
      type: String,
      enum: ['none', 'call_time_change', 'calming_clip_first'],
      default: 'none',
    },
    proposalId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProposedChange' },
  },
  doctorReportSummary: {
    type: String,
    default: '',
  },
  caregiverFeedback: {
    markedAccurate: { type: Boolean, default: null },
    caregiverNotes: { type: String, default: '' },
    adjustedMarginPercent: { type: Number, default: 25 },
  },
  status: {
    type: String,
    enum: ['draft', 'published', 'shared_with_doctor'],
    default: 'published',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

WeeklyReviewSchema.index({ patient: 1, weekEndDate: -1 });

module.exports = mongoose.model('WeeklyReview', WeeklyReviewSchema);
