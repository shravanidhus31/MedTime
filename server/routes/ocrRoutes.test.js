// Offline tests for the prescription routes (Feature 8, B12). PRD gates: no Medicine record exists
// before approval; "with food" at a time with no meal is shown to the caregiver as a conflict.
// Plus the 22 Nov access fixes: only someone with approve access can upload or approve, and a
// Level 2 proposal needs a doctor. OCR, the LLM and every database call are stubbed.

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'ocr-test-secret';
delete process.env.GROQ_API_KEY; // the regex reader, no network
delete process.env.ANTHROPIC_API_KEY;

const Tesseract = require('tesseract.js');
const Patient = require('../models/Patient');
const Medicine = require('../models/Medicine');
const AgentRun = require('../models/AgentRun');
const RoutineProfile = require('../models/RoutineProfile');
const ProposedChange = require('../models/ProposedChange');
const CaregiverAccess = require('../models/CaregiverAccess');

const id = () => new mongoose.Types.ObjectId();
const patientUser = id();
const caregiverUser = id();
const strangerUser = id();
const doctorUser = id();
const patientId = id();
const links = { [caregiverUser]: 'approve', [doctorUser]: 'doctor' };

const saved = {};
const stub = (obj, key, fn) => { saved[`${obj.modelName || 'mod'}.${key}`] = [obj, key, obj[key]]; obj[key] = fn; };
const q = (v) => ({ lean: async () => v, select: async () => v, then: (res, rej) => Promise.resolve(v).then(res, rej) });

const proposals = [];
let medicinesCreated = 0;

stub(Tesseract, 'recognize', async () => ({ data: { text: 'Tab Metformin 500mg with food at 4 pm once daily' } }));
stub(Patient, 'findById', (pid) => q(String(pid) === String(patientId) ? { _id: patientId, user: patientUser } : null));
stub(CaregiverAccess, 'findOne', ({ user }) => q(links[user] ? { role: links[user] } : null));
stub(Medicine, 'find', () => q([]));
stub(Medicine, 'create', async () => { medicinesCreated += 1; return { _id: id() }; });
stub(AgentRun, 'create', async (doc) => ({ ...doc, _id: id(), steps: doc.steps || [], save: async () => {} }));
stub(RoutineProfile, 'findOne', () => q({ weekday: { breakfast: '08:00', lunch: '13:00', dinner: '20:00' } }));
stub(ProposedChange, 'create', async (doc) => { const p = { ...doc, _id: id() }; proposals.push(p); return p; });
stub(ProposedChange, 'findById', (pid) => {
  const p = proposals.find((x) => String(x._id) === String(pid));
  return p ? Object.assign(p, { save: async () => p }) : null;
});
test.after(() => { for (const [obj, key, fn] of Object.values(saved)) obj[key] = fn; });

// the reminder job is not under test
const topUp = require('../jobs/reminderTopUpJob');
topUp.generateRemindersForMedicine = async () => ({ created: 0 });

const router = require('./ocrRoutes');
const app = express();
app.use(express.json());
app.use('/ocr', router);
let server; let base;
test.before(() => new Promise((r) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}/ocr`; r(); }); }));
test.after(() => server && server.close());

const auth = (user) => ({ Authorization: `Bearer ${jwt.sign({ id: String(user), role: 'caregiver' }, process.env.JWT_SECRET)}` });
const upload = async (user) => {
  const form = new FormData();
  form.append('patientId', String(patientId));
  form.append('prescription', new Blob([Buffer.from('fake image')], { type: 'image/png' }), 'rx.png');
  const r = await fetch(`${base}/parse`, { method: 'POST', headers: auth(user), body: form });
  return { status: r.status, body: await r.json() };
};
const approve = async (user, pid) => {
  const r = await fetch(`${base}/approve/${pid}`, { method: 'POST', headers: { ...auth(user), 'Content-Type': 'application/json' }, body: '{}' });
  return { status: r.status, body: await r.json() };
};

test('someone with no link to her cannot upload a prescription for her', async () => {
  const r = await upload(strangerUser);
  assert.equal(r.status, 403);
  assert.equal(proposals.length, 0);
});

test('upload: a proposal is queued, no Medicine is created, and the food conflict is in the evidence', async () => {
  const r = await upload(caregiverUser);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(medicinesCreated, 0, 'no Medicine before approval');
  assert.equal(proposals.length, 1);
  assert.deepEqual(r.body.medicines[0].scheduledTimes, ['16:00']);
  assert.equal(r.body.timingConflicts.length, 1);
  assert.equal(r.body.timingConflicts[0].suggestion, '13:00');
  assert.match(proposals[0].evidence, /Metformin is to be taken with food, but 4:00 PM isn't at a meal/);
});

test('approve: a stranger is refused; the caregiver approves a Level 1 proposal and the Medicine is created', async () => {
  const pid = proposals[0]._id;
  proposals[0].level = 1;
  assert.equal((await approve(strangerUser, pid)).status, 403);
  assert.equal(medicinesCreated, 0);
  const r = await approve(caregiverUser, pid);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(medicinesCreated, 1);
  assert.equal(proposals[0].status, 'approved');
});

test('a Level 2 proposal needs a doctor: the caregiver and she herself are refused, the doctor approves', async () => {
  const p = { _id: id(), patient: patientId, kind: 'new_schedule', level: 2, status: 'pending', payload: { medicines: [{ name: 'Donepezil', scheduledTimes: ['21:00'] }] } };
  proposals.push(p);
  const before = medicinesCreated;
  const r1 = await approve(caregiverUser, p._id);
  assert.equal(r1.status, 403);
  assert.match(r1.body.message, /doctor's review/);
  assert.equal((await approve(patientUser, p._id)).status, 403);
  assert.equal(medicinesCreated, before);
  assert.equal((await approve(doctorUser, p._id)).status, 200);
  assert.equal(medicinesCreated, before + 1);
});

test('an escalated Level 1 proposal waits for the doctor (it used to be a dead end)', async () => {
  const p = { _id: id(), patient: patientId, kind: 'new_schedule', level: 1, status: 'escalated', payload: { medicines: [{ name: 'Losartan', scheduledTimes: ['09:00'] }] } };
  proposals.push(p);
  assert.equal((await approve(caregiverUser, p._id)).status, 403);
  assert.equal((await approve(doctorUser, p._id)).status, 200);
  assert.equal(p.status, 'approved');
});
