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
    // Groq's free plan allows 8,000 input tokens a minute and one call uses ~7,000, so calls are
    // spaced a minute apart. Set CHECK_PACE_MS=0 on a paid plan or with Claude.
    const PACE_MS = Number(process.env.CHECK_PACE_MS ?? 62000);
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
      if (run) console.log(`   Activity: ${run.steps.map((s) => s.tool).join(' → ')}  [${run.outcome}${run.fallbackReason ? `/${run.fallbackReason}` : ''}${run.error && run.error.message ? ` (${run.error.message})` : ''}, ${run.llmCalls} model calls, ${run.usage.inputTokens} tokens in]`);
      return { start: start.body, last, run, callId: start.body.callId };
    }

    // 1. the happy path: not taken → reminded → takes it → check question → recorded
    const d1 = await newDose();
    const c1 = await playCall('Call 1: she takes it', d1, ['Okay, I am taking it now.', 'Yes, I have taken it.', 'The Amlodipine, the white one.', 'Yes.']);
    const r1 = await Reminder.findById(d1._id).lean();
    check('call 1: dose recorded as taken by the agent', r1.status === 'taken' && r1.confirmedBy === 'agent');
    check('call 1: agent ended the call', c1.last.ended && c1.last.actions.some((a) => a.type === 'hangup'));
    check('call 1: run finished, shows the whole conversation (Phase 1 gate)',
      c1.run && c1.run.status === 'finished' && c1.run.outcome === 'done' && c1.run.steps.some((s) => s.tool === 'patient_said') &&
        c1.run.steps.some((s) => s.tool === 'agent_said') && c1.run.steps.some((s) => s.tool === 'mark_dose') && c1.run.trigger === 'simulate');

    // 2. already taken in the app → tells her not to take another, no new record
    const d2 = await newDose('taken');
    const c2 = await playCall('Call 2: already taken', d2, ['Should I take one now?']);
    const changed2 = c2.run && c2.run.steps.some((s) => s.tool === 'mark_dose' && s.output && s.output.data && s.output.data.changed);
    check('call 2: no second dose recorded, call ended', !changed2 && c2.last.ended && (await Reminder.findById(d2._id).lean()).confirmedBy === 'app');

    // 3. "I already took it" but nothing recorded → don't take another, caregiver called, not recorded
    const d3 = await newDose();
    const c3 = await playCall('Call 3: says she took it, nothing recorded', d3, ['I already took it this morning, I think.', 'I am sure I took it.']);
    const r3 = await Reminder.findById(d3._id).lean();
    const alerts3 = await CaregiverAlert.find({ patient: patient._id, reason: 'unsure_dose' }).lean();
    check('call 3: not recorded as taken (her word alone is not proof)', r3.status !== 'taken');
    check('call 3: caregiver asked to check', alerts3.length >= 1, alerts3[0] && alerts3[0].message);

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

    // 5. access and input checks
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
