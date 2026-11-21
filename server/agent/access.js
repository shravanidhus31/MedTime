// Patient access check for agent routes.
//
// The real helper is Person B's (contract C3: canAccess(userId, patientId, minRole) and
// requirePatientAccess(minRole), roles view < approve < primary, doctor separate).
// Until it exists, this stand-in allows: the patient themself, any caregiver linked in
// Patient.caregivers, and admins. It ignores minRole. B swaps in the real check with:
//
//   setAccessChecker(canAccess);

const mongoose = require('mongoose');
const Patient = require('../models/Patient');

let checker = async function stubCanAccess(userId, patientId /* , minRole */) {
  if (!mongoose.isValidObjectId(patientId)) return false;
  const patient = await Patient.findById(patientId).select('user caregivers.user').lean();
  if (!patient) return false;
  const id = String(userId);
  return String(patient.user) === id || (patient.caregivers || []).some((c) => String(c.user) === id);
};

function setAccessChecker(fn) {
  if (typeof fn !== 'function') throw new TypeError('setAccessChecker needs a function');
  checker = fn;
}

async function canAccess(user, patientId, minRole = 'view') {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return checker(user.id, patientId, minRole);
}

module.exports = { canAccess, setAccessChecker };
