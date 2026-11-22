// Live check of the weekly chat call (Feature 1, the speech-screening paper's measures).
// Gates: on/off per patient (off by default; the Sunday job calls only those switched on); the
// agent asks the fixed question and "tell me a bit more" at most twice; at least 50 words → the
// paper's measures (MTLD, HD-D, Brunet, CTTR, noun/verb share) as Observations; under 50 → nothing
// measured; "not now" respected; browser timings → speech rate and time before answering; red
// flags still win; the phone route; the weekly review compares chats week on week.
// No model (rules only). Uses your dev database; Twilio off; deletes its test data.
// Run from server/:  npm run chat:check

require('dotenv').config({ quiet: true });
for (const v of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'RENDER']) delete process.env[v];
process.env.TWILIO_ENABLED = 'false';
process.env.LLM_PROVIDER = 'none';
process.env.PUBLIC_BASE_URL = 'https://medtime.example.test';
if (process.env.NODE_ENV === 'production') process.env.NODE_ENV = 'development';
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'chat-check-local-secret';

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
const { startChatCall } = require('../agent/flows/chat');
const M = (n) => require(`../models/${n}`);
const [User, Patient, AgentRun, Observation, CaregiverAlert, CaregiverAccess, WeeklyReview, AgentQuestion, FollowUp] = ['User', 'Patient', 'AgentRun', 'Observation', 'CaregiverAlert', 'CaregiverAccess', 'WeeklyReview', 'AgentQuestion', 'FollowUp'].map(M);

const TAG = `chat-check-${Date.now()}`;
const results = [];
const check = (name, passed, detail = '') => {
  results.push(!!passed);
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${String(detail).slice(0, 220)})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const spoken = (a) => (a || []).filter((x) => x.text).map((x) => x.text).join(' ');
const PART1 = 'First I fill the small steel pan with water and put it on the stove for a few minutes.';
const PART2 = 'When it starts boiling I add crushed ginger, two cardamom pods and a spoon of tea leaves, then fresh milk and a little sugar.';
const PART3 = 'I let it simmer until the colour turns golden brown, strain it into my favourite cup and sit near the window with my newspaper.';

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log(`Connected to ${mongoose.connection.name} (Twilio off, no model)\n`);
  const made = { users: [], patients: [] };
  let server;
  try {
    const n = String(Date.now()).slice(-7);
    const u = await User.create({ name: `Kamala ${TAG}`, phone: `98${n}1`.slice(0, 10), passwordHash: 'x', role: 'patient' });
    const other = await User.create({ name: `Lata ${TAG}`, phone: `97${n}2`.slice(0, 10), passwordHash: 'x', role: 'patient' });
    made.users.push(u._id, other._id);
    const p = await Patient.create({ user: u._id, emergencyContact: '+910000000061', dementiaMode: true });
    const q = await Patient.create({ user: other._id, emergencyContact: '+910000000062', dementiaMode: true });
    made.patients.push(p._id, q._id);
    const app = express();
    app.use(express.urlencoded({ extended: false }));
    app.use(express.json());
    app.use('/api/v1/users', require('../routes/userRoutes'));
    app.use('/api/v1/voice/agent', require('../routes/voiceAgentRoutes'));
    server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const tok = (id) => ({ Authorization: `Bearer ${jwt.sign({ id: String(id), role: 'patient' }, process.env.JWT_SECRET)}`, 'Content-Type': 'application/json' });

    // 1. on/off: off by default; the Sunday job calls only patients who switched it on
    const before = await (await fetch(`${base}/api/v1/users/care-settings`, { headers: tok(u._id) })).json();
    const on = await (await fetch(`${base}/api/v1/users/care-settings`, { method: 'PUT', headers: tok(u._id), body: JSON.stringify({ weeklyChat: true }) })).json();
    const logs = []; const realLog = console.log; console.log = (...x) => logs.push(x.join(' '));
    await require('../jobs/weeklyReviewJob').runWeeklyChats();
    console.log = realLog;
    const mine = logs.filter((l) => /Weekly chat call/.test(l));
    check('weekly chat is OFF by default; switched on in Settings; the Sunday job calls her (and not the patient who left it off)',
      before.weeklyChat === false && on.weeklyChat === true && mine.some((l) => l.includes(String(p._id))) && !mine.some((l) => l.includes(String(q._id))), mine.join(' | '));

    // 2. the conversation: fixed question, "tell me a bit more", thanks at 50+ words → measured
    let c = await startChatCall({ patientId: p._id, channel: 'text' });
    check('it asks the fixed question: "how do you make your morning tea?"', /how do you make your morning tea\?/.test(spoken(c.actions)), spoken(c.actions));
    let r = await handleTurn({ sessionId: c.sessionId, transcript: PART1, timing: { latencyMs: 900, speechMs: 6000 } });
    const more = spoken(r.actions);
    r = await handleTurn({ sessionId: c.sessionId, transcript: PART2, timing: { latencyMs: 1100, speechMs: 9000 } });
    const more2 = spoken(r.actions);
    r = await handleTurn({ sessionId: c.sessionId, transcript: PART3, timing: { latencyMs: 1000, speechMs: 9000 } });
    await sleep(800);
    const rows = Object.fromEntries((await Observation.find({ callId: c.runId }).lean()).map((o) => [o.metric, o.value]));
    check('under 50 words → "Tell me a bit more" then "And then what do you do?"; at 50+ → "Thank you… Goodbye"',
      /Tell me a bit more/.test(more) && /And then what do you do\?/.test(more2) && /Thank you, Kamala/.test(spoken(r.actions)) && r.actions.some((a) => a.type === 'hangup'), `${more} / ${more2}`);
    check("the paper's measures saved (MTLD, HD-D, Brunet, CTTR, noun/verb share, words), from code",
      ['mtld', 'hdd', 'brunetW', 'cttr', 'nounShare', 'verbShare', 'wordCount'].every((k) => typeof rows[k] === 'number') && rows.wordCount >= 50, JSON.stringify(rows));
    check('browser timings → speech rate (words a minute) and time before answering (average)',
      rows.speechRateWpm > 100 && rows.speechRateWpm < 300 && rows.latencyMs === 1000, `${rows.speechRateWpm} wpm, ${rows.latencyMs} ms`);

    // 3. under 50 words after two prompts → thanks, nothing measured
    c = await startChatCall({ patientId: p._id, channel: 'text' });
    for (const t of ['I boil water.', 'Then tea leaves.', 'Then milk.']) r = await handleTurn({ sessionId: c.sessionId, transcript: t });
    await sleep(600);
    const run3 = await AgentRun.findById(c.runId).lean();
    check('under 50 words after two prompts → thanks and goodbye; NOTHING measured, and the run says why',
      /Thank you/.test(spoken(r.actions)) && (await Observation.countDocuments({ callId: c.runId })) === 0 && run3.steps.some((s) => s.tool === 'log_observation' && /Not measured: \d+ words/.test(s.summaryText || '')));

    // 4. "not now" is respected
    c = await startChatCall({ patientId: p._id, channel: 'text' });
    r = await handleTurn({ sessionId: c.sessionId, transcript: 'Not now, I am busy.' });
    check('"Not now, I am busy." → "All right. We\'ll talk another time." and the call ends', /another time/.test(spoken(r.actions)) && r.actions.some((a) => a.type === 'hangup'), spoken(r.actions));

    // 5. a red flag still wins
    c = await startChatCall({ patientId: p._id, channel: 'text' });
    r = await handleTurn({ sessionId: c.sessionId, transcript: 'I fell down in the kitchen this morning.' });
    check('a red flag during the chat → emergency reply, family alerted', r.emergency === 'fall' && /calling your family/.test(spoken(r.actions)));

    // 6. concerns she mentions go to the Planner
    c = await startChatCall({ patientId: p._id, channel: 'text' });
    await handleTurn({ sessionId: c.sessionId, transcript: `${PART1} My knee is hurting a lot these days.` });
    await handleTurn({ sessionId: c.sessionId, transcript: `${PART2} ${PART3}` });
    await sleep(800);
    check('a concern in the chat ("My knee is hurting…") becomes a follow-up for the next call', (await FollowUp.countDocuments({ patient: p._id, concern: 'knee' })) === 1);

    // 7. the phone: Twilio fetches /voice/agent/chat → the question in a speech Gather with longer pauses
    const xml = await (await fetch(`${base}/api/v1/voice/agent/chat?patientId=${p._id}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'CallSid=CA-chat' })).text();
    check('phone: the chat question in a speech Gather, waiting out 3-second pauses', /morning tea/.test(xml) && /speechTimeout="3"/.test(xml) && /<Gather/.test(xml), xml.slice(0, 200));

    // 8. the weekly review compares chats week on week (the paper's measures)
    const DAY = 864e5; const now = Date.now();
    const chatObs = async (daysAgo, mtld, cttr) => {
      const runId = new mongoose.Types.ObjectId();
      await Observation.insertMany(Object.entries({ mtld, cttr, hdd: 0.8, brunetW: 10, wordCount: 70 }).map(([metric, value]) => ({ patient: q._id, callId: runId, callType: 'chat', source: 'code', metric, value, timeOfDay: 'morning', timestamp: new Date(now - daysAgo * DAY) })));
    };
    for (const d of [40, 33, 26, 19]) await chatObs(d, 80, 4.5);
    await chatObs(12, 55, 3.6); await chatObs(5, 50, 3.5);
    const { generateWeeklyReview } = require('../services/weeklyReviewService');
    const rv = await generateWeeklyReview(q._id, new Date(), { useModel: false });
    const f = rv.findings.find((x) => x.timeBlock === 'chat' && x.metric === 'mtld');
    check('weekly review: "In the weekly chat Lata used a narrower range of words (MTLD) for 2 weeks (55 and 50; usually 80)", checked with the family before flagging',
      f && f.status === 'checking_with_caregiver' && /In the weekly chat Lata used a narrower range of words \(MTLD\) for 2 weeks/.test(f.observedChange), f && f.observedChange);
  } catch (err) {
    check('check ran without crashing', false, err.stack);
  } finally {
    if (server) server.close();
    await sleep(800);
    for (const Mod of [Observation, WeeklyReview, AgentQuestion, FollowUp, CaregiverAlert, CaregiverAccess, AgentRun]) await Mod.deleteMany({ patient: { $in: made.patients } });
    await Patient.deleteMany({ _id: { $in: made.patients } });
    await User.deleteMany({ _id: { $in: made.users } });
    await mongoose.disconnect();
    const passed = results.filter(Boolean).length;
    console.log(`\n${passed}/${results.length} passed (test data deleted)`);
    process.exit(passed === results.length ? 0 : 1);
  }
})();
