// Text simulate endpoints (A2.7). A dose call in text: the same flow, tools and AgentRun log as a
// real call, with Twilio replaced by text. Person B's evaluation harness uses these.
//
//   GET  /api/v1/simulate/doses?patient=<Patient id>     (patient: optional for a patient's own login)
//     → { patient: { id, firstName, language }, medicines: [{ medicineId, name, dosage, times, openReminderId, lines }] }
//     lines: every line a call about that dose can say; the page has the voice server render them first.
//   POST /api/v1/simulate/call { reminderId } or { medicineId }, channel?: 'text' | 'voice'
//     → { callId, runId, actions, ended, hints, language }   the agent's opening turn
//     medicineId: the medicine's open dose due within 12 hours, or a new dose due now (A3.2).
//     channel 'voice' (A3.2): the browser voice call; turns then go to POST /agent/turn from the
//     voice server, with the normal 4-second turn budget. hints = words for speech recognition.
//   POST /api/v1/simulate/call/:callId/say { text } or { dtmf: '9' }
//     → { callId, runId, actions, ended, emergency? }
//
// Login required, with access to the reminder's patient. A simulated call records REAL doses in
// the database it runs on, so it is off in production unless SIMULATE_ENABLED=true.

const express = require('express');
const mongoose = require('mongoose');
const Reminder = require('../models/Reminder');
const Medicine = require('../models/Medicine');
const Patient = require('../models/Patient');
const { verifyToken } = require('../middleware/authMiddleware');
const { canAccess } = require('../agent/access');
const { startDoseCall, doseLineTexts } = require('../agent/flows/dose');
const { startCallinCall, callinLineTexts } = require('../agent/flows/callin');
const { startChatCall, chatLineTexts } = require('../agent/flows/chat');
const { handleTurn, getSession, TurnError, HOLD_TEXT, TURN_LIMIT_TEXT, STAY_TEXT } = require('../agent/orchestrator');
const { LINES, render } = require('../agent/flows/doseLines');
const { RESPONSES } = require('../agent/safety');

// Lines every call can say whatever the patient: the emergency replies, the hold line, the
// turn-limit line.
const COMMON_LINES = () => [...new Set([...Object.values(RESPONSES).map((r) => r.neutralText), HOLD_TEXT, TURN_LIMIT_TEXT, STAY_TEXT])];

// Every line this call can say, filled in for this patient (A3.1): the voice server renders them
// once and plays them from its cache, so no speech is generated mid-call (plan section 7).
function callLines(sessionId) {
  const session = getSession(sessionId);
  const slots = session && session.state && session.state.slots;
  const texts = new Set();
  if (slots) for (const id of Object.keys(LINES)) texts.add(render(id, slots));
  for (const t of COMMON_LINES()) texts.add(t);
  return [...texts];
}

const router = express.Router();
const MAX_TEXT_CHARS = 2000;
const TEXT_TURN_BUDGET_MS = 30000; // no Twilio 5-second limit in text mode

function simulateAllowed() {
  return process.env.NODE_ENV !== 'production' || process.env.SIMULATE_ENABLED === 'true';
}

router.use((req, res, next) => {
  if (!simulateAllowed()) return res.status(403).json({ message: 'Simulated calls are off in production (set SIMULATE_ENABLED=true to allow).' });
  next();
});

const isEnded = (actions) => actions.some((a) => a.type === 'hangup' || a.type === 'fallback');

const HOUR = 60 * 60 * 1000;

// The patient this request is about: ?patient=, or the logged-in patient's own record.
async function resolvePatient(req) {
  const id = req.query.patient;
  if (id) return mongoose.isValidObjectId(id) ? Patient.findById(id).populate('user', 'name').lean() : null;
  if (req.user.role === 'patient') return Patient.findOne({ user: req.user.id }).populate('user', 'name').lean();
  return null;
}

// The medicine's open dose due within 12 hours (nearest first), or null.
const openDose = (medicineId, now = new Date()) =>
  Reminder.find({ medicine: medicineId, status: { $in: ['pending', 'alerted'] }, scheduledTime: { $gte: new Date(now - 12 * HOUR), $lte: new Date(+now + 12 * HOUR) } })
    .lean()
    .then((rs) => rs.sort((a, b) => Math.abs(a.scheduledTime - now) - Math.abs(b.scheduledTime - now))[0] || null);

router.get('/doses', verifyToken, async (req, res) => {
  try {
    const patient = await resolvePatient(req);
    if (!patient || !(await canAccess(req.user, patient._id, 'primary'))) return res.status(404).json({ message: 'Patient not found.' });
    const meds = await Medicine.find({ patient: patient._id, isActive: true }).select('name dosage scheduledTimes').lean();
    const medicines = await Promise.all(meds.map(async (m) => {
      const dose = await openDose(m._id);
      // lines: what a call about this dose can say, so the voice server can render them before it starts
      const full = await Medicine.findById(m._id).lean();
      const lines = [...new Set([...(await doseLineTexts({ med: full, patient, scheduledTime: dose ? dose.scheduledTime : new Date() })), ...COMMON_LINES()])];
      return { medicineId: String(m._id), name: m.name, dosage: m.dosage, times: m.scheduledTimes, openReminderId: dose ? String(dose._id) : null, lines };
    }));
    // The call-in's own lines (Feature 7) plus every medicine's dose lines: a call-in can hand over
    // to any of them, so the page prepares them all before a "patient calls MedTime" call.
    const { listCaregivers } = require('../services/caregiverLinks');
    const cg = (await listCaregivers(patient._id)).find((c) => c.role !== 'doctor' && c.name);
    const firstName = ((patient.user && patient.user.name) || 'there').split(' ')[0];
    const callinLines = [...new Set([
      ...callinLineTexts({ name: firstName, caregiver: cg ? cg.name.split(' ')[0] : 'your family' }),
      ...medicines.flatMap((m) => m.lines),
    ])].slice(0, 80);
    return res.json({
      patient: { id: String(patient._id), firstName, language: patient.language || 'en' },
      medicines,
      callinLines,
      // the weekly chat call's lines (Feature 1), plus the emergency lines it may need
      chatLines: [...new Set([...chatLineTexts({ name: firstName, lang: patient.language === 'hi' ? 'hi' : 'en' }), ...COMMON_LINES()])],
      weeklyChat: !!patient.weeklyChatEnabled,
    });
  } catch (err) {
    console.error('[simulateRoutes] doses failed:', err.message);
    return res.status(500).json({ message: 'Could not load the doses.' });
  }
});

router.post('/call', verifyToken, async (req, res) => {
  try {
    const { medicineId } = req.body || {};
    let { reminderId } = req.body || {};
    const channel = req.body && req.body.channel === 'voice' ? 'voice' : 'text';

    if (!reminderId && medicineId) {
      if (!mongoose.isValidObjectId(medicineId)) return res.status(400).json({ message: '"medicineId" must be a Medicine id.' });
      const med = await Medicine.findById(medicineId).select('patient isActive').lean();
      if (!med || !med.isActive || !(await canAccess(req.user, med.patient, 'primary'))) return res.status(404).json({ message: 'Medicine not found.' });
      const dose = (await openDose(med._id)) || (await Reminder.create({ medicine: med._id, patient: med.patient, scheduledTime: new Date(), status: 'pending' }));
      reminderId = String(dose._id);
    }
    if (!mongoose.isValidObjectId(reminderId)) return res.status(400).json({ message: 'Send "reminderId" (a Reminder id) or "medicineId" (a Medicine id).' });
    const reminder = await Reminder.findById(reminderId).select('patient medicine').populate('medicine', 'name').lean();
    if (!reminder || !(await canAccess(req.user, reminder.patient, 'primary'))) {
      return res.status(404).json({ message: 'Reminder not found.' });
    }
    const call = await startDoseCall({ reminderId, trigger: 'simulate', channel, turnBudgetMs: channel === 'text' ? TEXT_TURN_BUDGET_MS : undefined });
    // This dose is being called right now (in the browser or as text), so the scheduler must not
    // place its own reminder call for it: counted as a call attempt, with no escalation clock.
    // Without this, a demo call on Render would also ring the patient's real phone a minute later.
    await Reminder.updateOne({ _id: reminderId, attempts: { $not: { $gt: 0 } } }, { $set: { lastCallAt: new Date() }, $inc: { attempts: 1 } });
    const patient = await Patient.findById(reminder.patient).populate('user', 'name').select('user language').lean();
    const hints = [reminder.medicine && reminder.medicine.name, patient && patient.user && patient.user.name && patient.user.name.split(' ')[0]].filter(Boolean);
    return res.status(201).json({
      callId: call.sessionId, runId: call.runId, reminderId, actions: call.actions, ended: isEnded(call.actions),
      hints, language: (patient && patient.language) || 'en',
      lines: channel === 'voice' ? callLines(call.sessionId) : undefined,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error('[simulateRoutes] start failed:', err.message);
    return res.status(500).json({ message: 'Could not start the simulated call.' });
  }
});

// POST /api/v1/simulate/callin { patient?, channel?: 'text' | 'voice' }
//   The patient calls MedTime (Feature 7). patient: optional for a patient's own login.
//   → { callId, runId, actions, ended, hints, lines }   then /call/:callId/say (text) or /agent/turn (voice)
router.post('/callin', verifyToken, async (req, res) => {
  try {
    if (req.body && req.body.patient) req.query.patient = String(req.body.patient);
    const patient = await resolvePatient(req);
    if (!patient || !(await canAccess(req.user, patient._id, 'primary'))) return res.status(404).json({ message: 'Patient not found.' });
    const channel = req.body && req.body.channel === 'voice' ? 'voice' : 'text';
    const call = await startCallinCall({ patientId: patient._id, trigger: 'callin', channel, turnBudgetMs: channel === 'text' ? TEXT_TURN_BUDGET_MS : undefined });
    const meds = await Medicine.find({ patient: patient._id, isActive: true }).lean();
    const lines = new Set([...callinLineTexts({ name: call.name, caregiver: call.caregiver }), ...COMMON_LINES()]);
    if (channel === 'voice') {
      for (const m of meds) for (const t of await doseLineTexts({ med: m, patient })) lines.add(t);
    }
    return res.status(201).json({
      callId: call.sessionId, runId: call.runId, actions: call.actions, ended: isEnded(call.actions),
      hints: [...meds.map((m) => m.name), call.name].slice(0, 5), language: patient.language || 'en',
      lines: channel === 'voice' ? [...lines].slice(0, 80) : undefined,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error('[simulateRoutes] call-in failed:', err.message);
    return res.status(500).json({ message: 'Could not start the call-in.' });
  }
});

// The weekly chat call (Feature 1), text or voice: the same open question each week; ≥ 50 words
// are measured the way the speech-screening paper does. Works whether or not the weekly schedule is on.
router.post('/chat', verifyToken, async (req, res) => {
  try {
    if (req.body && req.body.patient) req.query.patient = String(req.body.patient);
    const patient = await resolvePatient(req);
    if (!patient || !(await canAccess(req.user, patient._id, 'primary'))) return res.status(404).json({ message: 'Patient not found.' });
    const channel = req.body && req.body.channel === 'voice' ? 'voice' : 'text';
    const call = await startChatCall({ patientId: patient._id, trigger: 'weekly_chat', channel, turnBudgetMs: channel === 'text' ? TEXT_TURN_BUDGET_MS : undefined });
    const lines = new Set([...chatLineTexts({ name: call.name, lang: call.lang }), ...COMMON_LINES()]);
    return res.status(201).json({
      callId: call.sessionId, runId: call.runId, actions: call.actions, ended: isEnded(call.actions),
      hints: [call.name], language: patient.language || 'en',
      lines: channel === 'voice' ? [...lines] : undefined,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error('[simulateRoutes] chat failed:', err.message);
    return res.status(500).json({ message: 'Could not start the chat call.' });
  }
});

router.post('/call/:callId/say', verifyToken, async (req, res) => {
  const { callId } = req.params;
  const { text, dtmf } = req.body || {};
  if (text === undefined && dtmf === undefined) return res.status(400).json({ message: 'Send "text" (what the patient says) or "dtmf" (a key).' });
  if (text !== undefined && (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT_CHARS)) {
    return res.status(400).json({ message: `"text" must be 1 to ${MAX_TEXT_CHARS} characters.` });
  }
  if (dtmf !== undefined && !/^[0-9*#]$/.test(String(dtmf))) return res.status(400).json({ message: '"dtmf" must be a single keypad key.' });

  const session = getSession(callId);
  if (!session || session.channel !== 'text' || !(await canAccess(req.user, session.patientId, 'primary'))) {
    return res.status(404).json({ message: 'No active simulated call with that id.' });
  }
  try {
    // No flow name: a call-in can hand over to the dose flow mid-call.
    const result = await handleTurn({ sessionId: callId, transcript: text, isFinal: true, dtmf });
    return res.json({ callId, runId: session.runId || null, ...result, ended: isEnded(result.actions) });
  } catch (err) {
    if (err instanceof TurnError) return res.status(err.status === 404 ? 409 : err.status).json({ message: err.status === 404 ? 'This call has ended.' : err.message });
    console.error('[simulateRoutes] turn failed:', err.message);
    return res.status(500).json({ message: 'The simulated turn failed.' });
  }
});

module.exports = router;
