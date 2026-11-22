// Offline tests for the SMS reminder job (A1.2): a failed SMS is tried at most 3
// times, then marked failed; call-type medicines are skipped without a log line.
// The database query and sendSMS are stubbed; nothing is sent or stored.

const test = require('node:test');
const assert = require('node:assert/strict');

const Reminder = require('../models/Reminder');
const twilio = require('../utils/twilioClient');
const { runReminderTick, MAX_SMS_ATTEMPTS } = require('./reminderJob');

const realFind = Reminder.find;
const realSend = twilio.sendSMS;
test.after(() => { Reminder.find = realFind; twilio.sendSMS = realSend; });

// A fake reminder document. `smsFailed` ones are filtered out, like the real query.
const fakeReminder = (over = {}) => ({
  _id: over._id || 'r1',
  status: 'pending',
  smsAttempts: 0,
  smsFailed: false,
  saves: 0,
  patient: { user: { phone: '9999999999' } },
  medicine: { name: 'Amlodipine', dosage: '5 mg', mealTiming: 'after', notificationType: 'sms' },
  async save() { this.saves += 1; },
  ...over,
});

let docs, lastQuery;
const stubFind = () => {
  Reminder.find = (query) => {
    lastQuery = query;
    const matching = docs.filter((d) => d.status === 'pending' && !d.smsFailed);
    const q = { populate: () => q, then: (ok, fail) => Promise.resolve(matching).then(ok, fail) };
    return q;
  };
};

// Captures console output while `fn` runs.
const captureLogs = async (fn) => {
  const lines = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(orig)) console[k] = (...a) => lines.push(a.join(' '));
  try { await fn(); } finally { Object.assign(console, orig); }
  return lines;
};

test('the query leaves out reminders whose SMS already failed for good', async () => {
  docs = [];
  stubFind();
  await runReminderTick();
  assert.deepEqual(lastQuery.smsFailed, { $ne: true });
});

test('a failing SMS is tried 3 times, then marked failed and not picked up again', async () => {
  const r = fakeReminder();
  docs = [r];
  stubFind();
  let sends = 0;
  twilio.sendSMS = async () => { sends += 1; throw new Error('Invalid template name'); };

  for (let tick = 0; tick < 6; tick++) await captureLogs(() => runReminderTick());

  assert.equal(MAX_SMS_ATTEMPTS, 3);
  assert.equal(sends, 3);
  assert.equal(r.smsAttempts, 3);
  assert.equal(r.smsFailed, true);
  assert.equal(r.smsFailReason, 'Invalid template name');
  assert.equal(r.status, 'pending'); // the dose itself is not marked missed by the SMS job
});

test('an SMS that works on the second try marks the reminder alerted', async () => {
  const r = fakeReminder();
  docs = [r];
  stubFind();
  let sends = 0;
  twilio.sendSMS = async () => { sends += 1; if (sends === 1) throw new Error('timeout'); return 'SM1'; };

  await captureLogs(() => runReminderTick());
  await captureLogs(() => runReminderTick());
  await captureLogs(() => runReminderTick());

  assert.equal(sends, 2);
  assert.equal(r.status, 'alerted');
  assert.ok(r.alertedAt instanceof Date);
  assert.equal(r.smsFailed, false);
});

test('call-type medicines are skipped silently; a reminder with no phone is given up once', async () => {
  const call = fakeReminder({ _id: 'c1', medicine: { name: 'Metformin', notificationType: 'call' } });
  const noPhone = fakeReminder({ _id: 'n1', patient: { user: {} } });
  docs = [call, noPhone];
  stubFind();
  let sends = 0;
  twilio.sendSMS = async () => { sends += 1; return 'SM1'; };

  const lines = [];
  for (let tick = 0; tick < 3; tick++) lines.push(...await captureLogs(() => runReminderTick()));

  assert.equal(sends, 0);
  assert.equal(lines.filter((l) => /Skipping/.test(l)).length, 0);
  assert.equal(lines.filter((l) => /No phone/.test(l)).length, 1);
  assert.equal(noPhone.smsFailed, true);
  assert.equal(noPhone.smsFailReason, 'no_phone');
  assert.equal(call.saves, 0);
  assert.equal(call.status, 'pending');
});
