// Live check of A1.4: taken / skipped from the app, for one dose, through markDose.
// PRD test: confirming in the app means no caregiver alert 10 minutes later. Also checks access
// (patient, primary caregiver yes; view-only caregiver, stranger no) and the medicine-ownership
// fix: a body patientId can't be used to edit another patient's medicine.
// Uses your dev database; Twilio off; the scheduler timer stopped. Deletes its test data.
// Run from server/:  npm run dose:check

require('dotenv').config({ quiet: true });
for (const v of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'RENDER']) delete process.env[v];
process.env.TWILIO_ENABLED = 'false';
if (process.env.NODE_ENV === 'production') process.env.NODE_ENV = 'development';
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'dose-check-local-secret'; // only for this script

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
const jwt = require('jsonwebtoken');
const { runTick, task } = require('../jobs/missedDoseCron');
task.stop();

const User = require('../models/User');
const Patient = require('../models/Patient');
const Medicine = require('../models/Medicine');
const Reminder = require('../models/Reminder');
const AgentRun = require('../models/AgentRun');
const CaregiverAlert = require('../models/CaregiverAlert');
const CaregiverAccess = require('../models/CaregiverAccess');

const TAG = `dose-check-${Date.now()}`;
const MIN = 60000;
const results = [];
const check = (name, passed, detail = '') => {
  results.push(!!passed);
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const quiet = async (fn) => {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = () => {};
  try { return await fn(); } finally { Object.assign(console, saved); }
};

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log(`Connected to ${mongoose.connection.name} (Twilio off, scheduler timer stopped)\n`);
  const made = { users: [], patients: [], medicines: [] };
  let server;
  try {
    let n = 0;
    const mkUser = async (name, role) => {
      const u = await User.create({ name: `${name} ${TAG}`, phone: `+9196${String(Date.now()).slice(-6)}${n++}`, passwordHash: 'x', role });
      made.users.push(u._id);
      return u;
    };
    const amma = await mkUser('Amma', 'patient');
    const priya = await mkUser('Priya', 'caregiver'); // primary
    const ravi = await mkUser('Ravi', 'caregiver'); // view only
    const other = await mkUser('Other', 'patient'); // a different patient
    const patient = await Patient.create({ user: amma._id, emergencyContact: '+910000000007' });
    const otherPatient = await Patient.create({ user: other._id, emergencyContact: '+910000000008' });
    made.patients.push(patient._id, otherPatient._id);
    await CaregiverAccess.create([
      { patient: patient._id, user: priya._id, role: 'primary', status: 'active' },
      { patient: patient._id, user: ravi._id, role: 'view', status: 'active' },
    ]);

    const now = new Date(Math.floor(Date.now() / MIN) * MIN);
    const hhmm = (d) => { const x = new Date(d.getTime() + 5.5 * 3600000); return `${String(x.getUTCHours()).padStart(2, '0')}:${String(x.getUTCMinutes()).padStart(2, '0')}`; };
    const med = await Medicine.create({
      patient: patient._id, name: 'Amlodipine', dosage: '5mg', type: 'tablet', frequency: 'twice',
      scheduledTimes: [hhmm(now), hhmm(new Date(+now + 6 * 3600000))], notificationType: 'call', startDate: new Date(+now - 86400000),
    });
    const med2 = await Medicine.create({
      patient: patient._id, name: 'Metformin', dosage: '500mg', type: 'tablet', frequency: 'once', scheduledTimes: ['07:00'],
      notificationType: 'call', startDate: new Date(+now - 86400000),
    });
    const otherMed = await Medicine.create({
      patient: otherPatient._id, name: 'Aspirin', dosage: '75mg', type: 'tablet', frequency: 'once', scheduledTimes: ['09:00'], startDate: new Date(),
    });
    made.medicines.push(med._id, med2._id, otherMed._id);
    const dose1 = await Reminder.create({ medicine: med._id, patient: patient._id, scheduledTime: now, status: 'pending' });
    const dose2 = await Reminder.create({ medicine: med._id, patient: patient._id, scheduledTime: new Date(+now + 6 * 3600000), status: 'pending' });
    const missed = await Reminder.create({ medicine: med2._id, patient: patient._id, scheduledTime: new Date(+now - 30 * MIN), status: 'missed', caregiverAlerted: true });

    const app = express();
    app.use(express.json());
    app.use('/api/v1/doses', require('../routes/doseRoutes'));
    app.use('/api/v1/medicines', require('../routes/medicineRoutes'));
    server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}/api/v1`;
    const call = async (method, path, user, body) => {
      const r = await fetch(base + path, {
        method,
        headers: { Authorization: `Bearer ${jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '5m' })}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      let data = null;
      try { data = await r.json(); } catch { /* no body */ }
      return { status: r.status, data };
    };

    // the scheduler calls the first dose and arms its 10-minute clock
    await quiet(() => runTick(now));
    const armed = await Reminder.findById(dose1._id).lean();
    check('setup: the scheduler called the first dose and armed its caregiver clock', armed.attempts === 1 && !!armed.caregiverAlertTime);

    // GET /medicines shows the current dose and its own state
    const list = await call('GET', '/medicines', amma);
    const m1 = list.data && list.data.find((m) => String(m._id) === String(med._id));
    const m2 = list.data && list.data.find((m) => String(m._id) === String(med2._id));
    check('GET /medicines: each medicine carries its current dose id and that dose\'s status',
      m1 && m1.todayReminderId === String(dose1._id) && m1.status === 'due' && m1.caregiverAlerted === false, m1 && `${m1.status}, dose ${m1.todayReminderId}`);
    check('GET /medicines: a missed dose shows missed + caregiver alerted (per dose, not per medicine)',
      m2 && m2.status === 'missed' && m2.caregiverAlerted === true && m2.todayReminderId === String(missed._id));

    // the patient taps "Taken"
    const took = await call('POST', `/doses/${dose1._id}/status`, amma, { status: 'taken' });
    const d1 = await Reminder.findById(dose1._id).lean();
    check('POST /doses/:id/status taken: recorded by the app, this dose\'s clock disarmed',
      took.status === 200 && d1.status === 'taken' && d1.confirmedBy === 'app' && !d1.caregiverAlertTime && !d1.snoozeUntil);

    // PRD test: 11 minutes later, no caregiver alert
    await quiet(() => runTick(new Date(+now + 11 * MIN)));
    const alerts = await CaregiverAlert.countDocuments({ patient: patient._id });
    check('PRD: confirmed in the app → no caregiver alert 10 minutes later', alerts === 0 && (await Reminder.findById(dose1._id).lean()).status === 'taken', `${alerts} alert(s)`);
    const d2 = await Reminder.findById(dose2._id).lean();
    check('the other dose of the same medicine is untouched', d2.status === 'pending' && !d2.confirmedAt);

    // a taken dose stays taken
    const again = await call('POST', `/doses/${dose1._id}/status`, amma, { status: 'skipped' });
    check('a dose already taken stays taken (skip afterwards changes nothing)', again.status === 200 && again.data.alreadyRecorded && again.data.reminder.status === 'taken');
    check('bad status is rejected', (await call('POST', `/doses/${dose2._id}/status`, amma, { status: 'gone' })).status === 400);

    // access
    check('a view-only caregiver cannot record a dose', (await call('POST', `/doses/${dose2._id}/status`, ravi, { status: 'skipped' })).status === 403);
    check('another patient cannot record this patient\'s dose', (await call('POST', `/doses/${dose2._id}/status`, other, { status: 'taken' })).status === 403);
    const byPrimary = await call('POST', `/doses/${dose2._id}/status`, priya, { status: 'skipped' });
    check('the primary caregiver can record a dose', byPrimary.status === 200 && (await Reminder.findById(dose2._id).lean()).status === 'skipped');

    // the old route is gone
    check('old POST /medicines/:id/status is removed', (await call('POST', `/medicines/${med._id}/status`, amma, { status: 'taken' })).status === 404);

    // ownership fix: a body patientId can't redirect the check
    const hijack = await call('PUT', `/medicines/${med._id}`, other, { patientId: String(otherPatient._id), name: 'Hacked' });
    const hijackDel = await call('DELETE', `/medicines/${med._id}`, other, { patientId: String(otherPatient._id) });
    const stillThere = await Medicine.findById(med._id).lean();
    check('security: another patient can\'t edit or delete this medicine by naming their own patient in the body',
      hijack.status === 403 && hijackDel.status === 403 && stillThere.name === 'Amlodipine' && stillThere.isActive !== false, `PUT ${hijack.status}, DELETE ${hijackDel.status}`);
    const own = await call('PUT', `/medicines/${otherMed._id}`, other, { dosage: '150mg' });
    check('a patient can still edit their own medicine', own.status === 200 && (await Medicine.findById(otherMed._id).lean()).dosage === '150mg', `status ${own.status}`);
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
