// Live check of the escalation cron: per-dose escalation (A1.3) and the agent hand-off (A2.6).
// Runs scheduler ticks directly on your dev database, at chosen times. Twilio is forced into
// simulation mode and the every-minute timer is stopped, so nothing runs on its own. Key presses
// go through the real keypad webhook over HTTP. No Groq requests: the hand-off is rules.
// Creates test data and deletes it afterwards.
// Run from server/:  npm run cron:check

require('dotenv').config({ quiet: true });
for (const v of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'RENDER']) delete process.env[v];
process.env.TWILIO_ENABLED = 'false';
if (process.env.NODE_ENV === 'production') process.env.NODE_ENV = 'development';

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
const { runTick, task, MAX_ALERT_ATTEMPTS } = require('../jobs/missedDoseCron');
task.stop(); // only the ticks this script runs

const User = require('../models/User');
const Patient = require('../models/Patient');
const Medicine = require('../models/Medicine');
const Reminder = require('../models/Reminder');
const AgentRun = require('../models/AgentRun');
const CaregiverAlert = require('../models/CaregiverAlert');
const twilio = require('../utils/twilioClient');
const { markDose } = require('../services/doseService');

const TAG = `cron-check-${Date.now()}`;
const MIN = 60000;
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
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = () => {};
  try {
    return await fn();
  } finally {
    Object.assign(console, saved);
  }
};
const tick = (at) => quiet(() => runTick(at));
const runsFor = (patientId) => AgentRun.find({ patient: patientId }).sort({ startedAt: 1 }).lean();
const tools = (run) => (run ? run.steps.map((s) => s.tool).join(' → ') : '(no run)');
const dose = (id) => Reminder.findById(id).lean();
const alertsFor = (patientId) => CaregiverAlert.find({ patient: patientId }).lean();

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log(`Connected to ${mongoose.connection.name} (Twilio in simulation mode, cron timer stopped)\n`);
  const made = { users: [], patients: [], medicines: [] };

  // The real keypad webhook (signature check is skipped: Twilio is off locally).
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use('/api/v1/webhooks', require('../routes/webhookRoutes'));
  const server = app.listen(0);
  const press = async (query, digit) => {
    const res = await quiet(() => fetch(`http://127.0.0.1:${server.address().port}/api/v1/webhooks/voice?${new URLSearchParams(query)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ Digits: digit }),
    }));
    return { status: res.status, text: await res.text() };
  };

  const realAlertCall = twilio.makeAlertCall;

  try {
    const now = new Date(Math.floor(Date.now() / MIN) * MIN); // on the minute, like a real tick
    const later = (mins) => new Date(now.getTime() + mins * MIN);
    let n = 0;
    const mkPatient = async (label, { dementiaMode = false, times = [toHHMM(now)], emergencyContact } = {}) => {
      const u = await User.create({ name: `${label} ${TAG}`, phone: `+9198${String(Date.now()).slice(-6)}${n++}`, passwordHash: 'x', role: 'patient' });
      made.users.push(u._id);
      const p = await Patient.create({ user: u._id, emergencyContact: emergencyContact || `+91000000${String(n).padStart(4, '0')}`, dementiaMode });
      made.patients.push(p._id);
      const m = await Medicine.create({
        patient: p._id, name: `Med-${label}`, dosage: '5mg', type: 'tablet', frequency: times.length === 2 ? 'twice' : 'once',
        scheduledTimes: times, notificationType: 'call', startDate: now,
      });
      made.medicines.push(m._id);
      return { patient: p, medicine: m };
    };
    const mkDose = (who, at, extra = {}) => Reminder.create({ medicine: who.medicine._id, patient: who.patient._id, scheduledTime: at, status: 'pending', ...extra });

    const a = await mkPatient('DementiaDue', { dementiaMode: true }); // agent checks, then calls; snoozes; confirms
    const b = await mkPatient('Regular'); // keypad flow; never answers → caregiver called
    const c = await mkPatient('DementiaTaken', { dementiaMode: true }); // already confirmed in the app
    const d = await mkPatient('DementiaNoRecord', { dementiaMode: true }); // no Reminder record yet
    const e = await mkPatient('TwiceADay', { times: [toHHMM(now), toHHMM(later(30))] }); // the PRD gate
    const f = await mkPatient('AlertFails', { emergencyContact: '+910000009999' }); // caregiver call can't be placed
    const g = await mkPatient('OldCall'); // call placed before A1.3: webhook URL has medicineId only
    const h = await mkPatient('LongAgo'); // a dose due an hour ago that was never called
    const r = await mkPatient('DementiaNoAnswer', { dementiaMode: true }); // never answers (A4.1 retries)

    const remA = await mkDose(a, now);
    const remB = await mkDose(b, now);
    const remC = await mkDose(c, now, { status: 'taken', confirmedBy: 'app', confirmedAt: now });
    const remE1 = await mkDose(e, now);
    const remE2 = await mkDose(e, later(30));
    const remF = await mkDose(f, now);
    const remG = await mkDose(g, now);
    const remH = await mkDose(h, later(-60));
    const remR = await mkDose(r, now);

    // Every caregiver alert call to f's number fails, as if Twilio refused it.
    twilio.makeAlertCall = async (phone, alertId) => {
      if (String(phone).includes('0000009999')) throw new Error('simulated Twilio failure');
      return realAlertCall(phone, alertId);
    };

    // ── tick at the dose time: first calls ──────────────────────────────────
    await tick(now);

    const [runA] = await runsFor(a.patient._id);
    const a1 = await dose(remA._id);
    check('dementia patient, dose due: agent run checks the log, then calls',
      runA && runA.trigger === 'dose_due' && tools(runA) === 'check_double_dose → place_call' && runA.steps[1].output.ok && String(runA.reminder) === String(remA._id),
      tools(runA));
    check('…this dose is armed: 1 call, clock set, status alerted', a1.attempts === 1 && !!a1.caregiverAlertTime && a1.status === 'alerted' && !!a1.lastCallAt);

    const b1 = await dose(remB._id);
    check('regular patient: no agent run, keypad call, this dose armed',
      (await runsFor(b.patient._id)).length === 0 && b1.attempts === 1 && !!b1.caregiverAlertTime);

    const c1 = await dose(remC._id);
    check('already taken in the app: no call, nothing armed', (await runsFor(c.patient._id)).length === 0 && !c1.attempts && !c1.caregiverAlertTime);

    const dDoses = await Reminder.find({ medicine: d.medicine._id }).lean();
    const [runD] = await runsFor(d.patient._id);
    check('no reminder record: one is created for this minute, then the agent checks and calls',
      dDoses.length === 1 && dDoses[0].scheduledTime.getTime() === now.getTime() && dDoses[0].attempts === 1 && tools(runD) === 'check_double_dose → place_call',
      `${dDoses.length} record(s), ${tools(runD)}`);
    await tick(now); // same minute again (e.g. two ticks): still one record, no second call
    check('…a second tick in the same minute creates no duplicate and calls no one twice',
      (await Reminder.countDocuments({ medicine: d.medicine._id })) === 1 && (await dose(dDoses[0]._id)).attempts === 1 && (await dose(remB._id)).attempts === 1);

    const e1a = await dose(remE1._id);
    const e2a = await dose(remE2._id);
    check('twice a day: the 1st dose is called; the 2nd (due later) is untouched', e1a.attempts === 1 && !!e1a.caregiverAlertTime && !e2a.attempts && !e2a.caregiverAlertTime);

    check('a dose due an hour ago and never called is not called now (no burst of calls after a deploy)', !(await dose(remH._id)).attempts);

    // ── key presses through the webhook ─────────────────────────────────────
    const snooze = await press({ reminderId: String(remA._id), medicineId: String(a.medicine._id) }, '2');
    const a2 = await dose(remA._id);
    check('keypad 2 snoozes exactly this dose: re-call in 10 min, caregiver clock paused',
      snooze.status === 200 && /10 minutes/.test(snooze.text) && !!a2.snoozeUntil && !a2.caregiverAlertTime && a2.status === 'alerted');

    const old = await press({ medicineId: String(g.medicine._id) }, '1');
    const g1 = await dose(remG._id);
    check('a call placed before A1.3 (medicineId only) still records its dose', old.status === 200 && g1.status === 'taken' && g1.confirmedBy === 'ivr' && !g1.caregiverAlertTime);

    // ── 11 minutes later: escalation for the doses nobody confirmed ──────────
    await tick(later(11));

    const b2 = await dose(remB._id);
    const bAlerts = await alertsFor(b.patient._id);
    check('no answer for 10 min: dose marked missed by the scheduler, caregiver PHONED (not SMS)',
      b2.status === 'missed' && b2.caregiverAlerted && b2.caregiverNotified && !b2.caregiverAlertTime && bAlerts.length === 1 && bAlerts[0].reason === 'missed_dose' && bAlerts[0].channel === 'call',
      bAlerts[0] && bAlerts[0].message);

    const e1b = await dose(remE1._id);
    const e2b = await dose(remE2._id);
    check('PRD gate: the 1st dose escalates while the 2nd dose of the same medicine stays untouched',
      e1b.status === 'missed' && e1b.caregiverAlerted && e2b.status === 'pending' && !e2b.attempts && !e2b.caregiverAlerted && !e2b.caregiverAlertTime);

    const runsA2 = await runsFor(a.patient._id);
    const a3 = await dose(remA._id);
    check('snoozed dose is NOT escalated; it is called again through the agent instead',
      a3.status === 'alerted' && !a3.caregiverAlerted && a3.attempts === 2 && !a3.snoozeUntil && !!a3.caregiverAlertTime
        && runsA2.length === 2 && tools(runsA2[1]) === 'check_double_dose → place_call' && runsA2[1].steps[1].input.attempt === 'retry');

    const r1 = await dose(remR._id);
    const runsR1 = await runsFor(r.patient._id);
    check('dementia, no answer: NOT escalated after 10 min; called again (2nd of 3), log checked first, no caregiver call',
      r1.status === 'alerted' && r1.attempts === 2 && !!r1.caregiverAlertTime && (await alertsFor(r.patient._id)).length === 0
        && runsR1.length === 2 && tools(runsR1[1]) === 'check_double_dose → place_call',
      `attempts=${r1.attempts}, ${runsR1.length} runs`);

    const f1 = await dose(remF._id);
    check('caregiver call could not be placed: not swallowed; alertFailed, try 1 recorded',
      f1.status === 'missed' && f1.alertFailed && f1.alertAttempts === 1 && !f1.caregiverAlerted && /simulated Twilio failure|Every alert call failed/.test(f1.alertError || ''),
      f1.alertError);

    // ── retries of the failed alert, one per tick, at most 3 in all ──────────
    for (const m of [12, 13, 14, 15]) await tick(later(m));
    const f2 = await dose(remF._id);
    const fAlerts = await alertsFor(f.patient._id);
    check(`failed caregiver alert retried on the next ticks, then given up after ${MAX_ALERT_ATTEMPTS} tries`,
      f2.alertAttempts === MAX_ALERT_ATTEMPTS && f2.alertFailed && fAlerts.length === MAX_ALERT_ATTEMPTS, `${f2.alertAttempts} tries, ${fAlerts.length} alert records`);

    // She confirms the re-called dementia dose in the app (its clock would run out at minute 21).
    await markDose(remA._id, 'taken', 'app');

    // ── the 2nd dose of the twice-a-day medicine comes due ───────────────────
    await tick(later(30));
    const e1c = await dose(remE1._id);
    const e2c = await dose(remE2._id);
    const r2 = await dose(remR._id);
    check('dementia, still no answer: 3rd and last call', r2.attempts === 3 && r2.status === 'alerted' && (await alertsFor(r.patient._id)).length === 0);

    check('the 2nd dose gets its own first call; the 1st is not called again',
      e2c.attempts === 1 && !!e2c.caregiverAlertTime && e2c.status === 'alerted' && e1c.attempts === 1 && (await Reminder.countDocuments({ medicine: e.medicine._id })) === 2);

    // Keypad 1 for the 2nd dose.
    const took = await press({ reminderId: String(remE2._id), medicineId: String(e.medicine._id) }, '1');
    const e2d = await dose(remE2._id);
    check('keypad 1 records exactly this dose and disarms its clock', took.status === 200 && e2d.status === 'taken' && e2d.confirmedBy === 'ivr' && !e2d.caregiverAlertTime);
    check('keypad 1 did not touch the 1st dose (still missed, caregiver alerted)', (await dose(remE1._id)).status === 'missed');

    // ── well past both clocks: confirmed doses must not escalate ─────────────
    await tick(later(45));
    const a4 = await dose(remA._id);
    const e2e = await dose(remE2._id);
    check('a confirmed dose stops everything: no escalation, no caregiver call (app and keypad)',
      a4.status === 'taken' && !a4.caregiverAlerted && (await alertsFor(a.patient._id)).length === 0
        && e2e.status === 'taken' && (await alertsFor(e.patient._id)).length === 1,
      `${(await alertsFor(e.patient._id)).length} alert(s) for the twice-a-day patient (expected 1, for the 1st dose)`);
    const r3 = await dose(remR._id);
    const rAlerts = await alertsFor(r.patient._id);
    check('dementia, 3 unanswered calls: then marked missed and the caregiver phoned (once)',
      r3.status === 'missed' && r3.caregiverAlerted && r3.attempts === 3 && rAlerts.length === 1 && rAlerts[0].reason === 'missed_dose',
      `${r3.status}, ${rAlerts.length} alert(s)`);
    check('keypad 2 on an already-taken dose does not snooze it', /already recorded as taken/.test((await press({ reminderId: String(remE2._id) }, '2')).text) && !(await dose(remE2._id)).snoozeUntil);
  } catch (err) {
    check('check ran without crashing', false, err.stack);
  } finally {
    twilio.makeAlertCall = realAlertCall;
    server.close();
    await CaregiverAlert.deleteMany({ patient: { $in: made.patients } });
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
