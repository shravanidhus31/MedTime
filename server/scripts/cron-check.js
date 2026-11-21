// Live check of A2.6: the scheduler hands dose calls to the agent for dementiaMode patients.
// Runs scheduler ticks directly on your dev database. Twilio is forced into simulation mode and the
// every-minute timer is stopped, so nothing runs on its own. No Groq requests: the hand-over is rules.
// Creates test data and deletes it afterwards.
// Run from server/:  npm run cron:check

require('dotenv').config({ quiet: true });
for (const v of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN']) delete process.env[v];

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
const { runTick, task } = require('../jobs/missedDoseCron');
task.stop(); // only the ticks this script runs

const User = require('../models/User');
const Patient = require('../models/Patient');
const Medicine = require('../models/Medicine');
const Reminder = require('../models/Reminder');
const AgentRun = require('../models/AgentRun');
const { markDose } = require('../services/doseService');

const TAG = `cron-check-${Date.now()}`;
const results = [];
const check = (name, passed, detail = '') => {
  results.push(!!passed);
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const toHHMM = (date) => {
  const d = new Date(date.getTime() + 5.5 * 3600000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};
const quiet = async (fn) => {
  const log = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
};
const runsFor = (patientId) => AgentRun.find({ patient: patientId }).sort({ startedAt: 1 }).lean();
const tools = (run) => (run ? run.steps.map((s) => s.tool).join(' → ') : '(no run)');

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log(`Connected to ${mongoose.connection.name} (Twilio in simulation mode, cron timer stopped)\n`);
  const made = { users: [], patients: [], medicines: [] };

  try {
    const now = new Date();
    const hhmm = toHHMM(now);
    let n = 0;
    const mkPatient = async (label, dementiaMode) => {
      const u = await User.create({ name: `${label} ${TAG}`, phone: `+9198${String(Date.now()).slice(-6)}${n++}`, passwordHash: 'x', role: 'patient' });
      made.users.push(u._id);
      const p = await Patient.create({ user: u._id, emergencyContact: '+910000000003', dementiaMode });
      made.patients.push(p._id);
      const m = await Medicine.create({
        patient: p._id, name: `Med-${label}`, dosage: '5mg', type: 'tablet', frequency: 'once',
        scheduledTimes: [hhmm], notificationType: 'call', startDate: now,
      });
      made.medicines.push(m._id);
      return { patient: p, medicine: m };
    };

    const a = await mkPatient('DementiaDue', true); // due, not taken → agent checks, then calls
    const b = await mkPatient('Regular', false); // keypad flow, unchanged
    const c = await mkPatient('DementiaTaken', true); // already confirmed in the app → no call
    const d = await mkPatient('DementiaNoRecord', true); // no Reminder record → calls anyway
    const remA = await Reminder.create({ medicine: a.medicine._id, patient: a.patient._id, scheduledTime: now, status: 'pending' });
    await Reminder.create({ medicine: b.medicine._id, patient: b.patient._id, scheduledTime: now, status: 'pending' });
    await Reminder.create({ medicine: c.medicine._id, patient: c.patient._id, scheduledTime: now, status: 'taken', confirmedBy: 'app', confirmedAt: now });

    const dflt = await Patient.findById(b.patient._id).lean();
    check('new patient settings default to off / English', dflt.dementiaMode === false && dflt.language === 'en' && dflt.familyClipsEnabled === false);

    // ── tick 1: first call ──
    await quiet(() => runTick(now));

    const [runA] = await runsFor(a.patient._id);
    const medA = await Medicine.findById(a.medicine._id).lean();
    check('dementia patient, dose due: agent run checks the log, then calls',
      runA && runA.trigger === 'dose_due' && tools(runA) === 'check_double_dose → place_call' && runA.steps[1].output.ok && runA.reminder && String(runA.reminder) === String(remA._id),
      tools(runA));
    check('…and the escalation clock is armed as before', !!medA.caregiverAlertTime);
    check('…run finished with a readable summary', runA && runA.status === 'finished' && /Called the patient/.test(runA.text), runA && runA.text);

    const runsB = await runsFor(b.patient._id);
    const medB = await Medicine.findById(b.medicine._id).lean();
    check('regular patient: no agent run, keypad call as today', runsB.length === 0 && !!medB.caregiverAlertTime);

    const [runC] = await runsFor(c.patient._id);
    const medC = await Medicine.findById(c.medicine._id).lean();
    check('dementia patient, already taken in the app: no call', runC && tools(runC) === 'check_double_dose' && !medC.caregiverAlertTime, runC && runC.text);

    const [runD] = await runsFor(d.patient._id);
    check('dementia patient, no reminder record: calls anyway (never unreminded)', runD && tools(runD) === 'place_call' && !!(await Medicine.findById(d.medicine._id).lean()).caregiverAlertTime);

    // ── tick 2: re-call after a snooze, dose still not taken ──
    await Medicine.updateOne({ _id: a.medicine._id }, { $set: { snoozeUntil: new Date(now.getTime() - 60000), caregiverAlertTime: null } });
    const later = new Date(now.getTime() + 11 * 60000);
    await quiet(() => runTick(later));
    const runsA2 = await runsFor(a.patient._id);
    check('re-call after snooze: agent checks again, then calls', runsA2.length === 2 && tools(runsA2[1]) === 'check_double_dose → place_call' && runsA2[1].steps[1].input.attempt === 'retry');

    // ── tick 3: re-call due, but she confirmed in the meantime ──
    await markDose(remA._id, 'taken', 'app');
    await Medicine.updateOne({ _id: a.medicine._id }, { $set: { snoozeUntil: new Date(later.getTime() - 60000), caregiverAlertTime: null } });
    await quiet(() => runTick(new Date(later.getTime() + 60000)));
    const runsA3 = await runsFor(a.patient._id);
    const medA3 = await Medicine.findById(a.medicine._id).lean();
    check('re-call due but confirmed meanwhile: no call, snooze cleared', runsA3.length === 3 && tools(runsA3[2]) === 'check_double_dose' && !medA3.caregiverAlertTime && !medA3.snoozeUntil,
      runsA3[2] && runsA3[2].text);
  } catch (err) {
    check('check ran without crashing', false, err.stack);
  } finally {
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
