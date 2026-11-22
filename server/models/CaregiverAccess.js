const mongoose = require('mongoose');

/**
 * CaregiverAccess — B1.1 (contract C3)
 *
 * Tracks who can access a patient's data and at what privilege level.
 * Role order:  view < approve < primary
 * 'doctor' is a separate lane used only for Level-2 approvals.
 *
 * A link starts 'pending' and becomes 'active' only after the patient's
 * primary caregiver calls POST /caregiver/access/:id/approve.
 * Revocation takes effect immediately.
 */
const caregiverAccessSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ['view', 'approve', 'primary', 'doctor'],
      required: true,
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User', // the user who initiated the link request
    },
    status: {
      type: String,
      enum: ['pending', 'active', 'revoked'],
      default: 'pending',
    },
    approvedAt: { type: Date },
    revokedAt:  { type: Date },
  },
  { timestamps: true }
);

// A user may have at most one active/pending link per patient
caregiverAccessSchema.index({ patient: 1, user: 1 }, { unique: true });

module.exports = mongoose.model('CaregiverAccess', caregiverAccessSchema);
