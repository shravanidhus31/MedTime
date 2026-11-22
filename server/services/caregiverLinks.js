// Who are this patient's caregivers? (integration of Person A's alerts with Person B's C3)
//
//   const { listCaregivers } = require('./services/caregiverLinks');
//   const list = await listCaregivers(patientId);
//   // [{ userId, name, phone, role }]  role: 'primary' | 'approve' | 'view' | 'doctor' | ...
//
// Source of truth: CaregiverAccess (Person B, B1.1), active links only. Caregivers linked the
// old way, in Patient.caregivers, still count until scripts/migrate-caregivers.js has run,
// unless that user has a CaregiverAccess record of any status (pending or revoked means no).
// Primary caregivers come first.

const mongoose = require('mongoose');
const Patient = require('../models/Patient');
const CaregiverAccess = require('../models/CaregiverAccess');

async function listCaregivers(patientId) {
  if (!mongoose.isValidObjectId(patientId)) return [];

  const links = await CaregiverAccess.find({ patient: patientId }).populate('user', 'name phone').lean();
  const decided = new Set(links.map((l) => String(l.user && l.user._id ? l.user._id : l.user)));
  const list = links
    .filter((l) => l.status === 'active' && l.user && l.user._id)
    .map((l) => ({ userId: l.user._id, name: l.user.name, phone: l.user.phone, role: l.role }));

  const patient = await Patient.findById(patientId).select('caregivers').populate('caregivers.user', 'name phone').lean();
  for (const c of (patient && patient.caregivers) || []) {
    if (!c.user || !c.user._id || decided.has(String(c.user._id))) continue;
    decided.add(String(c.user._id));
    list.push({ userId: c.user._id, name: c.user.name, phone: c.user.phone, role: c.role || 'primary' });
  }

  return list.sort((a, b) => (b.role === 'primary') - (a.role === 'primary'));
}

module.exports = { listCaregivers };
