// Caregiver alerts (A2.5). Used by the notify_caregiver tool and by the orchestrator on red flags.
//
//   const r = await notifyCaregivers({ patientId, reason: 'red_flag', message: 'She said she fell.', runId });
//   // r = { ok: true, data: { sent, alerts: [{ name, relation, status }] } } | { ok: false, error }
//
// Who is called: every linked caregiver except doctors (doctors get approvals and reports, not
// urgent calls), primary caregivers first. With no caregiver linked, Patient.emergencyContact.
// On the Twilio trial an alert is a phone call (custom SMS is blocked); SMS is added after upgrade.
// Person B's roles (C3) can narrow this later.

const mongoose = require('mongoose');
const Patient = require('../models/Patient');
const CaregiverAlert = require('../models/CaregiverAlert');
const { makeAlertCall } = require('../utils/twilioClient');

const REASONS = ['red_flag', 'missed_dose', 'unsure_dose', 'handover', 'other'];
const MAX_MESSAGE_CHARS = 300;

function cleanMessage(text) {
  return String(text || '')
    .replace(/[\u0000-\u001f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MESSAGE_CHARS);
}

async function notifyCaregivers({ patientId, reason, message, runId }) {
  if (!mongoose.isValidObjectId(patientId)) return { ok: false, error: 'Not a valid patient id' };
  if (!REASONS.includes(reason)) return { ok: false, error: `reason must be one of ${REASONS.join(', ')}` };
  const body = cleanMessage(message);
  if (!body) return { ok: false, error: 'message is empty' };

  const patient = await Patient.findById(patientId).populate('user', 'name').populate('caregivers.user', 'name phone');
  if (!patient) return { ok: false, error: 'Patient not found' };

  const patientName = (patient.user && patient.user.name) || 'your family member';
  const spoken = `This is Med Time, about ${patientName}. ${body} Please check on them.`;

  let recipients = (patient.caregivers || [])
    .filter((c) => c.user && c.user.phone && c.role !== 'doctor')
    .sort((a, b) => (a.role === 'primary' ? -1 : 0) - (b.role === 'primary' ? -1 : 0))
    .map((c) => ({ userId: c.user._id, name: c.user.name, relation: c.role, phone: c.user.phone }));
  if (recipients.length === 0 && patient.emergencyContact) {
    recipients = [{ userId: null, name: 'emergency contact', relation: 'emergency_contact', phone: patient.emergencyContact }];
  }
  if (recipients.length === 0) return { ok: false, error: 'No caregiver or emergency contact to call' };

  const alerts = [];
  for (const r of recipients) {
    const alert = await CaregiverAlert.create({
      patient: patient._id,
      caregiver: r.userId,
      phone: r.phone,
      reason,
      message: spoken,
      channel: 'call',
      status: 'queued',
      run: mongoose.isValidObjectId(runId) ? runId : undefined,
    });
    try {
      const call = await makeAlertCall(r.phone, String(alert._id));
      if (call === true) alert.status = 'simulated';
      else {
        alert.status = 'calling';
        alert.callSid = call && call.sid;
      }
    } catch (err) {
      alert.status = 'failed';
      alert.error = err.message;
      console.error(`[caregiverAlerts] call to ${r.name} failed:`, err.message);
    }
    await alert.save();
    // The model sees names and outcomes only, never phone numbers.
    alerts.push({ name: r.name, relation: r.relation, status: alert.status });
  }

  const sent = alerts.filter((a) => a.status !== 'failed').length;
  if (sent === 0) return { ok: false, error: 'Every alert call failed', data: { alerts } };
  return { ok: true, data: { sent, alerts } };
}

module.exports = { notifyCaregivers, REASONS };
