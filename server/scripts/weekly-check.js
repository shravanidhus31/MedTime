// Live check of the weekly review (fix 8; Features 1 and 3; plan 6.4 / 6.5).
// Gates: every call leaves measures; a change is flagged only when it is worse 2 weeks running, in
// the same part of the day, and nothing explains it (medicine change, call quality, the caregiver's
// answer about illness or sleep); quotes are her real words; never a diagnosis; harder evenings
// 3 weeks running → one Level-1 proposal to call earlier, which the caregiver approves and the
// scheduler then follows; caregiver feedback is access-checked and widens the margin.
// No model (rules only). Uses your dev database; Twilio off; deletes its test data.
// Run from server/:  npm run weekly:check

require('dotenv').config({ quiet: true });
for (const v of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'RENDER']) delete process.env[v];
process.env.TWILIO_ENABLED = 'false';
process.env.LLM_PROVIDER = 'none';
if (process.env.NODE_ENV === 'production') process.env.NODE_ENV = 'development';
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'weekly-check-local-secret';

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
const { generateWeeklyReview } = require('../services/weeklyReviewService');
const M = (n) => require(`../models/${n}`);
const [User, Patient, Medicine, Reminder, AgentRun, CaregiverAlert, CaregiverAccess, AgentQuestion, Observation, WeeklyReview, ProposedChange, FollowUp] =
  ['User', 'Patient', 'Medicine', 'Reminder', 'AgentRun', 'CaregiverAlert', 'CaregiverAccess', 'AgentQuestion', 'Observation', 'WeeklyReview', 'ProposedChange', 'FollowUp'].map(M);

const TAG = `weekly-check-${Date.now()}`;
const DAY = 24 * 3600 * 1000;
const results = [];
const check = (name, passed, detail = '') => {
  results.push(!!passed);
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${String(detail).slice(0, 240)})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log(`Connected to ${mongoose.connection.name} (Twilio off, no model)\n`);
  const made = { users: [], patients: [], medicines: [] };
  let server;
  const now = new Date();
  const at = (daysAgo, hourIst) => { const d = new Date(now.getTime() - daysAgo * DAY); const x = new Date(d.getTime() + 5.5 * 3600000); return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate(), hourIst, 0) - 5.5 * 3600000); };
  const block = (h) => (h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night');
  let n = 0;
  const person = async (label) => {
    n += 1;
    const ph = `${String(Date.now()).slice(-6)}${n}`;
    const u = await User.create({ name: `${label} ${TAG}`, phone: `+9196${ph}`, passwordHash: 'x', role: 'patient' });
    const cg = await User.create({ name: `Priya ${TAG}`, phone: `+9197${ph}`, passwordHash: 'x', role: 'caregiver' });
    made.users.push(u._id, cg._id);
    const p = await Patient.create({ user: u._id, emergencyContact: '+910000000051', dementiaMode: true });
    made.patients.push(p._id);
    await CaregiverAccess.create({ patient: p._id, user: cg._id, role: 'primary', status: 'active', approvedAt: new Date() });
    return { p, u, cg };
  };
  // one measured call (Observation rows), optionally with her words on an AgentRun
  const obsCall = async (p, daysAgo, hourIst, m, words) => {
    const t = at(daysAgo, hourIst);
    const run = await AgentRun.create({ trigger: 'phone_call', patient: p._id, flow: 'dose', status: 'finished', startedAt: t, steps: (words || []).map((w) => ({ tool: 'patient_said', input: { text: w }, output: { ok: true }, at: t })) });
    await Observation.insertMany(Object.entries(m).map(([metric, value]) => ({ patient: p._id, callId: run._id, callType: 'phone', source: 'code', metric, value, timeOfDay: block(hourIst), timestamp: t })));
  };
  // her first 4 weeks (from 40 days ago): about one request to repeat every other morning call
  const baseline = async (p) => { for (let i = 0; i < 10; i += 1) await obsCall(p, 40 - i * 2, 9, { clarificationCount: i % 2, turnLengthWords: 6, asrConfidence: 0.9 }); };
  const worseTwoWeeks = async (p) => {
    await obsCall(p, 12, 9, { clarificationCount: 3, turnLengthWords: 6, asrConfidence: 0.9 });
    await obsCall(p, 9, 9, { clarificationCount: 2, turnLengthWords: 6, asrConfidence: 0.9 });
    await obsCall(p, 5, 9, { clarificationCount: 3, turnLengthWords: 6, asrConfidence: 0.9 }, ['What? Say that again please.', 'Yes I took the white one.']);
    await obsCall(p, 2, 9, { clarificationCount: 4, turnLengthWords: 6, asrConfidence: 0.88 }, ['Sorry, what? I did not hear you.']);
  };

  try {
    // 1. a real dose call leaves its measures
    const a = await person('Kamala');
    const med = await Medicine.create({ patient: a.p._id, name: 'Amlodipine', dosage: '5mg', type: 'tablet', frequency: 'once', scheduledTimes: ['08:00'], pillDescription: 'small white round tablet', startDate: new Date(now - 60 * DAY), notificationType: 'call' });
    made.medicines.push(med._id);
    const d = await Reminder.create({ medicine: med._id, patient: a.p._id, scheduledTime: new Date(now - 2 * 60000), status: 'pending', attempts: 1 });
    const c = await startDoseCall({ reminderId: d._id, trigger: 'simulate', channel: 'text' });
    for (const t of ['What? Say that again.', 'Yes, I took it.', 'The small white round one.']) await handleTurn({ sessionId: c.sessionId, transcript: t, isFinal: true });
    await sleep(800);
    const rows = await Observation.find({ callId: c.runId }).lean();
    const byMetric = Object.fromEntries(rows.map((r) => [r.metric, r.value]));
    const run = await AgentRun.findById(c.runId).lean();
    check('every call leaves measures (code, not a model): clarificationCount 1, turnsToConfirm 3, a log_observation step',
      byMetric.clarificationCount === 1 && byMetric.turnsToConfirm === 3 && rows.every((r) => r.source === 'code') && run.steps.some((s) => s.tool === 'log_observation'), JSON.stringify(byMetric));

    // 2. not enough data → says so, compares nothing, invents nothing
    const r0 = await generateWeeklyReview(a.p._id, now, { useModel: false });
    check('a new patient: "Not enough calls yet to compare", no findings, no made-up baseline',
      /Not enough calls yet to compare/.test(r0.summaryLines[0].text) && r0.findings.length === 0 && r0.baselineMetrics.latencyMs === 0, r0.summaryLines[0].text);

    // 3. worse 2 weeks running, nothing explains it → ask the caregiver first
    const b = await person('Sita');
    await baseline(b.p); await worseTwoWeeks(b.p);
    const r1 = await generateWeeklyReview(b.p._id, now, { useModel: false });
    const f1 = r1.findings.find((f) => f.metric === 'clarificationCount');
    const q = await AgentQuestion.findOne({ patient: b.p._id }).lean();
    check('2 weeks worse on morning calls → "checking with Priya" before flagging; a caregiver question is asked',
      f1 && f1.status === 'checking_with_caregiver' && f1.timeBlock === 'morning' && q && /unwell, or sleeping badly/.test(q.question), r1.summaryLines.map((l) => l.text).join(' | '));
    check('the quotes are her own words from those calls (no invented quotes)',
      f1 && f1.quotes.length >= 1 && f1.quotes.every((x) => ['What? Say that again please.', 'Sorry, what? I did not hear you.'].includes(x)), JSON.stringify(f1 && f1.quotes));
    const rrun = await AgentRun.findById(r1.run).lean();
    check('the review is an agent run with its reasoning as steps (gather → compare → ask → check)',
      rrun.trigger === 'weekly_review' && ['gather_observations', 'compare_baseline', 'ask_caregiver', 'check_explanations'].every((t) => rrun.steps.some((s) => s.tool === t)) && rrun.status === 'waiting_for_caregiver', rrun.steps.map((s) => s.tool).join(' → '));

    // 4. the caregiver answers "No" (through the API) → re-run → flagged, for the doctor, not a diagnosis
    const app = express();
    app.use(express.json());
    app.use('/api/v1/agent/questions', require('../routes/agentQuestionRoutes'));
    app.use('/api/v1/weekly-review', require('../routes/weeklyReviewRoutes'));
    app.use('/api/v1/proposals', require('../routes/proposalRoutes'));
    server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}/api/v1`;
    const as = (u) => ({ Authorization: `Bearer ${jwt.sign({ id: String(u._id), role: 'caregiver' }, process.env.JWT_SECRET)}`, 'Content-Type': 'application/json' });
    const ans = await fetch(`${base}/agent/questions/${q._id}/answer`, { method: 'POST', headers: as(b.cg), body: JSON.stringify({ answer: 'No, nothing different' }) });
    await sleep(1500);
    const r2 = await WeeklyReview.findOne({ patient: b.p._id }).sort({ createdAt: -1 }).lean();
    const f2 = r2.findings.find((f) => f.metric === 'clarificationCount');
    check('Priya answers "No" → the review re-runs → "Worth mentioning to the doctor… not a diagnosis"',
      ans.status === 200 && String(r2._id) !== String(r1._id) && f2.status === 'flagged' && r2.summaryLines.some((l) => l.kind === 'flag' && /Worth mentioning to the doctor/.test(l.text) && /not a diagnosis/.test(l.text)) && /not a diagnosis/.test(r2.doctorReportSummary), r2.summaryLines.map((l) => l.text).join(' | '));

    // 5. explained changes are not flagged: a new medicine; poorer call quality
    const e = await person('Meena');
    await baseline(e.p); await worseTwoWeeks(e.p);
    const newMed = await Medicine.create({ patient: e.p._id, name: 'Donepezil', dosage: '5mg', type: 'tablet', frequency: 'once', scheduledTimes: ['21:00'], startDate: new Date(now - 10 * DAY), notificationType: 'call' });
    made.medicines.push(newMed._id);
    const r3 = await generateWeeklyReview(e.p._id, now, { useModel: false });
    const f3 = r3.findings[0];
    check('a medicine started in the last 3 weeks explains it: "Likely explained: … Donepezil started (before the change)", not flagged, no question',
      f3 && f3.status === 'explained' && /Donepezil started/.test(f3.explanation) && !(await AgentQuestion.findOne({ patient: e.p._id })), f3 && f3.explanation);
    const g = await person('Lata');
    await baseline(g.p);
    for (const [dd, cc] of [[12, 3], [9, 2], [5, 3], [2, 4]]) await obsCall(g.p, dd, 9, { clarificationCount: cc, turnLengthWords: 6, asrConfidence: 0.55 });
    const r4 = await generateWeeklyReview(g.p._id, now, { useModel: false });
    check('calls that were harder to hear explain it (speech recognition confidence 0.55, usually 0.9)',
      r4.findings[0] && r4.findings[0].status === 'explained' && /harder to hear/.test(r4.findings[0].explanation), r4.findings[0] && r4.findings[0].explanation);

    // 6. one week only → watch, not flagged
    const h = await person('Usha');
    await baseline(h.p);
    for (const [dd, cc] of [[12, 0], [9, 1], [5, 3], [2, 4]]) await obsCall(h.p, dd, 9, { clarificationCount: cc, turnLengthWords: 6 });
    const r5 = await generateWeeklyReview(h.p._id, now, { useModel: false });
    check('one week only → "One week only, not flagged", no finding, no question',
      r5.findings.length === 0 && r5.summaryLines.some((l) => l.kind === 'watch') && !(await AgentQuestion.findOne({ patient: h.p._id })), r5.summaryLines.map((l) => l.text).join(' | '));

    // 7. sundowning → one Level-1 proposal; approve → the scheduler calls 30 min early
    const s = await person('Radha');
    const eve = await Medicine.create({ patient: s.p._id, name: 'Atorvastatin', dosage: '10mg', type: 'tablet', frequency: 'once', scheduledTimes: ['20:00'], startDate: new Date(now - 60 * DAY), notificationType: 'call' });
    made.medicines.push(eve._id);
    for (const dd of [2, 4, 9, 16]) await obsCall(s.p, dd, 20, { sundowningAnxietyCount: 1, unclearTurns: 2 }, ['I want to go home, I am scared.']);
    await obsCall(s.p, 3, 9, { sundowningAnxietyCount: 0 });
    const r6 = await generateWeeklyReview(s.p._id, now, { useModel: false });
    const r7 = await generateWeeklyReview(s.p._id, now, { useModel: false });
    const props = await ProposedChange.find({ patient: s.p._id, kind: 'call_time_change' }).lean();
    check('harder evenings 3 weeks running → one Level-1 proposal "call 30 minutes earlier" (no duplicate on the next run)',
      r6.sundowning.detected && props.length === 1 && props[0].level === 1 && props[0].payload.shiftMinutes === -30 && /dose itself is not changed/.test(props[0].evidence) && r7.sundowning.detected, props[0] && props[0].evidence);
    const appr = await fetch(`${base}/proposals/${props[0]._id}/approve`, { method: 'POST', headers: as(s.cg), body: '{}' });
    const eveAfter = await Medicine.findById(eve._id).lean();
    check('Priya approves → the evening medicine is called 30 min early (callOffsetMinutes -30); the dose time stays 20:00',
      appr.status === 200 && eveAfter.callOffsetMinutes === -30 && eveAfter.scheduledTimes[0] === '20:00', `${appr.status} ${eveAfter.callOffsetMinutes}`);
    const doseAt = new Date(now.getTime() + 20 * 60000);
    const evDose = await Reminder.create({ medicine: eve._id, patient: s.p._id, scheduledTime: doseAt, status: 'pending' });
    const { runTick } = require('../jobs/missedDoseCron');
    const logs = []; const realLog = console.log; console.log = (...x) => logs.push(x.join(' '));
    await runTick(now);
    console.log = realLog;
    const evAfter = await Reminder.findById(evDose._id).lean();
    check('the scheduler calls 20 min before the dose because of the approved offset ("30 min early, as approved")',
      evAfter.attempts === 1 && logs.some((l) => /30 min early, as approved/.test(l)), logs.filter((l) => /FIRST CALL/.test(l)).join(' | '));

    // 8. feedback: access-checked; "not accurate" widens the margin
    const other = await person('Other');
    const denied = await fetch(`${base}/weekly-review/${r2._id}/feedback`, { method: 'POST', headers: as(other.cg), body: JSON.stringify({ markedAccurate: false }) });
    const fb = await (await fetch(`${base}/weekly-review/${r2._id}/feedback`, { method: 'POST', headers: as(b.cg), body: JSON.stringify({ markedAccurate: false }) })).json();
    check('feedback: an unlinked caregiver gets 403; Priya marks it "not accurate" → margin 25% → 35% for the next review',
      denied.status === 403 && fb.review.caregiverFeedback.adjustedMarginPercent === 35, `${denied.status} ${fb.review && fb.review.caregiverFeedback.adjustedMarginPercent}`);
  } catch (err) {
    check('check ran without crashing', false, err.stack);
  } finally {
    if (server) server.close();
    await sleep(800);
    for (const Mod of [Observation, WeeklyReview, ProposedChange, AgentQuestion, FollowUp, CaregiverAlert, CaregiverAccess, AgentRun, Reminder]) await Mod.deleteMany({ patient: { $in: made.patients } });
    await Medicine.deleteMany({ _id: { $in: made.medicines } });
    await Patient.deleteMany({ _id: { $in: made.patients } });
    await User.deleteMany({ _id: { $in: made.users } });
    await mongoose.disconnect();
    const passed = results.filter(Boolean).length;
    console.log(`\n${passed}/${results.length} passed (test data deleted)`);
    process.exit(passed === results.length ? 0 : 1);
  }
})();
