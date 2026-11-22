const mongoose = require('mongoose');

/**
 * Observation Schema — B14 (Speech & Behavioral Observations)
 *
 * Stores individual behavioral and speech metrics captured from calls:
 * - Browser calls: audio-derived latency, speech rate, turn length
 * - Phone calls: transcript-derived measures
 * - Delete audio afterwards; keep only structured observation rows
 */

const ObservationSchema = new mongoose.Schema({
  patient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Patient',
    required: true,
    index: true,
  },
  callId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AgentRun',
  },
  callType: {
    type: String,
    enum: ['browser', 'phone', 'simulation', 'chat'], // chat: the weekly chat call (metadata.channel)
    default: 'simulation',
  },
  source: {
    type: String,
    enum: ['code', 'llm'],
    default: 'code',
  },
  metric: {
    type: String,
    required: true,
    enum: [
      'latencyMs',             // Time before answering in milliseconds
      'speechRateWpm',          // Words per minute
      'turnLengthWords',        // Average words per turn
      'fillersCount',           // "um", "ah", "you know", word-finding pauses
      'repeatedPhrasesCount',   // Back-to-back repeated phrases
      'sundowningAnxietyCount', // Evening confusion/anxiety indications
      'sentimentScore',         // Optional sentiment polarity
      // Measured from every call's transcript (fix 8, agent/observations.js)
      'clarificationCount',     // "What?", "say that again", "क्या?" — needed things repeated
      'unclearTurns',           // answers the agent could not follow
      'turnsToConfirm',         // her answers until the dose was confirmed
      'checkFails',             // could not say which tablet when asked
      'silentTurns',            // no answer to a question
      'asrConfidence',          // speech recognition confidence (call quality), 0-1
      // The weekly chat call, the speech-screening paper's measures (agent/languageMeasures.js)
      'mtld', 'hdd', 'brunetW', 'cttr', // length-corrected vocabulary
      'nounShare', 'verbShare',         // English only
      'wordCount',                      // how much she said
      // step-by-step guidance (Feature 4)
      'stepCorrections',                // steps that needed a simpler hint
      'stepSeconds',                    // average time to do a step
    ],
  },
  value: {
    type: Number,
    required: true,
  },
  timeOfDay: {
    type: String,
    enum: ['morning', 'afternoon', 'evening', 'night'],
    required: true,
    index: true,
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

ObservationSchema.index({ patient: 1, metric: 1, timeOfDay: 1, timestamp: -1 });

module.exports = mongoose.model('Observation', ObservationSchema);
