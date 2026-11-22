/**
 * Access helper — contract C3
 *
 * canAccess(userId, patientId, minRole) → true | false
 *
 *   Checks whether userId has at least minRole access to patientId.
 *   The patient themselves always count as 'primary'.
 *   Role order: view < approve < primary
 *   'doctor' passes only where minRole === 'doctor'.
 *
 * requirePatientAccess(minRole) → Express middleware
 *
 *   Reads patientId from req.params.patientId (or req.body.patientId
 *   for POST handlers that accept it).  Sends 403 if access is
 *   insufficient; otherwise attaches req.patientDoc and calls next().
 */

const Patient        = require('../models/Patient');
const CaregiverAccess = require('../models/CaregiverAccess');

// Numeric weights for the tiered roles
const ROLE_WEIGHT = { view: 1, approve: 2, primary: 3 };

/**
 * Returns true if userId satisfies minRole for the given patientId.
 *
 * @param {string} userId     — req.user.id  (string from JWT)
 * @param {string} patientId  — Patient._id  (string)
 * @param {string} minRole    — 'view' | 'approve' | 'primary' | 'doctor'
 */
async function canAccess(userId, patientId, minRole) {
  // 1. Is the caller the patient themselves?
  const patientDoc = await Patient.findById(patientId).select('user');
  if (!patientDoc) return false;

  if (patientDoc.user.toString() === userId.toString()) {
    // The patient counts as 'primary' over their own record.
    // 'doctor' is a separate lane; the patient is not a doctor.
    if (minRole === 'doctor') return false;
    return true;
  }

  // 2. Look up an active CaregiverAccess record
  const link = await CaregiverAccess.findOne({
    patient: patientId,
    user:    userId,
    status:  'active',
  });

  if (!link) return false;

  // 'doctor' role only passes when minRole is exactly 'doctor'
  if (link.role === 'doctor') return minRole === 'doctor';

  // For the tiered roles, check numeric weight
  const granted = ROLE_WEIGHT[link.role]  ?? 0;
  const needed  = ROLE_WEIGHT[minRole]    ?? 99;
  return granted >= needed;
}

/**
 * Express middleware.
 *
 * Usage:
 *   router.put('/:id', verifyToken, requirePatientAccess('approve'), handler)
 *
 * It resolves the patient document from:
 *   1. req.params.patientId
 *   2. the record named by req.params.id: a Medicine, or else a Reminder (a dose)
 *   3. req.body.patientId, only when the URL names no record
 * The record in the URL always decides whose data it is (A1.4 fix): before, a body patientId was
 * checked first, so a user could name their own patient in the body and then edit or delete
 * another patient's medicine by its id.
 *
 * After passing, req.patientDoc is available to the handler.
 */
function requirePatientAccess(minRole) {
  return async (req, res, next) => {
    try {
      // --- resolve patientId ---
      let patientId = req.params.patientId;

      if (!patientId && req.params.id) {
        // Routes keyed by :id: the medicine, or else the dose (Reminder), names the patient.
        const mongoose = require('mongoose');
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Not found.' });
        const Medicine = require('../models/Medicine');
        const Reminder = require('../models/Reminder');
        const rec = (await Medicine.findById(req.params.id).select('patient')) || (await Reminder.findById(req.params.id).select('patient'));
        if (!rec) return res.status(404).json({ message: 'Not found.' });
        patientId = rec.patient.toString();
        // A body patientId can't point the check at a different patient.
        const bodyPatient = req.body && req.body.patientId;
        if (bodyPatient && String(bodyPatient) !== patientId) {
          return res.status(403).json({ message: 'Forbidden: insufficient access.' });
        }
      }

      if (!patientId) patientId = req.body && req.body.patientId;

      if (!patientId) {
        return res.status(400).json({ message: 'patientId required.' });
      }

      const ok = await canAccess(req.user.id, patientId, minRole);
      if (!ok) {
        return res.status(403).json({ message: 'Forbidden: insufficient access.' });
      }

      // Attach the patient doc for convenience
      req.patientDoc = await Patient.findById(patientId);
      next();
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  };
}

module.exports = { canAccess, requirePatientAccess };
