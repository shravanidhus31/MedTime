// Offline tests for Person B's reminder generator (B1.4/B12), added at integration with the
// one-day-early fix. The database calls are stubbed; dates are checked in IST.

const test = require('node:test');
const assert = require('node:assert/strict');

const Reminder = require('../models/Reminder');
const { generateRemindersForMedicine } = require('./reminderTopUpJob');

const IST = 5.5 * 3600 * 1000;
const DAY = 24 * 3600 * 1000;
const istParts = (d) => {
  const x = new Date(d.getTime() + IST);
  return { date: x.toISOString().slice(0, 10), hhmm: x.toISOString().slice(11, 16), weekday: x.getUTCDay() };
};

const realExists = Reminder.exists;
const realCreate = Reminder.create;
let created;
test.beforeEach(() => {
  created = [];
  Reminder.exists = async () => null;
  Reminder.create = async (doc) => { created.push(doc); return doc; };
});
test.after(() => { Reminder.exists = realExists; Reminder.create = realCreate; });

const med = (over) => ({ _id: 'm1', patient: 'p1', scheduledTimes: ['08:00', '20:00'], frequency: 'twice', startDate: new Date(Date.now() - 30 * DAY), ...over });

test('daily: every reminder is at the scheduled IST time, in the future, within the next 7 IST days', async () => {
  const now = new Date();
  await generateRemindersForMedicine(med());
  assert.ok(created.length >= 12 && created.length <= 14, `${created.length} reminders`);
  const todayIST = istParts(now).date;
  for (const r of created) {
    const p = istParts(r.scheduledTime);
    assert.ok(['08:00', '20:00'].includes(p.hhmm), `time ${p.hhmm}`);
    assert.ok(r.scheduledTime > now, 'not in the past');
    assert.ok(r.scheduledTime.getTime() - now.getTime() < 7 * DAY, 'within 7 days');
  }
  // The window starts today (IST), not yesterday: the latest reminder is 6 IST days from today.
  const last = istParts(created[created.length - 1].scheduledTime).date;
  const sixDaysOn = istParts(new Date(now.getTime() + 6 * DAY)).date;
  assert.equal(last, sixDaysOn);
  assert.ok(created.some((r) => istParts(r.scheduledTime).date === todayIST) || istParts(now).hhmm >= '20:00');
});

test('weekly: the reminder falls on the chosen IST weekday (it used to land one day early)', async () => {
  const tomorrow = istParts(new Date(Date.now() + DAY)).weekday;
  await generateRemindersForMedicine(med({ frequency: 'weekly', daysOfWeek: [tomorrow], scheduledTimes: ['08:00'] }));
  assert.equal(created.length, 1, `${created.length} reminders`);
  const p = istParts(created[0].scheduledTime);
  assert.equal(p.weekday, tomorrow);
  assert.equal(p.hhmm, '08:00');
});

test('alternate days: reminders are 2 IST days apart, counted from the start date', async () => {
  const start = new Date(Date.now() - 10 * DAY);
  await generateRemindersForMedicine(med({ frequency: 'alternate_days', intervalDays: 2, startDate: start, scheduledTimes: ['23:59'] }));
  const startDay = Date.parse(istParts(start).date);
  assert.ok(created.length >= 3);
  for (const r of created) {
    const days = Math.round((Date.parse(istParts(r.scheduledTime).date) - startDay) / DAY);
    assert.equal(days % 2, 0, `day ${days} after the start`);
  }
});

test('an early-morning IST time (before 05:30) lands on the right IST date', async () => {
  const tomorrow = istParts(new Date(Date.now() + DAY));
  await generateRemindersForMedicine(med({ frequency: 'weekly', daysOfWeek: [tomorrow.weekday], scheduledTimes: ['02:00'] }));
  assert.equal(created.length, 1);
  assert.deepEqual([istParts(created[0].scheduledTime).date, istParts(created[0].scheduledTime).hhmm], [tomorrow.date, '02:00']);
});
