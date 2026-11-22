const mongoose = require('mongoose');

/**
 * LifeNote — B9 (Memory Graph)
 *
 * Stores biographical, routine, person, and sensitive topic notes
 * that the agent uses to answer questions during call-in (Feature 7)
 * and provide conversational continuity (MeBo, DEMENTIA-PLAN).
 */
const lifeNoteSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
      index: true,
    },
    writtenBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    kind: {
      type: String,
      enum: ['person', 'place', 'routine', 'event', 'topic_answer'],
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    text: {
      type: String,
      required: true,
    },
    linkedRecordingId: {
      type: String, // Optional phrase bank clip ID if recorded
      default: null,
    },
    approved: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('LifeNote', lifeNoteSchema);
