// Offline tests for the weekly review (fix 8): call measures and the comparison rules.
// Replaces Person B's script, which tested helpers that made up a baseline.
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeCallMeasures, countRepeats } = require('../observations');
const L = require('../../services/weeklyReviewLogic');

const DAY = L.DAY;
const REF = new Date('2026-11-22T14:30:00Z'); // a Sunday, 8 pm IST
const ago = (days, hourIst = 9) => { const d = new Date(REF.getTime() - days * DAY); d.setUTCHours(hourIst - 5, 30, 0, 0); return d; };
const blockOf = (h) => (h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night');
// one call: { at, block, m }
const call = (daysAgo, m, hourIst = 9) => ({ callId: `${daysAgo}-${hourIst}-${Math.random()}`, at: ago(daysAgo, hourIst), block: blockOf(hourIst), callType: 'phone', m });

test('call measures: her answers and the call steps, counted in code', () => {
  const m = Object.fromEntries(computeCallMeasures({
    patientLines: ['What? Say that again.', 'Um, yes yes, I took it.', '', 'The the white one.'],
    steps: [
      { tool: 'understand', output: { intent: 'unclear' } },
      { tool: 'patient_said', input: { text: 'a', asrConfidence: 0.9 } },
      { tool: 'patient_said', input: { text: 'b', asrConfidence: 0.7 } },
      { tool: 'agent_said', input: { lines: ['dose.check_question'] } },
      { tool: 'agent_said', input: { lines: ['dose.check_hint'] } },
      { tool: 'mark_dose', input: { status: 'taken' } },
    ],
  }).map((x) => [x.metric, x.value]));
  assert.equal(m.clarificationCount, 1);
  assert.equal(m.fillersCount, 1);
  assert.equal(m.repeatedPhrasesCount, 2); // "yes yes", "the the"
  assert.equal(m.silentTurns, 1);
  assert.equal(m.unclearTurns, 1);
  assert.equal(m.checkFails, 1);
  assert.equal(m.turnsToConfirm, 2);
  assert.equal(m.asrConfidence, 0.8);
  assert.equal(computeCallMeasures({ patientLines: [] }).length, 0, 'no answers → no measures');
  assert.equal(countRepeats(['Where is Ravi?', 'Where is Ravi?']), 1, 'the same question again');
});

// Her first 4 weeks: about 1 request to repeat per morning call. Then the last two weeks.
const baseline = () => Array.from({ length: 10 }, (_, i) => call(40 - i * 2, { clarificationCount: i % 2, turnLengthWords: 6, asrConfidence: 0.9 }));

test('worse two weeks running (same part of the day) → a change; one week → watch only', () => {
  const calls = [...baseline(),
    call(12, { clarificationCount: 3, turnLengthWords: 6 }), call(9, { clarificationCount: 2, turnLengthWords: 6 }),
    call(5, { clarificationCount: 3, turnLengthWords: 6 }), call(2, { clarificationCount: 4, turnLengthWords: 6 })];
  const r = L.compareWithBaseline(calls, { ref: REF });
  const c = r.results.find((x) => x.metric === 'clarificationCount' && x.block === 'morning');
  assert.equal(c.change, 'two_weeks');
  assert.equal(c.base, 0.5);
  assert.equal(r.results.find((x) => x.metric === 'turnLengthWords').change, 'none');

  const oneWeek = [...baseline(), call(12, { clarificationCount: 0 }), call(9, { clarificationCount: 1 }), call(5, { clarificationCount: 3 }), call(2, { clarificationCount: 4 })];
  assert.equal(L.compareWithBaseline(oneWeek, { ref: REF }).results.find((x) => x.metric === 'clarificationCount').change, 'one_week');
});

test('evening calls are not compared with her mornings; too few calls → nothing compared', () => {
  const calls = [...baseline(), call(12, { clarificationCount: 3 }, 19), call(9, { clarificationCount: 3 }, 19), call(5, { clarificationCount: 3 }, 19), call(2, { clarificationCount: 3 }, 19)];
  const r = L.compareWithBaseline(calls, { ref: REF });
  assert.equal(r.blocks.evening.enough, false, 'no evening baseline');
  assert.equal(r.results.filter((x) => x.block === 'evening').length, 0);
  assert.equal(L.compareWithBaseline(baseline().slice(0, 3), { ref: REF }).results.length, 0);
});

test('small changes do not count; the caregiver margin widens the bar', () => {
  assert.equal(L.isWorse('fillersCount', 0.1, 0.4, 0.25), false, '+0.3 is under the 0.5 minimum');
  assert.equal(L.isWorse('fillersCount', 1, 2, 0.25), true);
  assert.equal(L.isWorse('fillersCount', 2, 2.6, 0.25), true);
  assert.equal(L.isWorse('fillersCount', 2, 2.6, 0.35), false, 'a wider margin');
  assert.equal(L.isWorse('turnLengthWords', 8, 5, 0.25), true, 'shorter answers are worse');
});

test('sundowning: harder evenings in each of 3 weeks, 4+ events, more than daytime', () => {
  const hard = { sundowningAnxietyCount: 1 };
  const calls = [call(2, hard, 19), call(4, hard, 20), call(9, hard, 19), call(16, hard, 20), call(1, {}, 9)];
  const sd = L.detectSundowning(calls, [], { ref: REF });
  assert.equal(sd.detected, true);
  assert.equal(sd.eveningEvents, 4);
  assert.equal(sd.weeksWithEveningEvents, 3);
  assert.equal(L.detectSundowning(calls.slice(0, 3), [], { ref: REF }).detected, false, 'only two weeks');
  const daytimeToo = [...calls, call(2, hard, 9), call(3, hard, 10), call(9, hard, 11)];
  assert.equal(L.detectSundowning(daytimeToo, [], { ref: REF }).detected, false, 'not mainly evenings');
  assert.equal(L.detectSundowning([call(2, {}, 19), call(9, {}, 19)], [{ at: ago(16, 20), block: 'evening' }, { at: ago(3, 20), block: 'evening' }, { at: ago(10, 21), block: 'night' }, { at: ago(2, 20), block: 'evening' }], { ref: REF }).detected, true, 'missed evening doses count');
});
