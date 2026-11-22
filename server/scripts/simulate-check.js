// Live check of A2.7 and the Phase 1 gate: a simulated dose call runs from start to finish in text
// mode, and every step shows through the Activity panel endpoint (GET /agent/runs/:id).
// Uses your dev database and real Groq; Twilio forced into simulation mode. Prints each call's
// transcript. Creates test data and deletes it afterwards.
// Run from server/:  npm run simulate:check   (roughly 15 to 25 Groq requests)

require('dotenv').config({ quiet: true });
for (const v of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN']) delete process.env[v];
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'simulate-check-local-secret'; // only for this script

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
const CaregiverAccess = require('../models/CaregiverAccess');
const AgentQuestion = require('../models/AgentQuestion');
const User = require('../models/User');
const Patient = require('../models/Patient');
const Medicine = require('../models/Medicine');
const Reminder = require('../models/Reminder');
const AgentRun = require('../models/AgentRun');
const CaregiverAlert = require('../models/CaregiverAlert');
const { initAgent } = require('../agent');

initAgent();

const TAG = `simulate-check-${Date.now()}`;
const results = [];
const check = (name, passed, detail = '') => {
  results.push(!!passed);
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log(`Connected to ${mongoose.connection.name} (Twilio in simulation mode)\n`);
  const made = { users: [], patients: [], medicines: [] };
  let server;

  try {
    // ── test data ──
    let n = 0;
    const mkUser = async (name, role) => {
      const u = await User.create({ name, phone: `+9197${String(Date.now()).slice(-6)}${n++}`, passwordHash: 'x', role });
      made.users.push(u._id);
      return u;
    };
    const amma = await mkUser('Kamala Devi', 'patient');
    const priya = await mkUser(`Priya ${TAG}`, 'caregiver');
    const stranger = await mkUser(`Stranger ${TAG}`, 'caregiver');
    const patient = await Patient.create({ user: amma._id, emergencyContact: '+910000000004', dementiaMode: true, caregivers: [{ user: priya._id, role: 'primary' }] });
    // Access comes from Person B's CaregiverAccess (C3); the old caregivers list alone isn't enough.
    await CaregiverAccess.create({ patient: patient._id, user: priya._id, role: 'primary', status: 'active' });
    made.patients.push(patient._id);
    const med = await Medicine.create({
      patient: patient._id, name: 'Amlodipine', dosage: '5mg', type: 'tablet', frequency: 'once',
      scheduledTimes: ['08:00'], mealTiming: 'after', startDate: new Date(), notificationType: 'call',
      pillDescription: 'small white round', locationHint: 'on the kitchen table', // C10 (Person B)
    });
    made.medicines.push(med._id);
    const newDose = (status = 'pending') => Reminder.create({ medicine: med._id, patient: patient._id, scheduledTime: new Date(), status, ...(status === 'taken' ? { confirmedBy: 'app', confirmedAt: new Date() } : {}) });

    // ── server ──
    const app = express();
    app.use(express.json());
    app.use('/api/v1/simulate', require('../routes/simulateRoutes'));
    app.use('/api/v1/agent', require('../routes/agentRoutes'));
    server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}/api/v1`;
    const auth = (u) => ({ Authorization: `Bearer ${jwt.sign({ id: u._id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}`, 'Content-Type': 'application/json' });
    const post = async (path, body, user = priya) => {
      const res = await fetch(`${base}${path}`, { method: 'POST', headers: auth(user), body: JSON.stringify(body) });
      return { status: res.status, body: await res.json() };
    };
    const getRun = async (runId) => (await fetch(`${base}/agent/runs/${runId}`, { headers: auth(priya) })).json();
    const spoken = (actions) => actions.filter((a) => a.type === 'neutral' || a.type === 'play').map((a) => a.text || a.lineId).join(' ');

    // Plays a call: the patient's lines are used in order, the last one repeated if the agent asks more.
    // Groq's free plan allows 8,000 input tokens a minute. Since A4.1 the model only labels each
    // turn (~500 tokens), so a short gap is enough. Set CHECK_PACE_MS=0 on a paid plan or with Claude.
    const PACE_MS = Number(process.env.CHECK_PACE_MS ?? 15000);
    let calls = 0;
    async function playCall(label, reminder, lines) {
      if (calls++ > 0 && PACE_MS > 0) {
        console.log(`\n   (waiting ${Math.round(PACE_MS / 1000)} s for Groq's free-plan token limit to reset)`);
        await sleep(PACE_MS);
      }
      console.log(`\n── ${label} ──`);
      const start = await post('/simulate/call', { reminderId: String(reminder._id) });
      if (start.status !== 201) throw new Error(`start failed ${start.status}: ${JSON.stringify(start.body)}`);
      console.log(`   Agent:   ${spoken(start.body.actions)}`);
      let last = start.body;
      for (let i = 0; !last.ended && i < 7; i++) {
        const line = lines[Math.min(i, lines.length - 1)];
        console.log(`   Patient: ${line}`);
        const r = await post(`/simulate/call/${start.body.callId}/say`, { text: line });
        if (r.status !== 200) throw new Error(`say failed ${r.status}: ${JSON.stringify(r.body)}`);
        last = r.body;
        console.log(`   Agent:   ${spoken(last.actions)}${last.emergency ? `   [EMERGENCY: ${last.emergency}]` : ''}`);
        if (last.emergency) break;
      }
      console.log(`   → ${last.ended ? `call ended (${last.actions.map((a) => a.type).join(', ')})` : 'call still open'}`);
      await sleep(300);
      const { run } = await getRun(start.body.runId);
      if (run) console.log(`   Activity: ${run.steps.map((s) => (s.tool === 'understand' && s.output ? `understand[${s.output.intent}/${s.output.source}${s.output.fallbackReason ? `: ${String(s.output.fallbackReason).slice(0, 80)}` : ''}]` : s.tool)).join(' → ')}  [${run.outcome}${run.fallbackReason ? `/${run.fallbackReason}` : ''}${run.error && run.error.message ? ` (${run.error.message})` : ''}, ${run.llmCalls} model calls, ${run.usage.inputTokens} tokens in]`);
      return { start: start.body, last, run, callId: start.body.callId };
    }

    // 1. the happy path: not taken → reminded → takes it → check question → recorded
    const d1 = await newDose();
    const c1 = await playCall('Call 1: she takes it', d1, ['Okay, I am taking it now.', 'Yes, I have taken it.', 'The Amlodipine, the white one.', 'Yes.']);
    const r1 = await Reminder.findById(d1._id).lean();
    check('call 1: dose recorded as taken by the agent', r1.status === 'taken' && r1.confirmedBy === 'agent');
    check('call 1: agent ended the call', c1.last.ended && c1.last.actions.some((a) => a.type === 'hangup'));
    // "I am taking it now" must not record the dose; it is recorded only after the check question.
    const said1 = c1.run ? c1.run.steps.map((st) => (st.tool === 'agent_said' ? (st.input.lines || []).join('+') : st.tool)) : [];
    const markAt = said1.indexOf('mark_dose');
    const checkAt = said1.findIndex((x) => /dose\.check_question/.test(x));
    check('call 1: "taking it now" not recorded; recorded only after the check question (A4.1)', checkAt > -1 && markAt > checkAt, said1.join(' → '));
    check('call 1: every reply is a fixed line (play + lineId), never free model text',
      [c1.start.actions, c1.last.actions].flat().filter((a) => a.type !== 'listen' && a.type !== 'hangup').every((a) => a.type === 'play' && /^dose\./.test(a.lineId)));
    check('call 1: run finished, shows the whole conversation (Phase 1 gate)',
      c1.run && c1.run.status === 'finished' && c1.run.outcome === 'done' && c1.run.steps.some((s) => s.tool === 'patient_said') &&
        c1.run.steps.some((s) => s.tool === 'agent_said') && c1.run.steps.some((s) => s.tool === 'mark_dose') && c1.run.trigger === 'simulate');

    // The scheduler must not place its own call for a dose that is being called in the simulator
    // (on Render that would ring the patient's real phone).
    const d1b = await newDose();
    await post('/simulate/call', { reminderId: String(d1b._id) });
    const { runTick, task } = require('../jobs/missedDoseCron');
    task.stop();
    const quietLog = console.log; console.log = () => {};
    try { await runTick(new Date()); } finally { console.log = quietLog; }
    const cronRuns = await AgentRun.countDocuments({ patient: patient._id, trigger: 'dose_due' });
    check('a dose being called in the simulator is not also called by the scheduler', cronRuns === 0 && (await Reminder.findById(d1b._id).lean()).attempts === 1, `${cronRuns} scheduler run(s)`);

    // 2. already taken in the app → tells her not to take another, no new record
    const d2 = await newDose('taken');
    const c2 = await playCall('Call 2: already taken', d2, ['Should I take one now?']);
    const changed2 = c2.run && c2.run.steps.some((s) => s.tool === 'mark_dose' && s.output && s.output.data && s.output.data.changed);
    check('call 2: no second dose recorded, call ended', !changed2 && c2.last.ended && (await Reminder.findById(d2._id).lean()).confirmedBy === 'app');
    check('call 2: told not to take another one', /don't take another one/.test(spoken(c2.start.actions)), spoken(c2.start.actions));

    // 3. "I already took it" but nothing recorded → don't take another, caregiver called, not recorded
    const d3 = await newDose();
    const c3 = await playCall('Call 3: says she took it, nothing recorded', d3, ['I already took it this morning, I think.', 'I am sure I took it.']);
    const r3 = await Reminder.findById(d3._id).lean();
    const alerts3 = await CaregiverAlert.find({ patient: patient._id, reason: 'unsure_dose' }).lean();
    check('call 3: not recorded as taken (her word alone is not proof)', r3.status !== 'taken');
    check('call 3: caregiver asked to check', alerts3.length >= 1, alerts3[0] && alerts3[0].message);
    const q3 = await AgentQuestion.find({ patient: patient._id }).lean();
    check('call 3: told not to take another; question on the caregiver dashboard; no "missed" call later',
      /don't take another one/i.test(spoken(c3.last.actions)) && q3.length === 1 && r3.caregiverNotified && !r3.caregiverAlertTime, q3[0] && q3[0].question);

    // 4. red flag mid-call → neutral emergency reply, caregiver called, agent skipped
    const d4 = await newDose();
    const c4 = await playCall('Call 4: red flag', d4, ['Wait, I fell down in the kitchen.']);
    await sleep(1000);
    const red = await CaregiverAlert.find({ patient: patient._id, reason: 'red_flag' }).lean();
    // red counts red-flag alerts across ALL four calls: more than 1 means the safety screen
    // (keywords, or its LLM check on final transcripts) flagged an ordinary sentence earlier.
    const flaggedSteps = (await AgentRun.find({ patient: patient._id }).lean())
      .flatMap((r) => r.steps.filter((s) => s.tool === 'safety_screen').map((s) => `${(s.input && s.input.transcript) || '?'} → ${s.output && s.output.category}`));
    check('call 4: red flag handled before the agent, caregiver called', c4.last.emergency === 'fall' && red.length === 1 && c4.run.steps.some((s) => s.tool === 'safety_screen'),
      `emergency=${c4.last.emergency}, ${red.length} red-flag alert(s); flagged: ${flaggedSteps.join(' | ') || '(none)'}`);

    // 5. can't find it → location hint → still can't → hand-over (A4.1)
    const d5 = await newDose();
    const c5 = await playCall("Call 5: can't find it", d5, ["I can't find my tablets.", 'I still cannot find them.']);
    const r5 = await Reminder.findById(d5._id).lean();
    const lines5 = c5.run ? c5.run.steps.filter((st) => st.tool === 'agent_said').flatMap((st) => st.input.lines || []) : [];
    check("call 5: can't find → hint with where the pills are, then hand-over; not recorded",
      lines5.includes('dose.hint_location') && lines5.includes('dose.handover') && r5.status !== 'taken' && c5.last.ended
        && (await CaregiverAlert.countDocuments({ patient: patient._id, reason: 'handover' })) >= 1, lines5.join(' → '));

    // 6. wrong pill at the check question → hint → wrong again → hand-over, not recorded (A4.1)
    const d6 = await newDose();
    const c6 = await playCall('Call 6: wrong pill', d6, ['Yes, I took it.', 'The big yellow one.', 'The big yellow one, I said.']);
    const r6 = await Reminder.findById(d6._id).lean();
    const lines6 = c6.run ? c6.run.steps.filter((st) => st.tool === 'agent_said').flatMap((st) => st.input.lines || []) : [];
    check("call 6: wrong pill → hint, then 'don't take any more', caregiver called; not recorded",
      lines6.includes('dose.check_hint') && lines6.includes('dose.handover_unsure') && r6.status !== 'taken', lines6.join(' → '));

    // 7. "later" → snoozed, she is called again in 10 minutes (A4.1)
    const d7 = await newDose();
    const c7 = await playCall('Call 7: later', d7, ['Not now, I will take it after lunch.']);
    const r7 = await Reminder.findById(d7._id).lean();
    check('call 7: later → snoozed for a re-call, not recorded', c7.last.ended && !!r7.snoozeUntil && r7.status !== 'taken' && r7.status !== 'skipped');

    // 8. refuses → recorded as skipped, family told (A4.1)
    const d8 = await newDose();
    const c8 = await playCall('Call 8: refuses', d8, ["I don't want to take it today."]);
    const r8 = await Reminder.findById(d8._id).lean();
    check('call 8: refuses → recorded as skipped, no pressure, family told', c8.last.ended && r8.status === 'skipped' && r8.confirmedBy === 'agent');

    // 9. access and input checks
    check('stranger cannot start a call on this patient', (await post('/simulate/call', { reminderId: String(d1._id) }, stranger)).status === 404);
    check('stranger cannot speak into the call', (await post(`/simulate/call/${c4.callId}/say`, { text: 'hi' }, stranger)).status === 404);
    check('bad input is rejected', (await post('/simulate/call', { reminderId: 'nope' })).status === 400 && (await post(`/simulate/call/${c4.callId}/say`, {})).status === 400);
    const again = await post(`/simulate/call/${c1.callId}/say`, { text: 'hello?' });
    check('an ended call refuses more turns', again.status === 409 || again.status === 404, `status ${again.status} ${JSON.stringify(again.body).slice(0, 120)}`);
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
