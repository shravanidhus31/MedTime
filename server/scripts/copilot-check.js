// Live check of the caregiver copilot (Feature 2, fix 9). The model is a scripted stand-in (no Groq
// tokens), so every path is exact: the agent looks up her records and the library, cites sources,
// and an answer is released only if BOTH reviews (safety risk, hallucination risk) score ≤ 2; one
// rewrite with the reviewers' reasons; otherwise withheld. Plus: the code guard on medicine advice,
// fixed replies for dosing questions and emergencies, the basic answer without a model, the run
// with its steps, and access (view access to that patient).
// Uses your dev database; deletes its test data.  Run from server/:  npm run copilot:check

require('dotenv').config({ quiet: true });
for (const v of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'RENDER']) delete process.env[v];
process.env.TWILIO_ENABLED = 'false';
if (process.env.NODE_ENV === 'production') process.env.NODE_ENV = 'development';
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'copilot-check-local-secret';

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
const { processCopilotQuery } = require('../services/copilotService');
const M = (n) => require(`../models/${n}`);
const [User, Patient, Medicine, Reminder, AgentRun, CaregiverAccess] = ['User', 'Patient', 'Medicine', 'Reminder', 'AgentRun', 'CaregiverAccess'].map(M);

const TAG = `copilot-check-${Date.now()}`;
const results = [];
const check = (name, passed, detail = '') => {
  results.push(!!passed);
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${String(detail).slice(0, 230)})` : ''}`);
};

// A scripted model: the agent loop's calls (tools given) take `loop` replies in order; the two
// reviewers and the rewrite take theirs. Records every call.
function fakeModel({ loop = [], safety = [], grounding = [], rewrite = [] }) {
  const calls = [];
  const fn = async (args) => {
    calls.push(args);
    const name = args.jsonSchema && args.jsonSchema.name;
    const base = { stopReason: 'end', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, model: 'scripted' };
    if (name === 'review_safety') return { ...base, json: safety.shift() };
    if (name === 'review_grounding') return { ...base, json: grounding.shift() };
    if (args.tools && args.tools.length) { const next = loop.shift() || { text: '' }; return { ...base, stopReason: next.toolCalls ? 'tool_use' : 'end', ...next }; }
    return { ...base, text: rewrite.shift() || '' };
  };
  fn.calls = calls;
  return fn;
}
const tool = (name, input = {}) => ({ toolCalls: [{ id: `c-${Math.random()}`, name, input }] });
const final = (obj) => ({ text: `Done.\n${JSON.stringify(obj)}` });

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log(`Connected to ${mongoose.connection.name} (scripted model)\n`);
  const made = { users: [], patients: [], medicines: [] };
  let server;
  try {
    const n = String(Date.now()).slice(-7);
    const amma = await User.create({ name: `Kamala ${TAG}`, phone: `+9181${n}`, passwordHash: 'x', role: 'patient' });
    const priya = await User.create({ name: `Priya ${TAG}`, phone: `+9182${n}`, passwordHash: 'x', role: 'caregiver' });
    const stranger = await User.create({ name: `Other ${TAG}`, phone: `+9183${n}`, passwordHash: 'x', role: 'caregiver' });
    made.users.push(amma._id, priya._id, stranger._id);
    const p = await Patient.create({ user: amma._id, emergencyContact: '+910000000071', dementiaMode: true });
    made.patients.push(p._id);
    await CaregiverAccess.create({ patient: p._id, user: priya._id, role: 'approve', status: 'active', approvedAt: new Date() });
    const med = await Medicine.create({ patient: p._id, name: 'Donepezil', dosage: '5mg', type: 'tablet', frequency: 'once', scheduledTimes: ['20:00'], startDate: new Date(Date.now() - 20 * 864e5), notificationType: 'call' });
    made.medicines.push(med._id);
    for (let i = 1; i <= 6; i += 1) await Reminder.create({ medicine: med._id, patient: p._id, scheduledTime: new Date(Date.now() - i * 864e5), status: i === 3 ? 'missed' : 'taken' });
    const ask = (message, model, extra = {}) => processCopilotQuery({ message, patientId: p._id, userId: priya._id, ...extra }, { chatFn: model });

    // 1. released: tools used, sources cited, both reviews ≤ 2
    let m = fakeModel({
      loop: [tool('get_dose_history', { from: new Date(Date.now() - 7 * 864e5).toISOString() }), tool('search_guidance', { query: 'evening agitation' }),
        final({ mode: 'coach', answer: 'She took 5 of her last 6 evening doses [record: dose history]. In the late afternoon, keep the lights bright and the routine calm [guide:nice_sundowning_01].', sources: ['record:dose_history', 'guide:nice_sundowning_01'] })],
      safety: [{ score: 1, reason: 'No medical advice.' }],
      grounding: [{ score: 1, reason: 'All facts in the evidence.' }],
    });
    let r = await ask('She gets upset in the evenings and sometimes misses her Donepezil. What can I do?', m);
    const run = r.runId ? await AgentRun.findById(r.runId).lean() : null;
    check('released: the agent looked up her doses and the guidance library, cited both, and both reviews scored ≤ 2',
      r.released && r.source === 'agent' && r.mode === 'coach' && r.reviews.safety.score === 1 && r.reviews.grounding.score === 1 && r.citations.map((c) => c.id).join() === 'records,nice_sundowning_01', r.reply);
    check('the two reviews are separate model calls; the hallucination reviewer sees the tool evidence (her real dose log)',
      m.calls.filter((c) => c.jsonSchema && c.jsonSchema.name === 'review_safety').length === 1 && m.calls.filter((c) => c.jsonSchema && c.jsonSchema.name === 'review_grounding' && /EVIDENCE:[\s\S]*taken/.test(c.messages[0].content)).length === 1);
    check('an agent run records it: tool calls, both reviews, released',
      run && run.trigger === 'copilot' && ['get_dose_history', 'search_guidance', 'review_answer', 'release_answer'].every((t) => run.steps.some((s) => s.tool === t)), run && run.steps.map((s) => s.tool).join(' → '));

    // 2. a reviewer scores 3 → one rewrite with its reason → reviewed again → released
    m = fakeModel({
      loop: [tool('search_guidance', { query: 'bathing' }), final({ mode: 'coach', answer: 'Most people with dementia hate water after age 80 [guide:nhs_personal_care_03].', sources: ['guide:nhs_personal_care_03'] })],
      safety: [{ score: 1, reason: 'ok' }, { score: 1, reason: 'ok' }],
      grounding: [{ score: 4, reason: 'The claim about age 80 is not in the evidence.' }, { score: 1, reason: 'Supported.' }],
      rewrite: [JSON.stringify({ mode: 'coach', answer: 'Try a warm room, a towel ready and one step at a time [guide:nhs_personal_care_03].', sources: ['guide:nhs_personal_care_03'] })],
    });
    r = await ask('She refuses to bathe. How do I help?', m);
    const rewriteCall = m.calls.find((c) => !c.jsonSchema && !(c.tools && c.tools.length));
    check('hallucination risk 4 → rewritten with the reviewer\'s reason → reviewed again → released',
      r.released && /warm room/.test(r.reply) && rewriteCall && /not in the evidence/.test(rewriteCall.system), r.reply);

    // 3. still failing after the rewrite → withheld (never shown)
    m = fakeModel({
      loop: [final({ mode: 'inform', answer: 'Her memory will get much worse within a year.', sources: [] })],
      safety: [{ score: 4, reason: 'A prognosis.' }, { score: 4, reason: 'Still a prognosis.' }],
      grounding: [{ score: 5, reason: 'Invented.' }, { score: 5, reason: 'Invented.' }],
      rewrite: [JSON.stringify({ mode: 'inform', answer: 'She will decline soon.', sources: [] })],
    });
    r = await ask('How fast will her memory get worse?', m);
    check('still unsafe after the rewrite → WITHHELD: "Her doctor or nurse is the best person to ask"; the prognosis is never shown',
      !r.released && r.source === 'withheld' && !/worse within a year|decline soon/.test(r.reply) && /doctor or nurse/.test(r.reply), r.reply);

    // 4. the code guard: medicine advice is withheld even if both reviewers pass it
    m = fakeModel({
      loop: [final({ mode: 'inform', answer: 'You can give her 10 mg instead on bad days.', sources: [] })],
      safety: [{ score: 1, reason: 'ok' }], grounding: [{ score: 1, reason: 'ok' }],
      rewrite: [JSON.stringify({ mode: 'inform', answer: 'Give her an extra tablet in the evening.', sources: [] })],
    });
    r = await ask('She seems more confused on bad days, what helps?', m);
    check('medicine advice in a draft is caught by the code guard and withheld, even when the reviewers would pass it',
      !r.released && !/10 mg|extra tablet/.test(r.reply) && r.reviews.safety.score === 5, r.reviews && r.reviews.safety && r.reviews.safety.reason);

    // 5. fixed replies: a dosing question, an emergency (no model call at all)
    m = fakeModel({});
    r = await ask('Can I stop the Donepezil for a week?', m);
    check('dosing question → fixed refusal ("only her doctor can decide"), offer to note it for the doctor, no model call',
      r.source === 'fixed' && /only her doctor can decide/.test(r.reply) && r.proposedAction && r.proposedAction.type === 'doctor_question' && m.calls.length === 0, r.reply);
    r = await ask('She fell in the bathroom and can\'t get up', m);
    check('emergency in the question → "call 112" at once, no model call', r.urgent === 'fall' && /call 112/.test(r.reply) && m.calls.length === 0, r.reply);
    r = await ask('I feel so overwhelmed and I want to end my life', m);
    check('the caregiver in crisis → Tele-MANAS 14416 and 112 (the unverified number B used is gone)', /14416/.test(r.reply) && !/1800-11-0031/.test(r.reply), r.reply);

    // 6. no model → a basic answer from the library and her records, clearly marked
    const down = async () => { const e = new Error('Groq rate limit reached'); e.kind = 'rate_limit'; throw e; };
    r = await ask('She missed some pills this week, what helps her remember?', down);
    check('model unavailable → basic answer from the library and her dose log ("5 of 6 doses… 1 missed"), marked as basic',
      r.released && r.source === 'basic' && /5 of 6 doses/.test(r.reply) && /1 missed/.test(r.reply) && /basic answer/.test(r.reviews.note), r.reply);

    // 7. access: view access to that patient
    const app = express();
    app.use(express.json());
    app.use('/api/v1/copilot', require('../routes/copilotRoutes'));
    server = app.listen(0);
    const as = (u) => ({ Authorization: `Bearer ${jwt.sign({ id: String(u._id), role: 'caregiver' }, process.env.JWT_SECRET)}`, 'Content-Type': 'application/json' });
    const url = `http://127.0.0.1:${server.address().port}/api/v1/copilot/ask`;
    const denied = await fetch(url, { method: 'POST', headers: as(stranger), body: JSON.stringify({ message: 'How is she?', patientId: String(p._id) }) });
    const noPatient = await fetch(url, { method: 'POST', headers: as(priya), body: JSON.stringify({ message: 'How is she?' }) });
    const fixedOk = await fetch(url, { method: 'POST', headers: as(priya), body: JSON.stringify({ message: 'Can I give her half a tablet?', patientId: String(p._id) }) });
    check('access: a caregiver not linked to her → 403; no patient → 400; her caregiver → 200',
      denied.status === 403 && noPatient.status === 400 && fixedOk.status === 200, `${denied.status} ${noPatient.status} ${fixedOk.status}`);
  } catch (err) {
    check('check ran without crashing', false, err.stack);
  } finally {
    if (server) server.close();
    await AgentRun.deleteMany({ patient: { $in: made.patients } });
    await Reminder.deleteMany({ patient: { $in: made.patients } });
    await CaregiverAccess.deleteMany({ patient: { $in: made.patients } });
    await Medicine.deleteMany({ _id: { $in: made.medicines } });
    await Patient.deleteMany({ _id: { $in: made.patients } });
    await User.deleteMany({ _id: { $in: made.users } });
    await mongoose.disconnect();
    const passed = results.filter(Boolean).length;
    console.log(`\n${passed}/${results.length} passed (test data deleted)`);
    process.exit(passed === results.length ? 0 : 1);
  }
})();
