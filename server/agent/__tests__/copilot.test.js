// Offline tests for the caregiver copilot's rules (fix 9). Replaces Person B's script. The full
// agent (tools, two reviews, release/withhold) is checked live by scripts/copilot-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../services/copilotService');

test('dosing questions are caught (only her doctor decides); care questions are not', () => {
  for (const q of ['Can I increase his Donepezil dose from 5mg to 10mg?', 'Should I give him half a sleeping pill tonight?', 'Can we skip her morning blood pressure tablet?', 'How many tablets of Dolo can I give her?', 'Can I stop the Atorvastatin for a week?', 'Should she take an extra pill if she missed one?'])
    assert.equal(C.isDosingQuery(q), true, q);
  for (const q of ['How can I help her remember her routine?', 'Did she take her pills today?', 'Why is she upset in the evenings?', 'She refuses to bathe, what do I do?'])
    assert.equal(C.isDosingQuery(q), false, q);
});

test('off-topic only when clearly off-topic (a data question with no care words is fine)', () => {
  assert.equal(C.isOffTopic('What is the current price of bitcoin?'), true);
  assert.equal(C.isOffTopic('Write a python script for sorting arrays'), true);
  assert.equal(C.isOffTopic('How was her week?'), false);
  assert.equal(C.isOffTopic('My father is having trouble sleeping at night'), false);
});

test('modes: listen for distress, coach for how-to, relate for "is it normal", else inform', () => {
  assert.equal(C.classifyMode('I feel so exhausted and I cried today, I cannot cope anymore'), 'listen');
  assert.equal(C.classifyMode('How do I handle her refusal to take a bath?'), 'coach');
  assert.equal(C.classifyMode('Is it normal to feel terrible about this?'), 'relate');
  assert.equal(C.classifyMode('Tell me about sundowning'), 'inform');
});

test('the code guard catches medicine advice in an answer, not "ask her doctor"', () => {
  assert.equal(C.givesMedicineAdvice('You can give her 10 mg instead.'), true);
  assert.equal(C.givesMedicineAdvice('Try giving her an extra tablet in the evening.'), true);
  assert.equal(C.givesMedicineAdvice('Reduce the dose to half on bad days.'), true);
  assert.equal(C.givesMedicineAdvice('Only her doctor can decide about changing the dose. She took 6 of 7 doses this week [record: dose history].'), false);
  assert.equal(C.givesMedicineAdvice('Keep the evening routine calm and lights bright [guide:nice_sundowning_01].'), false);
});

test("the model's final JSON is read; citations only name real library entries", () => {
  const f = C.parseFinal('Looked it up.\n{"mode": "coach", "answer": "Keep lights bright [guide:nice_sundowning_01].", "sources": ["guide:nice_sundowning_01", "guide:made_up_99", "record:dose_history"]}');
  assert.equal(f.mode, 'coach');
  assert.match(f.answer, /lights bright/);
  const cites = C.citationsFor(f.sources);
  assert.deepEqual(cites.map((c) => c.id), ['nice_sundowning_01', 'records'], 'an unknown guide id is dropped');
  assert.equal(C.parseFinal(''), null, 'no reply: nothing to show');
});

// copilot check, 22 Nov: a rewritten draft "Give her an extra tablet in the evening." passed the
// first guard. Sentence by sentence now; deferring to the doctor is not advice.
test('the guard: any instruction to give, stop, skip or change a medicine; facts and "ask the doctor" pass', () => {
  for (const a of ['Give her an extra tablet in the evening.', 'Stop the Atorvastatin for a few days.', 'Split the pill in half so it is easier to swallow.', 'Offer a second dose if she seems restless.'])
    assert.equal(C.givesMedicineAdvice(a), true, a);
  for (const a of ['Do not stop her medicine without asking her doctor.', 'She takes Donepezil 5mg at 8 pm [record: dose history].', 'She took 6 of 7 doses this week [record: dose history].', 'Ask her doctor whether a different time would suit her better.'])
    assert.equal(C.givesMedicineAdvice(a), false, a);
});
