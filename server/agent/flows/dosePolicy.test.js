// Offline tests for the dose call rules (A4.1). Pure functions: no database, no model.

const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('./dosePolicy');
const { render, LINES } = require('./doseLines');

const L = (intent, extra = {}) => ({ intent, pill_mentioned: null, matches_expected: false, confidence: 0.9, ...extra });
const INFO = { attempt: 1, turnsLeft: 5, hasLocation: true, hasPillbox: true, hasPill: true };
const toolNames = (d) => d.tools.map((t) => (t.name === 'mark_dose' ? `mark_dose:${t.input.status}` : t.name));
const EXPECTED = { medicine: 'Amlodipine', pill: 'small white round' };

// ── understanding (rules fallback) ──

test('rules: "taking it now" is not "taken"; earlier doses are "already_took"', () => {
  assert.equal(P.ruleLabel('Okay, I am taking it now.', EXPECTED).intent, 'taking_now');
  assert.equal(P.ruleLabel('Yes, I have taken it.', EXPECTED).intent, 'taken');
  assert.equal(P.ruleLabel('I already took it this morning, I think.', EXPECTED).intent, 'already_took');
  assert.equal(P.ruleLabel("I can't find my pills", EXPECTED).intent, 'cant_find');
  assert.equal(P.ruleLabel("I don't want it today", EXPECTED).intent, 'refuse');
  assert.equal(P.ruleLabel('Call me after lunch', EXPECTED).intent, 'later');
  assert.equal(P.ruleLabel('What is the weather today?', EXPECTED).intent, 'question');
  assert.equal(P.ruleLabel('mmm', EXPECTED).intent, 'unclear');
});

test('rules: the pill check matches the name or the description, not something else', () => {
  assert.equal(P.matchesExpected('The Amlodipine, the white one.', EXPECTED), true);
  assert.equal(P.matchesExpected('the small white one', EXPECTED), true);
  assert.equal(P.matchesExpected('the big yellow Metformin', EXPECTED), false);
  assert.equal(P.matchesExpected('yes', EXPECTED), false);
});

test('a model label below the confidence floor counts as unclear; an unknown intent too', () => {
  assert.equal(P.normaliseLabel(L('taken', { confidence: 0.3 })).intent, 'unclear');
  assert.equal(P.normaliseLabel({ intent: 'dance' }).intent, 'unclear');
  assert.equal(P.normaliseLabel(L('taken')).intent, 'taken');
});

// ── the reminder ──

test('tone by attempt: calm, firmer, concerned', () => {
  assert.equal(P.greetLine(1), 'dose.greet.calm');
  assert.equal(P.greetLine(2), 'dose.greet.firmer');
  assert.equal(P.greetLine(3), 'dose.greet.concerned');
});

test('"I\'ve taken it" → the check question, nothing recorded yet', () => {
  const d = P.decide(P.newState(), L('taken'), INFO);
  assert.deepEqual(d.say, ['dose.check_question']);
  assert.deepEqual(d.tools, []);
  assert.equal(d.state.phase, 'check');
  assert.equal(d.end, false);
});

test('"I\'ve taken the white Amlodipine" answers the check question too → recorded, praise, end', () => {
  const d = P.decide(P.newState(), L('taken', { pill_mentioned: 'Amlodipine', matches_expected: true }), INFO);
  assert.deepEqual(toolNames(d), ['mark_dose:taken']);
  assert.deepEqual(d.say, ['dose.praise']);
  assert.equal(d.end, true);
});

test('check question: right pill → recorded; wrong pill → hint, then hand-over without recording', () => {
  const s1 = P.decide(P.newState(), L('taken'), INFO).state;
  const ok = P.decide(s1, L('taken', { matches_expected: true, pill_mentioned: 'white one' }), INFO);
  assert.deepEqual(toolNames(ok), ['mark_dose:taken']);

  const wrong1 = P.decide(s1, L('taken', { matches_expected: false, pill_mentioned: 'yellow one' }), INFO);
  assert.deepEqual(wrong1.say, ['dose.check_hint']);
  assert.deepEqual(wrong1.tools, []);
  const wrong2 = P.decide(wrong1.state, L('unsure'), INFO);
  assert.deepEqual(wrong2.say, ['dose.handover_unsure']);
  assert.deepEqual(toolNames(wrong2), ['notify_caregiver']);
  assert.equal(wrong2.tools[0].input.reason, 'unsure_dose');
  assert.equal(wrong2.informCaregiver, true);
  assert.equal(wrong2.end, true);
});

test('"I\'m taking it now" (A2.7 gap) → wait; a second time → the check question; never recorded on its own', () => {
  const d1 = P.decide(P.newState(), L('taking_now'), INFO);
  assert.deepEqual(d1.say, ['dose.take_your_time']);
  assert.deepEqual(d1.tools, []);
  const d2 = P.decide(d1.state, L('taking_now'), INFO);
  assert.deepEqual(d2.say, ['dose.check_question']);
  assert.deepEqual(d2.tools, []);
});

test('"I already took it": recorded → "don\'t take another one", nothing recorded again', () => {
  const d = P.decide(P.newState(), L('already_took'), { ...INFO, recorded: true });
  assert.deepEqual(d.say, ['dose.already_done']);
  assert.deepEqual(d.tools, []);
  assert.equal(d.end, true);
  assert.match(render('dose.already_done', { name: 'Kamala', medicine: 'Amlodipine' }), /don't take another one/);
});

test('"I already took it", not recorded → don\'t take another, caregiver phoned AND asked, not recorded', () => {
  const d = P.decide(P.newState(), L('already_took'), { ...INFO, recorded: false });
  assert.deepEqual(d.say, ['dose.dont_take_another']);
  assert.deepEqual(toolNames(d), ['notify_caregiver', 'ask_caregiver']);
  assert.equal(d.informCaregiver, true);
  assert.ok(!toolNames(d).some((n) => n.startsWith('mark_dose')));
});

test('later → snooze (call back in 10 min) until the 3rd attempt, then the caregiver', () => {
  const d1 = P.decide(P.newState(), L('later'), { ...INFO, attempt: 1 });
  assert.equal(d1.snooze, true);
  assert.deepEqual(d1.say, ['dose.call_back']);
  const d3 = P.decide(P.newState(), L('later'), { ...INFO, attempt: 3 });
  assert.equal(d3.snooze, false);
  assert.deepEqual(toolNames(d3), ['notify_caregiver']);
});

test('refuse → recorded as skipped, family told, no pressure', () => {
  const d = P.decide(P.newState(), L('refuse'), INFO);
  assert.deepEqual(toolNames(d), ['mark_dose:skipped', 'notify_caregiver']);
  assert.deepEqual(d.say, ['dose.ok_skip']);
});

test("can't find it → location hint, then a hand-over after the second failure", () => {
  const d1 = P.decide(P.newState(), L('cant_find'), INFO);
  assert.deepEqual(d1.say, ['dose.hint_location']);
  const d2 = P.decide(d1.state, L('cant_find'), INFO);
  assert.deepEqual(d2.say, ['dose.handover']);
  assert.deepEqual(toolNames(d2), ['notify_caregiver']);
  const noData = P.decide(P.newState(), L('unsure'), { ...INFO, hasLocation: false, hasPillbox: false });
  assert.deepEqual(noData.say, ['dose.hint_pill']);
  const nothing = P.decide(P.newState(), L('unsure'), { ...INFO, hasLocation: false, hasPillbox: false, hasPill: false });
  assert.deepEqual(nothing.say, ['dose.hint_generic']);
  const s1 = P.decide(P.newState(), L('taken'), INFO).state;
  assert.deepEqual(P.decide(s1, L('taken', { matches_expected: false }), { ...INFO, hasPill: false }).say, ['dose.check_reask']);
});

test('a question → redirect, then the question again (last); unsafe → polite refusal, nothing run', () => {
  const q = P.decide(P.newState(), L('question'), INFO);
  assert.deepEqual(q.say, ['dose.redirect', 'dose.reask']);
  const checkPhase = P.decide(P.newState(), L('taken'), INFO).state;
  const qc = P.decide(checkPhase, L('question'), INFO);
  assert.deepEqual(qc.say, ['dose.redirect', 'dose.check_reask']);
  const u = P.decide(P.newState(), L('taken', { matches_expected: true }), { ...INFO, unsafe: true });
  assert.deepEqual(u.say, ['dose.unsafe', 'dose.reask']);
  assert.deepEqual(u.tools, []);
});

test('unclear twice → hand-over; at the end of the turn budget → hand-over at once', () => {
  const d1 = P.decide(P.newState(), L('unclear'), INFO);
  assert.deepEqual(d1.say, ['dose.sorry_reask']);
  assert.deepEqual(P.decide(d1.state, L('unclear'), INFO).say, ['dose.handover']);
  assert.deepEqual(P.decide(P.newState(), L('unclear'), { ...INFO, turnsLeft: 0 }).say, ['dose.handover']);
});

test('safety property: nothing but a matching pill ever records the dose as taken', () => {
  for (const phase of ['reminder', 'check']) {
    for (const intent of P.INTENTS) {
      for (const matches of [false, true]) {
        const st = { ...P.newState(), phase };
        const d = P.decide(st, L(intent, { matches_expected: matches }), { ...INFO, recorded: false });
        if (toolNames(d).includes('mark_dose:taken')) {
          assert.equal(matches, true, `${phase}/${intent} recorded a dose without a matching pill`);
        }
      }
    }
  }
});

test('every line the policy can say exists, ends a question last, and the lines that end the call say goodbye', () => {
  for (const [id, text] of Object.entries(LINES)) {
    const q = text.indexOf('?');
    assert.ok(q === -1 || q === text.length - 1, `${id}: something after the question`);
  }
  for (const id of ['dose.already_done', 'dose.praise', 'dose.call_back', 'dose.ok_skip', 'dose.dont_take_another', 'dose.handover', 'dose.handover_unsure']) {
    assert.match(LINES[id], /Goodbye/, id);
  }
});

// Core scenario 4 (fix 7, found by the agent eval): the dose was ticked in the app during the call,
// then she says she is taking it. Before, she heard "Take your time" (a double dose).
test('already recorded: "taking it now" / "yes" / "I took it" stop the call and tell the family', () => {
  for (const intent of ['taking_now', 'yes', 'taken', 'cant_find', 'unsure']) {
    const d = P.decide(P.newState(), { intent, matches_expected: false }, { attempt: 1, turnsLeft: 6, recorded: true });
    assert.deepEqual(d.say, ['dose.already_taken_stop'], intent);
    assert.equal(d.end, true);
    assert.equal(d.tools[0].name, 'notify_caregiver');
    assert.ok(!d.tools.some((t) => t.name === 'mark_dose'), 'nothing recorded again');
  }
  const done = P.decide(P.newState(), { intent: 'already_took' }, { attempt: 1, turnsLeft: 6, recorded: true });
  assert.deepEqual(done.say, ['dose.already_done']);
  assert.equal(done.tools.length, 0);
});

// Core scenario 5: "Where is Ravi?" is a question, not "can't find the pill" (rules fallback).
test('rules: "where is <person>" is a question; "where is it / my tablet" is cant_find', () => {
  const ex = { medicine: 'Amlodipine', pill: 'small white round tablet' };
  assert.equal(P.ruleLabel('Where is Ravi?', ex).intent, 'question');
  assert.equal(P.ruleLabel('Where is it?', ex).intent, 'cant_find');
  assert.equal(P.ruleLabel('where is my tablet', ex).intent, 'cant_find');
  assert.equal(P.ruleLabel('Where is the Amlodipine?', ex).intent, 'cant_find');
});

// Core scenario 9: a Hindi speaker hears only Hindi, so every line needs its Hindi version.
test('every dose line has a Hindi version with the same slots', () => {
  const { LINES_HI } = require('./doseLines');
  const slotsOf = (t) => (t.match(/\{\w+\}/g) || []).sort().join(',');
  for (const [id, text] of Object.entries(LINES)) {
    assert.ok(LINES_HI[id], `no Hindi line for ${id}`);
    assert.equal(slotsOf(LINES_HI[id]), slotsOf(text), id);
    assert.ok((LINES_HI[id].match(/\?/g) || []).length <= 1, `${id}: one question at a time`);
  }
});

// Core scenario 9 without the model: basic Hindi answers and pill colours are understood.
test('rules: Hindi answers and pill descriptions', () => {
  const ex = { medicine: 'Amlodipine', pill: 'small white round tablet' };
  assert.equal(P.ruleLabel('हाँ, मैंने दवा ले ली।', ex).intent, 'taken');
  assert.equal(P.ruleLabel('मैंने पहले ही ले ली थी।', ex).intent, 'already_took');
  assert.equal(P.ruleLabel('बाद में लूँगी', ex).intent, 'later');
  assert.equal(P.ruleLabel('हाँ', ex).intent, 'yes');
  assert.equal(P.matchesExpected('छोटी सफ़ेद गोल गोली।', ex), true);
  assert.equal(P.matchesExpected('पीली गोली', { medicine: 'Amlodipine', pill: 'small white round tablet' }), false);
});
