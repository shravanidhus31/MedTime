// Offline tests for the follow-up rules (A4.3). Pure functions: no database, no model.
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./followups');
const { LINES, LINES_HI } = require('./doseLines');

const concerns = (lines) => F.extractConcernsRules(lines).map((c) => c.concern).sort();

test('finds concerns from the fixed list, with her own words as the quote', () => {
  const r = F.extractConcernsRules(['Yes, I took it. My knee is hurting a lot today.']);
  assert.deepEqual(r, [{ concern: 'knee', quote: 'My knee is hurting a lot today.' }]);
  assert.deepEqual(concerns(['I have a headache and I could not sleep. I could not sleep at all.']), ['headache', 'sleep']);
  assert.deepEqual(concerns(["I couldn't sleep last night", 'I feel so lonely these days']), ['feeling_low', 'sleep']);
  assert.deepEqual(concerns(['My grandson is coming to visit on Sunday.']), ['visit']);
  assert.deepEqual(concerns(['मेरे घुटने में बहुत दर्द है।', 'आज भूख नहीं लग रही']), ['appetite', 'knee']);
  assert.deepEqual(concerns(['my stomach is upset']), ['stomach']);
});

test('no concern: a body part without pain, "it is fine now", a red-flag fall, everyday talk', () => {
  assert.deepEqual(concerns(['I knelt on my knee to pray.']), []);
  assert.deepEqual(concerns(['My knee is fine now.']), []);
  assert.deepEqual(concerns(['Yes, I took the small white one.']), []);
  assert.deepEqual(concerns(['I came back from the market.']), []);
  assert.equal(F.mayHaveConcern(['Yes, I took it.']), false);
  assert.equal(F.mayHaveConcern(['My knee hurts']), true);
});

test('her answer: better closes it, still hurting keeps it open, a visit is yes/no', () => {
  assert.equal(F.classifyAnswer('Yes, it is much better now.', 'knee'), 'better');
  assert.equal(F.classifyAnswer('It is fine.', 'knee'), 'better');
  assert.equal(F.classifyAnswer('Still hurts a little.', 'knee'), 'not_better');
  assert.equal(F.classifyAnswer('Not better.', 'back'), 'not_better');
  assert.equal(F.classifyAnswer('No.', 'headache'), 'not_better');
  assert.equal(F.classifyAnswer('हाँ, अब आराम है।', 'knee'), 'better');
  assert.equal(F.classifyAnswer('नहीं, अभी भी दर्द है।', 'knee'), 'not_better');
  assert.equal(F.classifyAnswer('Yes, they came on Sunday.', 'visit'), 'better');
  assert.equal(F.classifyAnswer("No, he didn't come.", 'visit'), 'not_better');
  assert.equal(F.classifyAnswer('What?', 'knee'), 'unclear');
});

test('every concern has a question line, in English and Hindi, one question each, no advice', () => {
  for (const c of F.CONCERNS) {
    assert.ok(LINES[`followup.${c}`], c);
    assert.ok(LINES_HI[`followup.${c}`], `${c} (hi)`);
    assert.equal((LINES[`followup.${c}`].match(/\?/g) || []).length, 1, c);
    assert.doesNotMatch(LINES[`followup.${c}`], /\b(take|apply|should|try|rest|doctor)\b/i, `${c}: asks, never advises`);
  }
});
