// Offline tests for fitting a prescription to her day and the food-rule check (Feature 8, B12).
// PRD gate: "with food" at a time with no meal produces a conflict warning, with a suggested time.

const test = require('node:test');
const assert = require('node:assert/strict');
const { fitToRoutine, foodTimingConflicts, mealsOf } = require('./scheduleFit');
const { _test: rx } = require('../agent/tools/readPrescription');

const routine = { weekday: { wake: '06:30', breakfast: '08:00', lunch: '13:30', dinner: '20:00', bed: '22:00' } };

test('PRD gate: "with food" at a time with no meal gives a conflict warning and a suggested time', () => {
  const [m] = fitToRoutine([{ name: 'Metformin', frequency: 'once', foodRule: 'with', times: ['16:00'] }], routine);
  assert.deepEqual(m.scheduledTimes, ['16:00']); // the prescription's time is kept; the caregiver decides
  assert.equal(m.timingConflicts.length, 1);
  assert.match(m.timingConflicts[0].message, /Metformin is to be taken with food, but 4:00 PM isn't at a meal/);
  assert.match(m.timingConflicts[0].message, /lunch is at 1:30 PM/);
  assert.equal(m.timingConflicts[0].suggestion, '13:30');
});

test('fitted from her meals: with / before / after land on, before and after the meal, with no warning', () => {
  const out = fitToRoutine([
    { name: 'A', frequency: 'twice', foodRule: 'with' },
    { name: 'B', frequency: 'once', foodRule: 'before' },
    { name: 'C', frequency: 'thrice', foodRule: 'after' },
  ], routine);
  assert.deepEqual(out[0].scheduledTimes, ['08:00', '20:00']);
  assert.deepEqual(out[1].scheduledTimes, ['07:45']);
  assert.deepEqual(out[2].scheduledTimes, ['08:30', '14:00', '20:30']);
  for (const m of out) assert.equal(m.timingConflicts, null);
});

test('"before breakfast" moved to after lunch is flagged; "after food" right after dinner is not', () => {
  const late = foodTimingConflicts({ name: 'Thyroxine', foodRule: 'before', scheduledTimes: ['14:00'] }, routine);
  assert.equal(late.length, 1);
  assert.match(late[0].message, /before food, but 2:00 PM isn't before a meal/);
  assert.equal(late[0].suggestion, '13:15');
  assert.deepEqual(foodTimingConflicts({ name: 'X', foodRule: 'after', scheduledTimes: ['21:00'] }, routine), []);
});

test('a meal she does not have is not invented: the default time is used and flagged', () => {
  const noLunch = { weekday: { breakfast: '09:00', lunch: null, dinner: '19:30' } };
  assert.deepEqual(Object.keys(mealsOf(noLunch)).sort(), ['breakfast', 'dinner']);
  const [m] = fitToRoutine([{ name: 'Glimepiride', frequency: 'thrice', foodRule: 'with' }], noLunch);
  assert.deepEqual(m.scheduledTimes, ['09:00', '13:00', '19:30']);
  assert.equal(m.timingConflicts.length, 1);
  assert.equal(m.timingConflicts[0].time, '13:00');
  const none = foodTimingConflicts({ name: 'Y', foodRule: 'with', scheduledTimes: ['10:00'] }, { weekday: {} });
  assert.match(none[0].message, /no meal times/);
});

test('no food rule, or "any": never a warning; a medicine with no name gets no times', () => {
  assert.deepEqual(foodTimingConflicts({ name: 'Z', foodRule: 'any', scheduledTimes: ['03:00'] }, routine), []);
  assert.deepEqual(foodTimingConflicts({ name: 'Z', scheduledTimes: ['03:00'] }, routine), []);
  const [m] = fitToRoutine([{ name: null, frequency: 'once' }], routine);
  assert.equal(m.scheduledTimes, null);
});

test('an edited Medicine is checked by its mealTiming (warnings on PUT /medicines/:id)', () => {
  const w = foodTimingConflicts({ name: 'Metformin', mealTiming: 'with', scheduledTimes: ['08:00', '16:00'] }, routine);
  assert.deepEqual(w.map((c) => c.time), ['16:00']);
});

test('the prescription reader keeps written clock times and reads 1-0-1 as twice a day', () => {
  assert.deepEqual(rx.timesInLine('Tab Metformin 500mg with food at 8 am and 4:30 pm'), ['08:00', '16:30']);
  assert.deepEqual(rx.timesInLine('Amlodipine 5mg 21:00'), ['21:00']);
  assert.equal(rx.timesInLine('Amlodipine 5mg once daily'), null);
  assert.equal(rx.timesInLine('take 500 mg'), null);
  assert.deepEqual(rx.cleanTimes(['8:00', '25:00', 'noon', '08:00']), ['08:00']);
  const r = rx.fallbackRegexParse('Metformin 500mg 1-0-1 after food\nDonepezil 5mg 1-1-1', []);
  assert.equal(r.medicines[0].frequency, 'twice');
  assert.equal(r.medicines[1].frequency, 'thrice');
});
