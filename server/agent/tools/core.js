// The five core tools (A2.5). Registered once by agent/index.js.
//
// Every tool works only on the patient of the current run (ctx.patientId). A reminder id that
// belongs to someone else is refused, whatever the model asks for.
// Times go to the model in IST ("21 Nov, 08:00 IST") as well as ISO, so it reads them correctly.

const mongoose = require('mongoose');
const Patient = require('../../models/Patient');
const Medicine = require('../../models/Medicine');
const Reminder = require('../../models/Reminder');
const { markDose } = require('../../services/doseService');
const { notifyCaregivers, REASONS } = require('../../services/caregiverAlerts');
const { registerTool } = require('./index');

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MAX_HISTORY = 100;

function ist(date) {
  if (!date) return null;
  const d = new Date(new Date(date).getTime() + IST_OFFSET_MS);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${hh}:${mm} IST`;
}

// Start of the IST day containing `date`, as a real Date.
function istDayStart(date) {
  const d = new Date(new Date(date).getTime() + IST_OFFSET_MS);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - IST_OFFSET_MS);
}

function needPatient(ctx) {
  if (!ctx || !mongoose.isValidObjectId(ctx.patientId)) {
    return { ok: false, error: 'This run has no patient. Patient tools need ctx.patientId.' };
  }
  return null;
}

// Loads a reminder only if it belongs to this run's patient.
async function ownReminder(reminderId, ctx) {
  if (!mongoose.isValidObjectId(reminderId)) return { error: 'Not a valid reminder id' };
  const reminder = await Reminder.findById(reminderId).populate('medicine', 'name dosage type');
  if (!reminder || String(reminder.patient) !== String(ctx.patientId)) {
    return { error: 'No reminder with that id for this patient' };
  }
  return { reminder };
}

const doseView = (r) => ({
  reminderId: String(r._id),
  medicine: r.medicine && r.medicine.name ? r.medicine.name : undefined,
  dosage: r.medicine && r.medicine.dosage ? r.medicine.dosage : undefined,
  scheduled: ist(r.scheduledTime),
  scheduledTime: r.scheduledTime,
  status: r.status,
  confirmed: r.confirmedAt ? ist(r.confirmedAt) : undefined,
  confirmedBy: r.confirmedBy || undefined,
});

// ── get_patient_context ─────────────────────────────────────────────────────
registerTool({
  name: 'get_patient_context',
  description:
    "Get the patient's profile: first name, age, conditions, language, care settings, active medicines with their times, and the caregivers' names. Call this first in a run.",
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  approvalLevel: 0,
  run: async (input, ctx) => {
    const bad = needPatient(ctx);
    if (bad) return bad;
    const patient = await Patient.findById(ctx.patientId).populate('user', 'name').populate('caregivers.user', 'name').lean();
    if (!patient) return { ok: false, error: 'Patient not found' };
    const medicines = await Medicine.find({ patient: ctx.patientId, isActive: true })
      .select('name dosage type scheduledTimes mealTiming')
      .lean();
    const fullName = (patient.user && patient.user.name) || '';
    return {
      ok: true,
      data: {
        firstName: fullName.split(' ')[0] || undefined,
        age: patient.age,
        conditions: patient.conditions || [],
        language: patient.language || 'en',
        dementiaMode: !!patient.dementiaMode,
        familyClipsEnabled: !!patient.familyClipsEnabled,
        caregivers: (patient.caregivers || [])
          .filter((c) => c.user)
          .map((c) => ({ name: c.user.name, relation: c.role })),
        medicines: medicines.map((m) => ({
          medicineId: String(m._id),
          name: m.name,
          dosage: m.dosage,
          type: m.type,
          times: m.scheduledTimes,
          food: m.mealTiming,
        })),
        pendingFollowUps: [], // A4.3 (Planner) fills this
        now: ist(ctx.now || new Date()),
      },
    };
  },
});

// ── get_dose_history ────────────────────────────────────────────────────────
registerTool({
  name: 'get_dose_history',
  description:
    'List this patient\'s doses (taken, skipped, missed, pending) between two times, newest first. Defaults to today in IST. Times are ISO 8601.',
  inputSchema: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'ISO 8601 start time. Default: start of today (IST).' },
      to: { type: 'string', description: 'ISO 8601 end time. Default: now.' },
    },
    additionalProperties: false,
  },
  approvalLevel: 0,
  run: async (input, ctx) => {
    const bad = needPatient(ctx);
    if (bad) return bad;
    const now = ctx.now || new Date();
    const from = input.from ? new Date(input.from) : istDayStart(now);
    const to = input.to ? new Date(input.to) : now;
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return { ok: false, error: '"from" and "to" must be ISO 8601 times' };
    }
    const reminders = await Reminder.find({ patient: ctx.patientId, scheduledTime: { $gte: from, $lte: to } })
      .populate('medicine', 'name dosage')
      .sort({ scheduledTime: -1 })
      .limit(MAX_HISTORY);
    return { ok: true, data: { from: ist(from), to: ist(to), doses: reminders.map(doseView) } };
  },
});

// ── check_double_dose ───────────────────────────────────────────────────────
registerTool({
  name: 'check_double_dose',
  description:
    'Check whether this dose is already recorded as taken, and list the other doses of the same medicine today. Always call this before mark_dose, and whenever the patient says she already took it.',
  inputSchema: {
    type: 'object',
    properties: { reminderId: { type: 'string', description: 'The dose being asked about' } },
    required: ['reminderId'],
    additionalProperties: false,
  },
  approvalLevel: 0,
  run: async ({ reminderId }, ctx) => {
    const bad = needPatient(ctx);
    if (bad) return bad;
    const { reminder, error } = await ownReminder(reminderId, ctx);
    if (error) return { ok: false, error };
    const dayStart = istDayStart(reminder.scheduledTime);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const sameDay = await Reminder.find({
      patient: ctx.patientId,
      medicine: reminder.medicine._id,
      scheduledTime: { $gte: dayStart, $lt: dayEnd },
      _id: { $ne: reminder._id },
    })
      .populate('medicine', 'name dosage')
      .sort({ scheduledTime: 1 });
    return {
      ok: true,
      data: {
        ...doseView(reminder),
        alreadyTaken: reminder.status === 'taken',
        otherDosesToday: sameDay.map(doseView),
      },
    };
  },
});

// ── mark_dose ───────────────────────────────────────────────────────────────
registerTool({
  name: 'mark_dose',
  description:
    'Record this dose as taken or skipped. Only after check_double_dose, and only when the patient has confirmed it. A dose already recorded as taken is never recorded again.',
  inputSchema: {
    type: 'object',
    properties: {
      reminderId: { type: 'string' },
      status: { type: 'string', enum: ['taken', 'skipped'] },
    },
    required: ['reminderId', 'status'],
    additionalProperties: false,
  },
  approvalLevel: 0,
  run: async ({ reminderId, status }, ctx) => {
    const bad = needPatient(ctx);
    if (bad) return bad;
    const { error } = await ownReminder(reminderId, ctx);
    if (error) return { ok: false, error };
    const r = await markDose(reminderId, status, 'agent');
    if (!r.ok) return { ok: false, error: r.error };
    return {
      ok: true,
      data: {
        reminderId,
        status: r.reminder.status,
        changed: r.changed,
        alreadyRecorded: !!r.alreadyRecorded,
        note: r.alreadyRecorded ? 'This dose was already recorded as taken. Nothing changed.' : undefined,
      },
    };
  },
});

// ── notify_caregiver ────────────────────────────────────────────────────────
registerTool({
  name: 'notify_caregiver',
  description:
    "Phone the patient's caregivers with a short spoken message. Use for a missed dose, when it is unclear whether a dose was taken, to hand over a conversation, or for anything worrying. Write the message for the caregiver, in one or two plain sentences.",
  inputSchema: {
    type: 'object',
    properties: {
      reason: { type: 'string', enum: REASONS },
      message: { type: 'string', description: 'One or two sentences for the caregiver, at most 300 characters.' },
    },
    required: ['reason', 'message'],
    additionalProperties: false,
  },
  approvalLevel: 0,
  run: async ({ reason, message }, ctx) => {
    const bad = needPatient(ctx);
    if (bad) return bad;
    return notifyCaregivers({ patientId: ctx.patientId, reason, message, runId: ctx.runId });
  },
});

module.exports = { ist, istDayStart };
