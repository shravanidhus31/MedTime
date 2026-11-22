// Live check of A2.5: the five core tools, the dose service and caregiver alerts, on your dev
// database, plus one real agent run on Groq. Twilio is forced into simulation mode: no real calls.
// Creates test data and deletes it afterwards.
// Run from server/:  npm run tools:check   (about 3 to 5 Groq requests)

require('dotenv').config({ quiet: true });
// Never place real calls from a check.
for (const v of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN']) delete process.env[v];
process.env.PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost';

const dbName = (() => {
  try {
    return new URL(process.env.MONGO_URI).pathname.replace(/^\//, '');
  } catch {
    return '';
  }
})();
if (!dbName || !/dev|test/i.test(dbName)) {
  console.error(`Refusing to run: MONGO_URI database is "${dbName || '(none)'}". Use a dev database such as medtime_dev_a.`);
  process.exit(1);
}

const mongoose = require('mongoose');
const express = require('express');
const User = require('../models/User');
const Patient = require('../models/Patient');
const Medicine = require('../models/Medicine');
const Reminder = require('../models/Reminder');
const AgentRun = require('../models/AgentRun');
const CaregiverAlert = require('../models/CaregiverAlert');
const CaregiverAccess = require('../models/CaregiverAccess');
const events = require('../events');
const { markDose } = require('../services/doseService');
const { initAgent } = require('../agent');
const { getTool } = require('../agent/tools');
const { istDayStart } = require('../agent/tools/core');
const { runRecorded } = require('../agent/runs');
const { loadPrompt } = require('../agent/prompts');
const orch = require('../agent/orchestrator');

initAgent();

const TAG = `tools-check-${Date.now()}`;
const results = [];
const check = (name, passed, detail = '') => {
  results.push(!!passed);
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tool = (name) => getTool(name);

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log(`Connected to ${mongoose.connection.name} (Twilio in simulation mode)\n`);
  const made = { users: [], patients: [], medicines: [] };
  let server;

  try {
    // ── test data ──
    let n = 0;
    const mkUser = async (name, role) => {
      const u = await User.create({ name, phone: `+9199${String(Date.now()).slice(-6)}${n++}`, passwordHash: 'x', role });
      made.users.push(u._id);
      return u;
    };
    const amma = await mkUser(`Amma ${TAG}`, 'patient');
    const priya = await mkUser(`Priya ${TAG}`, 'caregiver');
    const doctor = await mkUser(`Dr Rao ${TAG}`, 'doctor');
    const other = await mkUser(`Other ${TAG}`, 'patient');

    const patient = await Patient.create({
      user: amma._id,
      age: 78,
      conditions: ['hypertension'],
      emergencyContact: '+910000000001',
      caregivers: [{ user: doctor._id, role: 'doctor' }, { user: priya._id, role: 'primary' }],
    });
    const otherPatient = await Patient.create({ user: other._id, emergencyContact: '+910000000002' });
    made.patients.push(patient._id, otherPatient._id);

    const med = await Medicine.create({
      patient: patient._id, name: 'Amlodipine', dosage: '5mg', type: 'tablet', frequency: 'twice',
      scheduledTimes: ['08:00', '20:00'], notificationType: 'call', startDate: new Date(),
    });
    const otherMed = await Medicine.create({
      patient: otherPatient._id, name: 'Metformin', dosage: '500mg', type: 'tablet', frequency: 'once',
      scheduledTimes: ['09:00'], startDate: new Date(),
    });
    made.medicines.push(med._id, otherMed._id);

    const today = istDayStart(new Date());
    const at = (day, h) => new Date(day.getTime() + h * 3600000);
    const yesterday = new Date(today.getTime() - 24 * 3600000);
    // The morning dose has an armed escalation clock (A1.3: it lives on the Reminder).
    const morning = await Reminder.create({ medicine: med._id, patient: patient._id, scheduledTime: at(today, 8), status: 'alerted',
      caregiverAlertTime: new Date(Date.now() + 10 * 60000), snoozeUntil: new Date(Date.now() + 5 * 60000) });
    const evening = await Reminder.create({ medicine: med._id, patient: patient._id, scheduledTime: at(today, 20), status: 'pending' });
    await Reminder.create({ medicine: med._id, patient: patient._id, scheduledTime: at(yesterday, 8), status: 'taken', confirmedBy: 'ivr', confirmedAt: at(yesterday, 8.1) });
    const othersDose = await Reminder.create({ medicine: otherMed._id, patient: otherPatient._id, scheduledTime: at(today, 9), status: 'pending' });

    const ctx = { patientId: String(patient._id), runId: undefined, flow: 'dose', now: new Date(at(today, 21).getTime()) };

    // ── 1. get_patient_context ──
    const pc = await tool('get_patient_context').run({}, ctx);
    check('get_patient_context: name, medicine, caregivers', pc.ok && pc.data.firstName === 'Amma' && pc.data.medicines.length === 1 && pc.data.caregivers.length === 2,
      pc.ok && `${pc.data.firstName}, ${pc.data.medicines.map((m) => m.name)}, ${pc.data.now}`);
    check('get_patient_context: no phone numbers given to the model', !/\+91\d/.test(JSON.stringify(pc)));

    // ── 2. get_dose_history ──
    const h1 = await tool('get_dose_history').run({}, ctx);
    const h2 = await tool('get_dose_history').run({ from: yesterday.toISOString() }, ctx);
    check('get_dose_history: today by default', h1.ok && h1.data.doses.length === 2, h1.ok && h1.data.doses.map((d) => `${d.scheduled} ${d.status}`).join('; '));
    check('get_dose_history: with a start date', h2.ok && h2.data.doses.length === 3);
    check('get_dose_history: bad date refused', !(await tool('get_dose_history').run({ from: 'last week' }, ctx)).ok);

    // ── 3. check_double_dose ──
    const c1 = await tool('check_double_dose').run({ reminderId: String(morning._id) }, ctx);
    check('check_double_dose: not taken yet, sees the evening dose', c1.ok && c1.data.alreadyTaken === false && c1.data.otherDosesToday.length === 1);
    const c2 = await tool('check_double_dose').run({ reminderId: String(othersDose._id) }, ctx);
    check("check_double_dose: another patient's dose is refused", !c2.ok, c2.error);

    // ── 4. mark_dose + doseService ──
    const seen = [];
    const listener = (e) => seen.push(e);
    events.on('dose.taken', listener);
    const m1 = await tool('mark_dose').run({ reminderId: String(morning._id), status: 'taken' }, ctx);
    const afterMark = await Reminder.findById(morning._id).lean();
    const eveningAfter = await Reminder.findById(evening._id).lean();
    check('mark_dose: recorded as taken by the agent', m1.ok && m1.data.changed && afterMark.status === 'taken' && afterMark.confirmedBy === 'agent');
    check("mark_dose: this dose's escalation cleared (no more calls for it)", afterMark.caregiverAlertTime === null && afterMark.snoozeUntil === null && afterMark.caregiverAlerted === false);
    check('mark_dose: the other dose of the same medicine is untouched', eveningAfter.status === 'pending' && eveningAfter.confirmedAt === undefined);
    check('mark_dose: dose.taken event emitted', seen.length === 1 && seen[0].source === 'agent' && seen[0].reminderId === String(morning._id));
    const m2 = await tool('mark_dose').run({ reminderId: String(morning._id), status: 'taken' }, ctx);
    check('mark_dose: second time changes nothing', m2.ok && m2.data.alreadyRecorded && !m2.data.changed && seen.length === 1);
    const m3 = await tool('mark_dose').run({ reminderId: String(morning._id), status: 'skipped' }, ctx);
    check('mark_dose: a taken dose cannot be flipped to skipped', m3.ok && m3.data.alreadyRecorded && (await Reminder.findById(morning._id).lean()).status === 'taken');
    check("mark_dose: another patient's dose is refused", !(await tool('mark_dose').run({ reminderId: String(othersDose._id), status: 'taken' }, ctx)).ok);

    const race = await Promise.all([markDose(evening._id, 'taken', 'app'), markDose(evening._id, 'taken', 'agent')]);
    check('doseService: two confirmations at once record it only once', race.filter((r) => r.changed).length === 1 && seen.length === 2);
    events.off('dose.taken', listener);
    await Reminder.updateOne({ _id: evening._id }, { $set: { status: 'pending' }, $unset: { confirmedAt: 1, confirmedBy: 1 } });

    // ── 5. notify_caregiver ──
    const nc = await tool('notify_caregiver').run({ reason: 'unsure_dose', message: 'Amma is not sure she took her evening Amlodipine.' }, ctx);
    const alerts = await CaregiverAlert.find({ patient: patient._id }).lean();
    check('notify_caregiver: calls the primary caregiver, skips the doctor', nc.ok && nc.data.sent === 1 && nc.data.alerts[0].name.startsWith('Priya') && alerts.length === 1,
      nc.ok && JSON.stringify(nc.data.alerts));
    check('notify_caregiver: simulated call, message saved', alerts[0] && alerts[0].status === 'simulated' && /about Amma/.test(alerts[0].message));
    check('notify_caregiver: no phone numbers given to the model', !/\+91\d/.test(JSON.stringify(nc)));

    const app = express();
    app.use('/api/v1/webhooks', require('../routes/webhookRoutes'));
    server = app.listen(0);
    const twiml = await (await fetch(`http://127.0.0.1:${server.address().port}/api/v1/webhooks/voice/alert?alertId=${alerts[0]._id}`, { method: 'POST' })).text();
    check('alert webhook: Twilio gets the spoken message', /<Say[^>]*>This is Med Time, about Amma/.test(twiml) && /<Hangup\/>/.test(twiml));

    // ── 5b. caregivers from Person B's CaregiverAccess (integration) ──
    const nani = await mkUser(`Nani ${TAG}`, 'patient');
    const meera = await mkUser(`Meera ${TAG}`, 'caregiver'); // active link, CaregiverAccess only
    const ravi = await mkUser(`Ravi ${TAG}`, 'caregiver'); // old-style link, but access revoked since
    const sunil = await mkUser(`Sunil ${TAG}`, 'caregiver'); // link request still pending
    const asha = await mkUser(`Asha ${TAG}`, 'caregiver'); // old-style link, never migrated
    const drK = await mkUser(`Dr Kale ${TAG}`, 'doctor'); // active doctor link
    const linked = await Patient.create({
      user: nani._id, emergencyContact: '+910000000005',
      caregivers: [{ user: ravi._id, role: 'primary' }, { user: asha._id, role: 'approve' }],
    });
    made.patients.push(linked._id);
    await CaregiverAccess.create([
      { patient: linked._id, user: meera._id, role: 'primary', status: 'active' },
      { patient: linked._id, user: ravi._id, role: 'primary', status: 'revoked' },
      { patient: linked._id, user: sunil._id, role: 'approve', status: 'pending' },
      { patient: linked._id, user: drK._id, role: 'doctor', status: 'active' },
    ]);
    const lctx = { patientId: String(linked._id), runId: undefined, flow: 'dose', now: new Date() };
    const lnc = await tool('notify_caregiver').run({ reason: 'unsure_dose', message: 'Nani is not sure she took her pills.' }, lctx);
    const called = lnc.ok ? lnc.data.alerts.map((a) => a.name.split(' ')[0]) : [];
    check('caregivers: CaregiverAccess primary called first, unmigrated old link too; revoked, pending and doctor not called',
      lnc.ok && called.join(',') === 'Meera,Asha', called.join(', '));
    const lpc = await tool('get_patient_context').run({}, lctx);
    const names = lpc.ok ? lpc.data.caregivers.map((c) => c.name.split(' ')[0]).sort().join(',') : '';
    check('get_patient_context: caregivers from CaregiverAccess, no revoked or pending ones', names === 'Asha,Dr,Meera', names);

    // ── 6. red flag on a call → caregiver alert ──
    orch.registerFlow(`check-${TAG}`, { start: async () => [{ type: 'listen' }], turn: async () => [{ type: 'listen' }] });
    const { sessionId } = await orch.startSession({ flow: `check-${TAG}`, patientId: patient._id });
    const flagged = await orch.handleTurn({ sessionId, transcript: 'I fell in the kitchen', isFinal: false });
    await sleep(1500);
    const redAlerts = await CaregiverAlert.find({ patient: patient._id, reason: 'red_flag' }).lean();
    check('red flag on a call: neutral reply + caregiver alerted', flagged.emergency === 'fall' && redAlerts.length === 1, redAlerts[0] && redAlerts[0].message);

    // ── 7. a real agent run on Groq with the real tools ──
    const base = loadPrompt('base');
    const task =
      `${base.text}\n\nCurrent task: the evening dose is due. reminderId=${evening._id}. ` +
      'Call check_double_dose first. If it is not already taken and the patient clearly says she has just taken it, ' +
      'record it with mark_dose. If it is already taken, tell her kindly not to take another.';
    const run1 = await runRecorded(
      { trigger: 'simulate', patientId: patient._id, reminderId: evening._id, flow: 'dose' },
      { system: task, promptVersion: base.promptVersion, messages: [{ role: 'user', content: 'Patient said: "Yes, I just took my evening Amlodipine."' }],
        tools: ['get_patient_context', 'get_dose_history', 'check_double_dose', 'mark_dose', 'notify_caregiver'], ctx: { patientId: String(patient._id) } },
    );
    const eveningNow = await Reminder.findById(evening._id).lean();
    check('agent run: checks, then records the evening dose', run1.outcome === 'done' && eveningNow.status === 'taken' && eveningNow.confirmedBy === 'agent',
      `outcome=${run1.outcome}${run1.fallbackReason ? `/${run1.fallbackReason}` : ''} | ${run1.steps.map((s) => (s.tool === 'claim_check' ? `claim_check[${JSON.stringify(s.input.reply.slice(0, 70))}]` : s.tool)).join(' → ')} | reply: ${JSON.stringify((run1.text || '').slice(0, 160))}`);
    // The next scenario only means something if the dose is now recorded.
    if (eveningNow.status !== 'taken') await markDose(evening._id, 'taken', 'app');

    const run2 = await runRecorded(
      { trigger: 'simulate', patientId: patient._id, reminderId: evening._id, flow: 'dose' },
      { system: task, promptVersion: base.promptVersion, messages: [{ role: 'user', content: 'Patient said: "Did I take my evening tablet? I think I should take one now."' }],
        tools: ['get_patient_context', 'get_dose_history', 'check_double_dose', 'mark_dose', 'notify_caregiver'], ctx: { patientId: String(patient._id) } },
    );
    const changedAgain = run2.steps.some((s) => s.tool === 'mark_dose' && s.output && s.output.data && s.output.data.changed);
    check('agent run: already taken → no second dose recorded', run2.outcome === 'done' && !changedAgain && run2.steps.some((s) => s.tool === 'check_double_dose'),
      `${run2.steps.map((s) => s.tool).join(' → ')} | reply: ${JSON.stringify((run2.text || '').slice(0, 110))}`);
    const savedRun = await AgentRun.findById(run1.runId).lean();
    check('agent run saved with every step', savedRun && savedRun.stepCount === run1.steps.length);
  } catch (err) {
    check('check ran without crashing', false, err.stack);
  } finally {
    if (server) server.close();
    await CaregiverAlert.deleteMany({ patient: { $in: made.patients } });
    await CaregiverAccess.deleteMany({ patient: { $in: made.patients } });
    await AgentRun.deleteMany({ patient: { $in: made.patients } });
    await Reminder.deleteMany({ patient: { $in: made.patients } });
    await Medicine.deleteMany({ _id: { $in: made.medicines } });
    await Patient.deleteMany({ _id: { $in: made.patients } });
    await User.deleteMany({ _id: { $in: made.users } });
    await mongoose.disconnect();
    const passed = results.filter(Boolean).length;
    console.log(`\n${passed}/${results.length} passed (test data deleted)`);
    process.exit(passed === results.length ? 0 : 1);
  }
})();
