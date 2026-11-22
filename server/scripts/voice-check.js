// Live check of the browser voice call (A3.1): the whole chain, with a scripted patient.
//   WebRTC → Silero VAD → Whisper → POST /agent/turn → dose flow → Kokoro → WebRTC
// Starts the agent API in-process and the voice server (voice/bot.py) as a child process, on your
// dev database. voice/check_client.py plays the patient: it connects over WebRTC like a browser and
// speaks its lines (a different Kokoro voice), each after the agent has finished talking.
// Twilio is off. Creates test data and deletes it afterwards.
// Run from server/:  npm run voice:check      (WHISPER_MODEL=base for a faster run)

require('dotenv').config({ quiet: true });
for (const v of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'RENDER']) delete process.env[v];
process.env.TWILIO_ENABLED = 'false';
if (process.env.NODE_ENV === 'production') process.env.NODE_ENV = 'development';
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'voice-check-local-secret'; // only for this script

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

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
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

const VOICE_DIR = path.join(__dirname, '..', '..', 'voice');
const PYTHON = path.join(VOICE_DIR, '.venv', 'Scripts', 'python.exe');
const VOICE_PORT = 7861;
const TAG = `voice-check-${Date.now()}`;
const LINES = ["Okay, I'm taking it now.", 'Yes, I have taken it.', 'The small white Amlodipine.'];

const results = [];
const check = (name, passed, detail = '') => {
  results.push(!!passed);
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  return false;
}

// Runs the scripted patient; resolves with its JSON events.
function runPatient(requestData, lines = LINES, env = {}) {
  return new Promise((resolve) => {
    const events = [];
    const child = spawn(PYTHON, ['-I', 'check_client.py', `http://127.0.0.1:${VOICE_PORT}`, JSON.stringify(requestData), ...lines], { cwd: VOICE_DIR, env: { ...process.env, ...env } });
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d.toString();
      const parts = buf.split(/\r?\n/);
      buf = parts.pop();
      for (const p of parts) if (p.startsWith('{')) { const e = JSON.parse(p); events.push(e); console.log(`   ${JSON.stringify(e)}`); }
    });
    child.stderr.on('data', () => {});
    child.on('close', () => resolve(events));
  });
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log(`Connected to ${mongoose.connection.name} (Twilio off)\n`);
  const made = { users: [], patients: [], medicines: [] };
  let voice;
  let server;
  const voiceLog = path.join(require('os').tmpdir(), `medtime-voice-check-${Date.now()}.log`);

  try {
    let n = 0;
    const mkUser = async (name, role) => {
      const u = await User.create({ name, phone: `+9197${String(Date.now()).slice(-6)}${n++}`, passwordHash: 'x', role });
      made.users.push(u._id);
      return u;
    };
    const kamala = await mkUser(`Kamala ${TAG}`, 'patient');
    const priya = await mkUser(`Priya ${TAG}`, 'caregiver');
    const patient = await Patient.create({ user: kamala._id, emergencyContact: '+910000000006', dementiaMode: true });
    made.patients.push(patient._id);
    await CaregiverAccess.create({ patient: patient._id, user: priya._id, role: 'primary', status: 'active' });
    const med = await Medicine.create({
      patient: patient._id, name: 'Amlodipine', dosage: '5mg', type: 'tablet', frequency: 'once', scheduledTimes: ['20:00'],
      mealTiming: 'after', startDate: new Date(), notificationType: 'call', pillDescription: 'small white round', locationHint: 'on the kitchen table',
    });
    made.medicines.push(med._id);

    // the agent API, in-process
    const app = express();
    app.use(express.json());
    app.use('/api/v1/simulate', require('../routes/simulateRoutes'));
    app.use('/api/v1/agent', require('../routes/agentRoutes'));
    server = app.listen(0);
    const apiBase = `http://127.0.0.1:${server.address().port}/api/v1`;

    // the voice server
    const t0 = Date.now();
    voice = spawn(PYTHON, ['-I', 'bot.py'], {
      cwd: VOICE_DIR,
      env: { ...process.env, AGENT_API_BASE: apiBase, VOICE_PORT: String(VOICE_PORT), WHISPER_MODEL: process.env.WHISPER_MODEL || 'base' },
    });
    const log = fs.createWriteStream(voiceLog);
    voice.stdout.pipe(log);
    voice.stderr.pipe(log);
    const up = await waitForHealth(`http://127.0.0.1:${VOICE_PORT}/health`, 60000);
    check('voice server starts', up, `${((Date.now() - t0) / 1000).toFixed(1)} s; log: ${voiceLog}`);
    if (!up) throw new Error('voice server did not start');

    // the page: list the doses, then have the voice server prepare that call's lines
    const token = jwt.sign({ id: priya._id, role: 'caregiver' }, process.env.JWT_SECRET, { expiresIn: '10m' });
    const doses = await (await fetch(`${apiBase}/simulate/doses?patient=${patient._id}`, { headers: { Authorization: `Bearer ${token}` } })).json();
    const callLineTexts = doses.medicines[0].lines;
    const tp = Date.now();
    let prep;
    do {
      prep = await (await fetch(`http://127.0.0.1:${VOICE_PORT}/api/prepare`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines: callLineTexts }) })).json();
      if (prep.preparing) await sleep(2000);
    } while (prep.preparing && Date.now() - tp < 240000);
    check("the call's lines are prepared before the call", !prep.preparing && prep.cached === prep.total, `${prep.cached}/${prep.total} lines in ${((Date.now() - tp) / 1000).toFixed(1)} s`);

    // start a voice dose call as the caregiver would from the browser
    const res = await fetch(`${apiBase}/simulate/call`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ medicineId: String(med._id), channel: 'voice' }),
    });
    const call = await res.json();
    check('voice call started from a medicine (a new dose is created for now)', res.status === 201 && call.callId && call.hints.includes('Amlodipine'), `hints: ${JSON.stringify(call.hints)}`);

    console.log('\n   scripted patient on the line:');
    const events = await runPatient({ callId: call.callId, actions: call.actions, hints: call.hints, lines: call.lines });
    await sleep(1500);

    const agentAudio = events.filter((e) => e.event === 'agent_audio');
    const said = events.filter((e) => e.event === 'said');
    check('the agent greets her in its voice (greeting audio received)', agentAudio.length >= 1 && agentAudio[0].start < 30, agentAudio[0] && `first audio at ${agentAudio[0].start} s after connecting`);
    const gaps = said.map((s) => {
      const reply = agentAudio.find((a) => a.start > s.end);
      return reply ? +(reply.start - s.end).toFixed(2) : null;
    });
    check('every line she says gets a spoken reply', said.length === LINES.length && gaps.every((g) => g !== null), `seconds from end of her speech to the agent's voice: ${gaps.join(', ')}`);
    check('reply time within the 4 s turn budget (+0.6 s end-of-speech pause)', gaps.length && gaps.every((g) => g !== null && g <= 4.6), gaps.join(', '));

    const run = await AgentRun.findById(call.runId).lean();
    const heard = (run ? run.steps : []).filter((s) => s.tool === 'patient_said').map((s) => s.input.text);
    const lines = (run ? run.steps : []).filter((s) => s.tool === 'agent_said').flatMap((s) => s.input.lines || []);
    console.log(`   Whisper heard: ${JSON.stringify(heard)}`);
    console.log(`   Agent said: ${lines.join(' → ')}`);
    check('Whisper heard her three lines', heard.length === 3 && /taking/i.test(heard[0] || '') && /taken/i.test(heard[1] || '') && /white|amlodipine/i.test(heard[2] || ''), JSON.stringify(heard));
    check('the dose flow ran over voice: wait → check question → praise', lines.join(',') === 'dose.greet.calm,dose.take_your_time,dose.check_question,dose.praise', lines.join(', '));
    const dose = await Reminder.findOne({ medicine: med._id }).lean();
    check('dose recorded as taken by the agent, after the check question', dose && dose.status === 'taken' && dose.confirmedBy === 'agent');

    // ── barge-in: she starts talking 2 s into the 9 s greeting ──
    const res2 = await fetch(`${apiBase}/simulate/call`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ medicineId: String(med._id), channel: 'voice' }),
    });
    const call2 = await res2.json();
    console.log('\n   barge-in call:');
    const ev2 = await runPatient({ callId: call2.callId, actions: call2.actions, hints: call2.hints, lines: call2.lines }, ["Okay, I'm taking it now."], { BARGE_AFTER_S: '2' });
    const greet2 = ev2.find((e) => e.event === 'agent_audio');
    const said2 = ev2.find((e) => e.event === 'said');
    const stopAfter = greet2 && said2 ? +(greet2.end - said2.start).toFixed(2) : null;
    check('barge-in: the agent stops talking as soon as she speaks (within 1 s)', stopAfter !== null && stopAfter <= 1.0,
      stopAfter === null ? 'no data' : `greeting stopped ${stopAfter} s after she started (it would have run ~7 s more)`);
    const run2 = await AgentRun.findById(call2.runId).lean();
    const heard2 = (run2 ? run2.steps : []).filter((st) => st.tool === 'patient_said').map((st) => st.input.text);
    check('barge-in: what she said while interrupting was heard and answered', /taking/i.test(heard2[0] || '') && ev2.filter((e) => e.event === 'agent_audio').length >= 2, JSON.stringify(heard2));
  } catch (err) {
    check('check ran without crashing', false, err.stack);
  } finally {
    if (voice) voice.kill();
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
