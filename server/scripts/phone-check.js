// Live check of the Twilio phone adapter (A3.5) with Twilio's side played by this script: it posts
// what Twilio posts (SpeechResult, Digits, CallSid, CallStatus) and reads the TwiML back.
// Gate (A3.5): a real phone call runs the same agent as the browser and the eval: speech turns,
// the check question before recording, keypad keys, silence, red flags, Hindi speech settings,
// the call-in by phone, and the run closed when she hangs up. Plus: the scheduler's call for a
// dementia-mode patient goes to the agent URL with a status callback.
// Uses your dev database; Twilio off (signature check skipped locally); deletes its test data.
// Run from server/:  npm run phone:check

require('dotenv').config({ quiet: true });
for (const v of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'RENDER']) delete process.env[v];
process.env.TWILIO_ENABLED = 'false';
process.env.PUBLIC_BASE_URL = 'https://medtime.example.test';
process.env.LLM_PROVIDER = 'none';
process.env.VOICE_IDLE_MS = '3000'; // a silent line counts as hung up after 3 s here (2 min live) // the rules understand her: no Groq tokens, same decisions
if (process.env.NODE_ENV === 'production') process.env.NODE_ENV = 'development';

const dbName = (() => { try { return new URL(process.env.MONGO_URI).pathname.replace(/^\//, ''); } catch { return ''; } })();
if (!dbName || !/dev|test/i.test(dbName)) {
  console.error(`Refusing to run: MONGO_URI database is "${dbName || '(none)'}". Use a dev database such as medtime_dev_a.`);
  process.exit(1);
}

const mongoose = require('mongoose');
const express = require('express');
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
const { toTwiml } = require('../routes/voiceAgentRoutes');

const TAG = `phone-check-${Date.now()}`;
const results = [];
const check = (name, passed, detail = '') => {
  results.push(!!passed);
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${String(detail).slice(0, 220)})` : ''}`);
};
const sidOf = (xml) => { const m = /turn\?sid=([0-9a-f-]+)/.exec(xml); return m ? m[1] : null; };
const said = (xml) => [...xml.matchAll(/<Say[^>]*>([^<]*)<\/Say>/g)].map((m) => m[1]).join(' ');

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log(`Connected to ${mongoose.connection.name} (Twilio off, no model)\n`);
  const made = { users: [], patients: [], medicines: [] };
  let server;
  try {
    const n = String(Date.now()).slice(-7);
    const mkPatient = async (name, language, phone) => {
      const u = await User.create({ name: `${name} ${TAG}`, phone, passwordHash: 'x', role: 'patient' });
      made.users.push(u._id);
      const p = await Patient.create({ user: u._id, emergencyContact: '+910000000021', dementiaMode: true, language });
      made.patients.push(p._id);
      const cg = await User.create({ name: `Priya ${TAG}`, phone: `+9198${n}${made.users.length}`, passwordHash: 'x', role: 'caregiver' });
      made.users.push(cg._id);
      await CaregiverAccess.create({ patient: p._id, user: cg._id, role: 'primary', status: 'active', approvedAt: new Date() });
      return p;
    };
    const mkDose = async (patient, name = 'Amlodipine') => {
      const med = await Medicine.create({ patient: patient._id, name, dosage: '5mg', type: 'tablet', frequency: 'once', scheduledTimes: ['08:00'], pillDescription: 'small white round tablet', startDate: new Date(Date.now() - 86400000), notificationType: 'call' });
      made.medicines.push(med._id);
      return Reminder.create({ medicine: med._id, patient: patient._id, scheduledTime: new Date(Date.now() - 2 * 60000), status: 'alerted', attempts: 1 });
    };
    const kamala = await mkPatient('Kamala', 'en', `9${n}01`.slice(0, 10));
    const sita = await mkPatient('Sita', 'hi', `+9187${n}2`);

    const app = express();
    app.use(express.urlencoded({ extended: false }));
    app.use(express.json());
    app.use('/api/v1/voice/agent', require('../routes/voiceAgentRoutes'));
    app.use('/api/v1/voice', require('../routes/voiceIncoming'));
    app.use('/api/v1/users', require('../routes/userRoutes'));
    app.use('/api/v1/medicines', require('../routes/medicineRoutes'));
    server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const twilio = async (path, form = {}) => {
      const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
      return { status: r.status, xml: await r.text() };
    };

    // 1. the dose call: opening, speech turns, check question, recorded, hang up
    const d1 = await mkDose(kamala);
    let r = await twilio(`/api/v1/voice/agent/dose?reminderId=${d1._id}`, { CallSid: 'CA-test-1' });
    const sid = sidOf(r.xml);
    check('she picks up: the reminder line inside a speech+keypad Gather, en-IN, hint words, silence still posts',
      r.status === 200 && /<Gather input="speech dtmf" numDigits="1" method="POST" actionOnEmptyResult="true"/.test(r.xml) && /language="en-IN"/.test(r.xml) && /speechTimeout="auto"/.test(r.xml)
      && /hints="Amlodipine, Kamala"/.test(r.xml) && /It&apos;s time for your \w+ medicine, Amlodipine/.test(r.xml) && /action="https:\/\/medtime\.example\.test\/api\/v1\/voice\/agent\/turn\?sid=/.test(r.xml) && !!sid, r.xml);
    r = await twilio(`/api/v1/voice/agent/turn?sid=${sid}`, { SpeechResult: 'Yes, I took it.', Confidence: '0.91', CallSid: 'CA-test-1' });
    check('"Yes, I took it." → the check question; nothing recorded yet', /Which tablet did you take\?/.test(said(r.xml)) && /<Gather/.test(r.xml) && (await Reminder.findById(d1._id).lean()).status !== 'taken', said(r.xml));
    r = await twilio(`/api/v1/voice/agent/turn?sid=${sid}`, { SpeechResult: 'The small white round one.', Confidence: '0.88', CallSid: 'CA-test-1' });
    const d1After = await Reminder.findById(d1._id).lean();
    check('the right pill → "That\'s right. Well done", <Hangup/>, dose taken by the agent', /That&apos;s right\. Well done/.test(r.xml) && /<Hangup\/>/.test(r.xml) && d1After.status === 'taken' && d1After.confirmedBy === 'agent', said(r.xml));
    const run1 = await AgentRun.findOne({ patient: kamala._id, reminder: d1._id, trigger: 'phone_call' }).sort({ createdAt: -1 }).lean();
    check('one AgentRun for the call (trigger phone_call), finished, with her words as steps', run1 && run1.status !== 'running' && run1.steps.some((s) => s.tool === 'patient_said' && /small white/.test(s.input.text)));

    // 2. silence twice → hand over to the caregiver
    const d2 = await mkDose(kamala, 'Metformin');
    r = await twilio(`/api/v1/voice/agent/dose?reminderId=${d2._id}`, { CallSid: 'CA-test-2' });
    const sid2 = sidOf(r.xml);
    await twilio(`/api/v1/voice/agent/turn?sid=${sid2}`, { SpeechResult: '', CallSid: 'CA-test-2' });
    r = await twilio(`/api/v1/voice/agent/turn?sid=${sid2}`, { SpeechResult: '', CallSid: 'CA-test-2' });
    await new Promise((x) => setTimeout(x, 500));
    check('no answer twice (actionOnEmptyResult) → "will call you soon", <Hangup/>, caregiver phoned, dose not recorded',
      /will call you soon/.test(said(r.xml)) && /<Hangup\/>/.test(r.xml) && (await CaregiverAlert.countDocuments({ patient: kamala._id })) >= 1 && (await Reminder.findById(d2._id).lean()).status !== 'taken', said(r.xml));

    // 3. keypad 9 → emergency, stays on the line; hang-up closes the run
    const d3 = await mkDose(kamala, 'Losartan');
    r = await twilio(`/api/v1/voice/agent/dose?reminderId=${d3._id}`, { CallSid: 'CA-test-3' });
    const sid3 = sidOf(r.xml);
    r = await twilio(`/api/v1/voice/agent/turn?sid=${sid3}`, { Digits: '9', CallSid: 'CA-test-3' });
    check('key 9 → "I\'m calling your family right now", still listening (no hang-up)', /calling your family right now/.test(said(r.xml)) && /<Gather/.test(r.xml) && !/<Hangup/.test(r.xml), said(r.xml));
    const st = await twilio('/api/v1/voice/agent/status', { CallSid: 'CA-test-3', CallStatus: 'completed' });
    await new Promise((x) => setTimeout(x, 300));
    const run3 = await AgentRun.findOne({ patient: kamala._id, reminder: d3._id }).sort({ createdAt: -1 }).lean();
    check('she hangs up (status callback) → the run is closed, not left "running"; the session is gone',
      st.status === 204 && run3 && run3.status !== 'running' && run3.outcome === 'red_flag' && /trouble/.test((await twilio(`/api/v1/voice/agent/turn?sid=${sid3}`, { SpeechResult: 'hello' })).xml) === false, `run ${run3 && run3.status}/${run3 && run3.outcome}`);

    // 4. Hindi: Hindi lines, hi-IN with the conversations model
    const d4 = await mkDose(sita);
    r = await twilio(`/api/v1/voice/agent/dose?reminderId=${d4._id}`, { CallSid: 'CA-test-4' });
    check('Hindi patient: Hindi line, <Say language="hi-IN">, Gather hi-IN with speechModel experimental_conversations and speechTimeout 2',
      /नमस्ते Sita जी/.test(r.xml) && /<Say voice="Polly\.Aditi" language="hi-IN">/.test(r.xml) && /language="hi-IN" speechTimeout="2" speechModel="experimental_conversations"/.test(r.xml), r.xml.slice(0, 300));
    r = await twilio(`/api/v1/voice/agent/turn?sid=${sidOf(r.xml)}`, { SpeechResult: 'हाँ, मैंने दवा ले ली।', CallSid: 'CA-test-4' });
    check('Hindi answer understood → the Hindi check question', /आपने कौन सी गोली ली\?/.test(said(r.xml)), said(r.xml));

    // 5. an unknown or ended session gets a polite goodbye, never an error page
    r = await twilio('/api/v1/voice/agent/turn?sid=00000000-0000-0000-0000-000000000000', { SpeechResult: 'hello' });
    check('unknown session → apology and <Hangup/> (valid TwiML)', r.status === 200 && /^<\?xml/.test(r.xml) && /<Hangup\/>/.test(r.xml));

    // 6. TwiML for the other actions
    const wait = toTwiml([{ type: 'neutral', text: 'Let me check that for you.' }, { type: 'wait' }], { sessionId: 'abc', lang: 'en' });
    const fb = toTwiml([{ type: 'fallback', reason: 'crash' }], { sessionId: 'abc', keypadUrl: 'https://medtime.example.test/api/v1/webhooks/voice/prompt?reminderId=1' });
    check('"wait" → hold line + Redirect to collect the slow turn; "fallback" → Redirect to the keypad menu',
      /<Redirect method="POST">https:\/\/medtime\.example\.test\/api\/v1\/voice\/agent\/turn\?sid=abc&amp;collect=1<\/Redirect>/.test(wait) && /<Redirect method="POST">https:\/\/medtime\.example\.test\/api\/v1\/webhooks\/voice\/prompt\?reminderId=1<\/Redirect>/.test(fb), wait);

    // 7. the call-in by phone runs the runtime's call-in flow
    const kUser = await User.findById(kamala.user).lean();
    r = await twilio('/api/v1/voice/incoming', { From: `+91${kUser.phone}`, CallSid: 'CA-test-7' });
    check('she phones in (number stored without +91) → "What would you like to know?" in a Gather', /What would you like to know\?/.test(said(r.xml)) && /<Gather/.test(r.xml), said(r.xml) || r.xml.slice(0, 200));
    r = await twilio(`/api/v1/voice/agent/turn?sid=${sidOf(r.xml)}`, { SpeechResult: 'Did I take my Amlodipine?', CallSid: 'CA-test-7' });
    check('"Did I take my Amlodipine?" → answered from the dose log, "Is there anything else?"', /Yes, you took Amlodipine at/.test(said(r.xml)) && /anything else/i.test(said(r.xml)), said(r.xml));

    // 8. the scheduler's call for a dementia-mode patient uses the agent URL
    const logs = [];
    const realLog = console.log;
    console.log = (...a) => { logs.push(a.join(' ')); };
    const { makePatientCall } = require('../utils/twilioClient');
    await makePatientCall('9000000000', 'Amlodipine', d1.medicine, d1._id, { agent: true });
    await makePatientCall('9000000000', 'Amlodipine', d1.medicine, d1._id);
    console.log = realLog;
    check('scheduler: agent call for dementia mode, keypad menu otherwise', /speech agent/.test(logs[0] || '') && /keypad menu/.test(logs[1] || ''), logs.join(' | '));

    // 9. call settings: she (or her primary caregiver) turns the talking assistant on, picks a language
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'phone-check-local-secret';
    const jwt = require('jsonwebtoken');
    const tok = (id) => ({ Authorization: `Bearer ${jwt.sign({ id: String(id), role: 'patient' }, process.env.JWT_SECRET)}`, 'Content-Type': 'application/json' });
    const api = async (method, path, user, body) => { const x = await fetch(base + path, { method, headers: tok(user), body: body ? JSON.stringify(body) : undefined }); return { status: x.status, body: await x.json() }; };
    let cs = await api('PUT', '/api/v1/users/care-settings', kamala.user, { dementiaMode: false, language: 'hi' });
    const k2 = await Patient.findById(kamala._id).lean();
    check('settings: the patient turns dementia mode off and picks Hindi (saved)', cs.status === 200 && cs.body.dementiaMode === false && cs.body.language === 'hi' && k2.dementiaMode === false && k2.language === 'hi', JSON.stringify(cs.body));
    const link = await CaregiverAccess.findOne({ patient: kamala._id }).lean();
    cs = await api('PUT', '/api/v1/users/care-settings', link.user, { patientId: String(kamala._id), dementiaMode: true });
    const stranger = await api('PUT', '/api/v1/users/care-settings', sita.user, { patientId: String(kamala._id), dementiaMode: false });
    const bad = await api('PUT', '/api/v1/users/care-settings', kamala.user, { language: 'fr' });
    const ec1 = await api('PUT', '/api/v1/users/care-settings', kamala.user, { emergencyContact: '98765 43210' });
    const ec2 = await api('PUT', '/api/v1/users/care-settings', kamala.user, { emergencyContact: '12345' });
    check('settings: emergency contact saved (spaces removed); a bad number refused (400)', ec1.status === 200 && ec1.body.emergencyContact === '9876543210' && ec2.status === 400, `${ec1.status} ${ec1.body.emergencyContact} / ${ec2.status}`);
    check('settings: the primary caregiver can turn it on; another patient cannot (403); unknown language refused (400)',
      cs.status === 200 && cs.body.dementiaMode === true && stranger.status === 403 && bad.status === 400 && (await Patient.findById(kamala._id).lean()).dementiaMode === true, `${cs.status}/${stranger.status}/${bad.status}`);

    // 10. she hangs up without a word: no status callback on the trial, so the idle timer closes it
    const d10 = await mkDose(kamala, 'Telmisartan');
    r = await twilio(`/api/v1/voice/agent/dose?reminderId=${d10._id}`, { CallSid: 'CA-test-10' });
    await new Promise((x) => setTimeout(x, 4000));
    const run10 = await AgentRun.findOne({ patient: kamala._id, reminder: d10._id, trigger: 'phone_call' }).lean();
    check('hang-up with no status callback (trial): the run is closed after the idle time', run10 && run10.status !== 'running', `run ${run10 && run10.status}`);

    // 11. the same medicine at the same time twice (a double click) → 409; on purpose → allowed
    const med = { name: 'Shelcal', dosage: '500mg', type: 'tablet', frequency: 'once', scheduledTimes: ['21:00'], startDate: new Date(), notificationType: 'call' };
    const a1 = await api('POST', '/api/v1/medicines', kamala.user, med);
    const a2 = await api('POST', '/api/v1/medicines', kamala.user, { ...med, name: 'shelcal' });
    const a3 = await api('POST', '/api/v1/medicines', kamala.user, { ...med, allowDuplicate: true });
    for (const x of [a1, a3]) if (x.body.medicine) made.medicines.push(x.body.medicine._id);
    check('duplicate medicine (same name, any case, same time) → 409 with a message; allowDuplicate adds it',
      a1.status === 201 && a2.status === 409 && /already in the list/.test(a2.body.message) && a3.status === 201, `${a1.status}/${a2.status}/${a3.status}`);
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
