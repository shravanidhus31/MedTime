// Offline tests for step-by-step guidance (Feature 4, A6.1).
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSteps, classifyStepAnswer } = require('./steps');
const { LINES, LINES_HI, render } = require('./doseLines');

const ids = (o) => buildSteps(o).map((s) => s.id);

test('3 to 5 steps from her medicine details: where it is, the box or the pill, food, water, swallow', () => {
  assert.deepEqual(ids({ hasLocation: true, hasPillbox: true, hasPill: true, food: 'with' }), ['go', 'box', 'food', 'water', 'swallow']);
  assert.deepEqual(ids({ hasPill: true, food: 'any' }), ['find', 'water', 'swallow']);
  assert.deepEqual(ids({}), ['find', 'water', 'swallow']);
  assert.deepEqual(ids({ hasLocation: true, hasPill: true, food: 'before' }), ['go', 'find', 'food', 'water', 'swallow']);
  for (const o of [{}, { hasLocation: true, hasPillbox: true, food: 'after' }]) {
    const n = buildSteps(o).length;
    assert.ok(n >= 3 && n <= 5, `${n} steps`);
  }
});

test('every step has a line and a simpler line, in English and Hindi, one question at most, no advice', () => {
  const all = buildSteps({ hasLocation: true, hasPillbox: true, food: 'with' })
    .concat(buildSteps({ hasPill: true, food: 'after' }), buildSteps({ food: 'before' }));
  for (const s of all) {
    for (const id of [s.line, s.simpler]) {
      assert.ok(LINES[id], id);
      assert.ok(LINES_HI[id], `${id} (hi)`);
      assert.ok((LINES[id].match(/\?/g) || []).length <= 1, id);
    }
  }
  assert.equal(render('step.box', { box: 'Morning, slot 1' }), 'Open your pillbox: Morning, slot 1. Tell me when it\'s open.');
});

test('her answer to a step: done, trouble, or the dose rules decide', () => {
  for (const t of ['Done.', 'Okay, it is open.', 'I have it.', 'Found it.', 'हाँ, हो गया', 'मिल गई']) assert.equal(classifyStepAnswer(t), 'done', t);
  for (const t of ["I can't find it.", "I don't know which one.", 'Where is the box?', 'नहीं मिल रही', '']) assert.equal(classifyStepAnswer(t), 'trouble', t);
  assert.equal(classifyStepAnswer('I already took it this morning.'), null);
  assert.equal(classifyStepAnswer('Who is calling?'), null);
});
