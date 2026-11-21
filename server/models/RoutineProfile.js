const mongoose = require('mongoose');

/**
 * RoutineProfile — B12 (Prescription-to-Schedule Agent, Feature 8)
 *
 * Stores a patient's daily time schedule so the prescription agent can fit
 * new medicines into their actual routine (meals, wake/sleep times, pillbox layout).
 *
 * When sameEveryDay is true, weekday schedule is used for all days.
 */

const timeSlotSchema = new mongoose.Schema(
  {
    wake:      { type: String, default: '07:00' }, // HH:mm IST
    breakfast: { type: String, default: '08:00' },
    lunch:     { type: String, default: '13:00' },
    dinner:    { type: String, default: '20:00' },
    bed:       { type: String, default: '22:00' },
  },
  { _id: false }
);

const pillboxSlotSchema = new mongoose.Schema(
  {
    label: { type: String }, // e.g. "Monday Morning", "Slot A"
    time:  { type: String }, // HH:mm when patient opens that compartment
  },
  { _id: false }
);

const routineProfileSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
      unique: true,
      index: true,
    },
    weekday: {
      type: timeSlotSchema,
      default: () => ({}),
    },
    weekend: {
      type: timeSlotSchema,
      default: () => ({}),
    },
    sameEveryDay: {
      type: Boolean,
      default: true,
    },
    pillbox: {
      type: {
        type: String,
        enum: ['weekly', 'daily', 'none'],
        default: 'none',
      },
      slots: [pillboxSlotSchema],
    },
    // Set true once a caregiver has confirmed this profile
    confirmed: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('RoutineProfile', routineProfileSchema);
