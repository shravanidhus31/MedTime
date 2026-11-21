// Live check of A2.3: agent runs saved to MongoDB, and the two read endpoints.
// Needs MONGO_URI (your own dev database, e.g. medtime_dev_a) and GROQ_API_KEY in server/.env.
// Creates test users and a test patient, runs one real agent loop on Groq, checks the saved run
// and the endpoints, then deletes everything it created.
// Run from server/:  npm run runs:check   (about 3 Groq requests)

require('dotenv').config({ quiet: true });

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
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'runs-check-local-secret'; // only for this script

const mongoose = require('mongoose');
const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Patient = require('../models/Patient');
const AgentRun = require('../models/AgentRun');
const { registerTool } = require('../agent/tools');
const { runRecorded } = require('../agent/runs');
const { loadPrompt } = require('../agent/prompts');

const TAG = `runs-check-${Date.now()}`;
const results = [];
const check = (name, passed, detail = '') => {
  results.push(passed);
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

registerTool({
  name: 'check_double_dose',
  description: 'Check whether this dose is already recorded as taken today. Always call this before mark_dose.',
  inputSchema: { type: 'object', properties: { reminderId: { type: 'string' } }, required: ['reminderId'], additionalProperties: false },
  run: async ({ reminderId }) => ({ ok: true, data: { reminderId, alreadyTaken: false } }),
});
registerTool({
  name: 'mark_dose',
  description: 'Record that the patient took or skipped this dose.',
  inputSchema: {
    type: 'object',
    properties: { reminderId: { type: 'string' }, status: { type: 'string', enum: ['taken', 'skipped'] } },
    required: ['reminderId', 'status'],
    additionalProperties: false,
  },
  run: async () => ({ ok: true, data: { recorded: true } }),
});

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log(`Connected to ${mongoose.connection.name}\n`);
  const created = { users: [], patients: [] };
  let server;

  try {
    // ── test data ──
    const mkUser = async (role, n) => {
      const u = await User.create({ name: `${TAG} ${role}`, phone: `+9100000${Date.now() % 100000}${n}`, passwordHash: 'x', role });
      created.users.push(u._id);
      return u;
    };
    const patientUser = await mkUser('patient', 1);
    const caregiver = await mkUser('caregiver', 2);
    const stranger = await mkUser('caregiver', 3);
    const patient = await Patient.create({ user: patientUser._id, emergencyContact: '+910000000000', caregivers: [{ user: caregiver._id }] });
    created.patients.push(patient._id);

    // ── 1. a real run, saved ──
    const base = loadPrompt('base');
    const result = await runRecorded(
      { trigger: 'simulate', patientId: patient._id, flow: 'dose' },
      {
        system: `${base.text}\n\nCurrent task: confirm the morning dose. The reminder id is r-123.`,
        promptVersion: base.promptVersion,
        messages: [{ role: 'user', content: 'Patient said: "Yes, I took my morning tablet."' }],
        tools: ['check_double_dose', 'mark_dose'],
        ctx: { patientId: String(patient._id) },
      },
    );
    check('agent run completed', result.outcome === 'done', `outcome=${result.outcome}, ${result.toolCalls} tool calls, ${result.ms} ms`);
    check('run id returned', !!result.runId);

    const saved = await AgentRun.findById(result.runId).lean();
    check('run saved as finished', saved && saved.status === 'finished' && saved.outcome === 'done');
    check('every step saved, in order', saved && saved.steps.length === result.steps.length && saved.stepCount === result.steps.length,
      saved && saved.steps.map((s) => s.tool).join(' → '));
    check('steps keep input, output, ms and time', saved && saved.steps.every((s) => s.input && s.output && typeof s.ms === 'number' && s.at));
    check('prompt version and model saved', saved && saved.promptVersion === base.promptVersion && !!saved.model, saved && `${saved.promptVersion}, ${saved.model}`);

    // ── 2. the endpoints ──
    const app = express();
    app.use('/api/v1/agent', require('../routes/agentRoutes'));
    server = app.listen(0);
    const port = server.address().port;
    const token = (u) => jwt.sign({ id: u._id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const get = async (path, user) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/agent${path}`, { headers: user ? { Authorization: `Bearer ${token(user)}` } : {} });
      return { status: res.status, body: await res.json() };
    };

    const list = await get(`/runs?patient=${patient._id}`, caregiver);
    check('caregiver lists the patient\'s runs', list.status === 200 && list.body.runs.length === 1 && list.body.runs[0].stepCount === result.steps.length && !list.body.runs[0].steps);

    const one = await get(`/runs/${result.runId}`, patientUser);
    check('patient opens one run with its steps', one.status === 200 && one.body.run.steps.length === result.steps.length);

    const future = await get(`/runs?patient=${patient._id}&from=2099-01-01`, caregiver);
    check('date filter works', future.status === 200 && future.body.runs.length === 0);

    check('stranger is refused on the list (403)', (await get(`/runs?patient=${patient._id}`, stranger)).status === 403);
    check('stranger gets 404 on a run they can\'t see', (await get(`/runs/${result.runId}`, stranger)).status === 404);
    check('no token is refused (401)', (await get(`/runs?patient=${patient._id}`)).status === 401);
    check('bad patient id is rejected (400)', (await get('/runs?patient=nope', caregiver)).status === 400);
    check('bad date is rejected (400)', (await get(`/runs?patient=${patient._id}&from=yesterday-ish`, caregiver)).status === 400);
  } catch (err) {
    check('check ran without crashing', false, err.message);
  } finally {
    if (server) server.close();
    await AgentRun.deleteMany({ patient: { $in: created.patients } });
    await Patient.deleteMany({ _id: { $in: created.patients } });
    await User.deleteMany({ _id: { $in: created.users } });
    await mongoose.disconnect();
    const passed = results.filter(Boolean).length;
    console.log(`\n${passed}/${results.length} passed (test data deleted)`);
    process.exit(passed === results.length ? 0 : 1);
  }
})();
