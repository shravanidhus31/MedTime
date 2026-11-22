// Live check of the call-in flow (Feature 7, plan 6.2) through the simulate API (text).
// Gate (B11): "Did I take my ... ?" answered correctly for taken, due and missed, with no answer
// that leads to a second dose; an ambiguous question gets exactly one follow-up; a question not
// covered by notes or logs gets no invented answer. Plus: a dose due now hands over to the dose
// flow in the same call; a dose later today is "not time yet"; the asked part of the day counts.
// Uses your dev database; Twilio off; deletes its test data.  Run from server/:  npm run callin:check

require('dotenv').config({ quiet: true });
for (const v of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'RENDER']) delete process.env[v];
process.env.TWILIO_ENABLED = 'false';
if (process.env.NODE_ENV === 'production') process.env.NODE_ENV = 'development';
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'callin-check-local-secret';

const dbName = (() => { try { return new URL(process.env.MONGO_URI).pathname.replace(/^\//, ''); } catch { return ''; } })();
if (!dbName || !/dev|test/i.test(dbName)) {
  console.error(`Refusing to run: MONGO_URI database is "${dbName || '(none)'}". Use a dev database such as medtime_dev_a.`);
  process.exit(1);
}

const mongoose = require('mongoose');
const express = require('express');
const jwt = require('jsonwebtoken');
const { initAgent } = require('../agent');
initAgent();
const User = require('../models/User');
const Patient = require('../models/Patient');
const Medicine = require('../models/Medicine');
const Reminder = require('../models/Reminder');
const AgentRun = require('../models/AgentRun');
const CaregiverAlert = require('../models/CaregiverAlert');
const CaregiverAccess = require('../models/CaregiverAccess');
const AgentQuestion = require('../models/AgentQuestion');
const { STAY_TEXT } = require('../agent/orchestrator');

const TAG = `callin-check-${Date.now()}`;
const MIN = 60000;
const results = [];
const check = (name, passed, detail = '') => {
  results.push(!!passed);
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const spoken = (actions) => (actions || []).filter((a) => a.text).map((a) => a.text).join(' ');

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log(`Connected to ${mongoose.connection.name} (Twilio off)\n`);
  const made = { users: [], patients: [], medicines: [] };
  let server;
  try {
    const amma = await User.create({ name: `Kamala ${TAG}`, phone: `+9194${String(Date.now()).slice(-7)}`, passwordHash: 'x', role: 'patient' });
    made.users.push(amma._id);
    const patient = await Patient.create({ user: amma._id, emergencyContact: '+910000000010', dementiaMode: true });
    made.patients.push(patient._id);

    const now = new Date();
    const istToday = (h, m = 0) => { const x = new Date(now.getTime() + 5.5 * 3600000); return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate(), h, m) - 5.5 * 3600000); };
    const mkMed = async (name, extra = {}) => {
      const m = await Medicine.create({ patient: patient._id, name, dosage: '5mg', type: 'tablet', frequency: 'once', scheduledTimes: ['08:00'], startDate: new Date(+now - 86400000), notificationType: 'call', ...extra });
      made.medicines.push(m._id);
      return m;
    };
    const dose = (m, at, extra = {}) => Reminder.create({ medicine: m._id, patient: patient._id, scheduledTime: at, status: 'pending', ...extra });

    const aml = await mkMed('Amlodipine');
    const met = await mkMed('Metformin', { pillDescription: 'large white oval' });
    const don = await mkMed('Donepezil');
    const los = await mkMed('Losartan');
    const ator = await mkMed('Atorvastatin', { frequency: 'twice' });
    await dose(aml, new Date(+now - 3 * 3600000), { status: 'taken', confirmedBy: 'app', confirmedAt: new Date(+now - 3 * 3600000) });
    const metDose = await dose(met, new Date(+now - 2 * MIN));
    const donDose = await dose(don, new Date(+now - 2 * 3600000));
    const losDose = await dose(los, new Date(+now + 5 * 3600000));
    await dose(ator, istToday(0, 5), { status: 'taken', confirmedBy: 'app', confirmedAt: istToday(0, 6) }); // just after midnight
    await dose(ator, istToday(21), {}); // 9:00 PM

    const app = express();
    app.use(express.json());
    app.use('/api/v1/simulate', require('../routes/simulateRoutes'));
    server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}/api/v1/simulate`;
    const headers = { Authorization: `Bearer ${jwt.sign({ id: amma._id, role: 'patient' }, process.env.JWT_SECRET, { expiresIn: '10m' })}`, 'Content-Type': 'application/json' };
    const post = async (path, body) => { const r = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body || {}) }); return { status: r.status, body: await r.json() }; };
    const start = async () => (await post('/callin', {})).body;
    const say = async (callId, text) => (await post(`/call/${callId}/say`, { text })).body;

    // 1. taken → told when, never told to take it again; "anything else?" → goodbye
    let c = await start();
    check('call-in greets and asks what she wants to know', /What would you like to know\?/.test(spoken(c.actions)), spoken(c.actions));
    let r = await say(c.callId, 'Did I take my Amlodipine?');
    check('taken: "Yes, you took Amlodipine at ..."; never told to take it again; "anything else?"', /Yes, you took Amlodipine at/.test(spoken(r.actions)) && !/take it now|take another/i.test(spoken(r.actions)) && /anything else/i.test(spoken(r.actions)), spoken(r.actions));
    r = await say(c.callId, 'No, thank you.');
    check('"no" ends the call with a goodbye', r.ended && /Goodbye/.test(spoken(r.actions)));

    // 2. due now → the dose flow takes over in the same call; double-dose check; check question
    c = await start();
    r = await say(c.callId, 'Did I take my Metformin?');
    check('due now, not recorded: the dose call starts in the same call (Metformin reminder)', /let's do it together now/.test(spoken(r.actions)) && /Metformin/.test(spoken(r.actions)) && !r.ended, spoken(r.actions));
    r = await say(c.callId, 'Yes, I have taken it.');
    check('…the dose flow asks the check question before recording', /Which tablet did you take\?/.test(spoken(r.actions)) && (await Reminder.findById(metDose._id).lean()).status !== 'taken');
    r = await say(c.callId, 'The large white Metformin.');
    const metAfter = await Reminder.findById(metDose._id).lean();
    const run2 = await AgentRun.findById(c.runId).lean();
    check('…recorded after the right pill; one call, one run (trigger callin, now about that dose)', metAfter.status === 'taken' && metAfter.confirmedBy === 'agent' && r.ended && run2.trigger === 'callin' && String(run2.reminder) === String(metDose._id));

    // 3. time passed, not recorded → don't take an extra one, caregiver phoned, nothing recorded
    c = await start();
    r = await say(c.callId, 'Did I take my Donepezil?');
    const alerts3 = await CaregiverAlert.find({ patient: patient._id }).lean();
    check('passed and not recorded: "Please do not take an extra one", caregiver phoned, nothing recorded',
      /do not take an extra one/i.test(spoken(r.actions)) && alerts3.length === 1 && (await Reminder.findById(donDose._id).lean()).status === 'pending', spoken(r.actions));

    // 4. later today → not time yet; no dose call
    c = await start();
    r = await say(c.callId, 'Did I take my Losartan?');
    check('later today: "It isn\'t time yet" with the time; no dose call (used to start it hours early)',
      /isn't time yet/i.test(spoken(r.actions)) && !/let's do it together/.test(spoken(r.actions)) && (await Reminder.findById(losDose._id).lean()).status === 'pending', spoken(r.actions));

    // 5. the part of the day she asks about
    r = await say(c.callId, 'Did I take my evening Atorvastatin?');
    check('"evening" picks the evening dose (9:00 PM), not the one just after midnight', /0?9:00 ?pm/i.test(spoken(r.actions)) && !/12:0/.test(spoken(r.actions)), spoken(r.actions));

    // 6. not covered: exactly one follow-up, then the caregiver; no invented answer
    c = await start();
    r = await say(c.callId, 'Who is my granddaughter?');
    const followUp = spoken(r.actions);
    r = await say(c.callId, 'The one with the red car.');
    const alerts6 = await CaregiverAlert.countDocuments({ patient: patient._id });
    check('not in notes or logs: exactly one follow-up question, then "I\'ll ask ... to call you"; no invented answer',
      /tell me a little more/i.test(followUp) && r.ended && /call you/.test(spoken(r.actions)) && alerts6 === 2, `${followUp} → ${spoken(r.actions)}`);

    // 7. a red flag during a call-in → emergency mode
    c = await start();
    r = await say(c.callId, 'I have fallen down in the kitchen.');
    const r2 = await say(c.callId, 'Okay.');
    check('red flag during a call-in: emergency reply, then only reassurance', r.emergency === 'fall' && spoken(r2.actions) === STAY_TEXT);

    // 8. a voice call-in gets hint words and its lines to prepare
    const v = (await post('/callin', { channel: 'voice' })).body;
    check('voice call-in: hint words and the lines to prepare (incl. each medicine\'s dose lines)', v.hints.includes('Amlodipine') && v.lines.some((t) => /What would you like to know/.test(t)) && v.lines.some((t) => /Metformin/.test(t)));
  } catch (err) {
    check('check ran without crashing', false, err.stack);
  } finally {
    if (server) server.close();
    await CaregiverAlert.deleteMany({ patient: { $in: made.patients } });
    await CaregiverAccess.deleteMany({ patient: { $in: made.patients } });
    await AgentQuestion.deleteMany({ patient: { $in: made.patients } });
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
