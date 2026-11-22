// Live check of follow-ups between calls (A4.3, the Planner).
// PRD gate: a seeded "my knee hurts" produces exactly one follow-up on the next call, after the dose.
// Also: one per concern (no duplicates), not asked twice the same day, "better" closes it, three
// asks close it, she is never advised, the journal shows it, the caregiver can list and close.
// Runs the real dose flow in-process with no model (the rules decide, no Groq tokens).
// Uses your dev database; Twilio off; deletes its test data.  Run from server/:  npm run followup:check

require('dotenv').config({ quiet: true });
for (const v of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'RENDER']) delete process.env[v];
process.env.TWILIO_ENABLED = 'false';
process.env.LLM_PROVIDER = 'none';
delete process.env.FOLLOWUP_DELAY_HOURS;
if (process.env.NODE_ENV === 'production') process.env.NODE_ENV = 'development';
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'followup-check-local-secret';

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
const { handleTurn } = require('../agent/orchestrator');
const { startDoseCall } = require('../agent/flows/dose');
const User = require('../models/User');
const Patient = require('../models/Patient');
const Medicine = require('../models/Medicine');
const Reminder = require('../models/Reminder');
const AgentRun = require('../models/AgentRun');
const CaregiverAlert = require('../models/CaregiverAlert');
const CaregiverAccess = require('../models/CaregiverAccess');
const AgentQuestion = require('../models/AgentQuestion');
const FollowUp = require('../models/FollowUp');
const JournalEntry = require('../models/JournalEntry');

const TAG = `followup-check-${Date.now()}`;
const results = [];
const check = (name, passed, detail = '') => {
  results.push(!!passed);
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${String(detail).slice(0, 220)})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const spoken = (actions) => (actions || []).filter((a) => a.text).map((a) => a.text).join(' ');

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log(`Connected to ${mongoose.connection.name} (Twilio off, no model)\n`);
  const made = { users: [], patients: [], medicines: [] };
  let server;
  try {
    const n = String(Date.now()).slice(-7);
    const amma = await User.create({ name: `Kamala ${TAG}`, phone: `+9193${n}`, passwordHash: 'x', role: 'patient' });
    const priya = await User.create({ name: `Priya ${TAG}`, phone: `+9194${n}`, passwordHash: 'x', role: 'caregiver' });
    const other = await User.create({ name: `Other ${TAG}`, phone: `+9195${n}`, passwordHash: 'x', role: 'caregiver' });
    made.users.push(amma._id, priya._id, other._id);
    const patient = await Patient.create({ user: amma._id, emergencyContact: '+910000000031', dementiaMode: true });
    made.patients.push(patient._id);
    await CaregiverAccess.create({ patient: patient._id, user: priya._id, role: 'primary', status: 'active', approvedAt: new Date() });
    const med = await Medicine.create({ patient: patient._id, name: 'Amlodipine', dosage: '5mg', type: 'tablet', frequency: 'once', scheduledTimes: ['08:00'], pillDescription: 'small white round tablet', startDate: new Date(Date.now() - 86400000), notificationType: 'call' });
    made.medicines.push(med._id);
    let k = 0;
    const newDose = () => Reminder.create({ medicine: med._id, patient: patient._id, scheduledTime: new Date(Date.now() - (2 + (k += 1)) * 60000), status: 'pending', attempts: 1 });
    // one dose call, her lines in order; returns the agent's words per turn and the dose
    const call = async (lines) => {
      const d = await newDose();
      const c = await startDoseCall({ reminderId: d._id, trigger: 'simulate', channel: 'text' });
      const said = [spoken(c.actions)];
      let ended = false;
      for (const l of lines) {
        if (ended) break;
        const r = await handleTurn({ sessionId: c.sessionId, transcript: l, isFinal: true });
        said.push(spoken(r.actions));
        ended = r.actions.some((a) => a.type === 'hangup');
      }
      await sleep(600); // the Planner runs in the background after the call
      return { said, ended, dose: await Reminder.findById(d._id).lean(), runId: c.runId };
    };

    // 1. she mentions her knee during a dose call → one FollowUp, her exact words
    const c1 = await call(['Yes, I took it. My knee is hurting a lot today.', 'The small white round one.']);
    const fu = await FollowUp.find({ patient: patient._id }).lean();
    const run1 = await AgentRun.findById(c1.runId).lean();
    check('"My knee is hurting a lot today." → exactly one follow-up (knee), her exact words, linked to the call',
      fu.length === 1 && fu[0].concern === 'knee' && fu[0].quote === 'My knee is hurting a lot today.' && String(fu[0].sourceRun) === String(c1.runId) && fu[0].status === 'open', JSON.stringify(fu.map((f) => f.concern)));
    check('the call itself is unchanged (dose recorded, "Goodbye for now"); the Planner step is on the run',
      c1.dose.status === 'taken' && /Goodbye for now/.test(c1.said.at(-1)) && run1.steps.some((s) => s.tool === 'plan_followup' && s.summaryText === 'Will ask about knee pain on the next call.'), c1.said.at(-1));

    // 2. the next call: asked once, AFTER the dose is recorded; her answer noted, no advice
    const c2 = await call(['Yes, I have taken it.', 'The small white round one.', 'Still hurts a little.']);
    const askTurn = c2.said[2];
    const fu2 = await FollowUp.findOne({ patient: patient._id }).lean();
    check('next call: after the right pill, "That\'s right. Well done, Kamala. Last time you said your knee was hurting. Is it better today?"',
      /That's right\. Well done, Kamala\. Last time you said your knee was hurting\. Is it better today\?/.test(askTurn), askTurn);
    check('…asked only after the dose was recorded; "Still hurts a little." → "Thank you for telling me. I\'ll let Priya know." and goodbye',
      c2.dose.status === 'taken' && /Thank you for telling me\. I'll let Priya know/.test(c2.said[3]) && c2.ended, c2.said[3]);
    check('…the follow-up stays open, asked once, her answer saved, next ask on a later day',
      fu2.status === 'open' && fu2.asks === 1 && fu2.lastAnswer === 'Still hurts a little.' && fu2.nextAsk > new Date(Date.now() + 19 * 3600000));
    check('never advises: no "rest", "apply", "take", "doctor" in the follow-up lines', !/\b(rest|apply|take a|doctor|ice|cream)\b/i.test(`${askTurn} ${c2.said[3]}`));

    // 3. a third call the same day: not asked again; the knee said again → still one follow-up
    const c3 = await call(['Yes, I took it. My knee still hurts.', 'The small white round one.']);
    check('same day again: no follow-up question (plain goodbye); "my knee still hurts" adds no second follow-up',
      /Goodbye for now/.test(c3.said.at(-1)) && !/Last time you said/.test(c3.said.join(' ')) && (await FollowUp.countDocuments({ patient: patient._id })) === 1, c3.said.at(-1));

    // 4. a later day, "much better" → closed, glad
    await FollowUp.updateOne({ patient: patient._id }, { $set: { nextAsk: new Date(Date.now() - 1000) } });
    const c4 = await call(['Yes, done.', 'The small white round one.', 'Yes, it is much better now.']);
    const fu4 = await FollowUp.findOne({ patient: patient._id }).lean();
    check('a later day: asked again; "much better" → "I\'m glad to hear that." and the follow-up is closed (better)',
      /Last time you said your knee/.test(c4.said[2]) && /I'm glad to hear that/.test(c4.said[3]) && fu4.status === 'closed' && fu4.closedReason === 'better', `${c4.said[3]} / ${fu4.status} ${fu4.closedReason}`);

    // 5. three asks without "better" close it
    const f5 = await FollowUp.create({ patient: patient._id, concern: 'sleep', quote: "I couldn't sleep at all.", asks: 2, nextAsk: new Date(Date.now() - 1000) });
    const c5 = await call(['Yes, I took it.', 'The small white round one.', 'No, not really.']);
    const f5b = await FollowUp.findById(f5._id).lean();
    check('third ask without "better" → closed (asked_3_times); her answer kept for the journal',
      /weren't sleeping well/.test(c5.said[2]) && f5b.status === 'closed' && f5b.closedReason === 'asked_3_times' && f5b.lastAnswer === 'No, not really.', `${f5b.status} ${f5b.closedReason}`);

    // 6. a Hindi concern, by the rules
    const c6 = await call(['हाँ, मैंने दवा ले ली। आज भूख नहीं लग रही।', 'छोटी सफ़ेद गोल गोली।']);
    check('Hindi: "आज भूख नहीं लग रही" → an appetite follow-up', (await FollowUp.countDocuments({ patient: patient._id, concern: 'appetite', status: 'open' })) === 1 && c6.dose.status === 'taken');

    // 7. the journal shows the answers and the new concerns, each linked to its call
    const { generateDailyJournal } = require('../services/journalService');
    await generateDailyJournal(patient._id, new Date()).catch((e) => console.log('journal:', e.message));
    const entry = await JournalEntry.findOne({ patient: patient._id }).sort({ createdAt: -1 }).lean();
    const texts = entry ? entry.lines.map((l) => l.text) : [];
    check('journal: "Asked about knee pain: …" and "Mentioned … MedTime will ask about it on the next call."',
      texts.some((t) => /^Asked about knee pain: "Still hurts a little\."/.test(t)) && texts.some((t) => /^Mentioned knee pain; MedTime will ask/.test(t)), texts.join(' | '));

    // 8. the caregiver lists and closes; another caregiver can't
    const app = express();
    app.use(express.json());
    app.use('/api/v1/followups', require('../routes/followUpRoutes'));
    server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}/api/v1/followups`;
    const as = (u) => ({ Authorization: `Bearer ${jwt.sign({ id: String(u._id), role: 'caregiver' }, process.env.JWT_SECRET)}`, 'Content-Type': 'application/json' });
    const list = await (await fetch(`${base}?patientId=${patient._id}`, { headers: as(priya) })).json();
    const appetite = list.followUps.find((f) => f.concern === 'appetite');
    const denied = await fetch(`${base}/${appetite.id}/close`, { method: 'PATCH', headers: as(other) });
    const closed = await (await fetch(`${base}/${appetite.id}/close`, { method: 'PATCH', headers: as(priya) })).json();
    check('caregiver: lists open follow-ups ("not feeling hungry"), closes one; an unlinked caregiver gets 403',
      appetite && appetite.about === 'not feeling hungry' && denied.status === 403 && closed.followUp.status === 'closed' && closed.followUp.closedReason === 'caregiver', `${denied.status}`);
  } catch (err) {
    check('check ran without crashing', false, err.stack);
  } finally {
    if (server) server.close();
    await sleep(500);
    await FollowUp.deleteMany({ patient: { $in: made.patients } });
    await JournalEntry.deleteMany({ patient: { $in: made.patients } });
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
