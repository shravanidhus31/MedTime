// Offline tests for the weekly chat call's language measures (Feature 1, the paper's Appendix 9).
const test = require('node:test');
const assert = require('node:assert/strict');
const { languageMeasures, tokens, mtld, hdd } = require('./languageMeasures');

const RICH = 'First I fill the small steel pan with water and put it on the stove. When it starts boiling I add crushed ginger, two cardamom pods and a spoon of tea leaves. Then I pour in fresh milk from the packet, add sugar, and let everything simmer slowly until the colour turns golden brown. Finally I strain it into my favourite cup and sit near the window.';
const POOR = 'I make the tea. I make the tea with the water. The water and the tea. I make it, I make it with the water and the tea and the milk. The milk and the tea. I make the tea with the milk and the water and the tea. The tea is the tea. I make it.';

test('under 50 words: nothing is measured', () => {
  assert.equal(languageMeasures('I make tea with milk and sugar every morning.'), null);
});

test('the paper\'s measures: richer speech scores higher on MTLD, HD-D and CTTR, lower on Brunet\'s W', () => {
  const rich = languageMeasures(RICH);
  const poor = languageMeasures(POOR);
  assert.ok(rich.wordCount >= 50 && poor.wordCount >= 50);
  assert.ok(rich.mtld > poor.mtld, `MTLD ${rich.mtld} > ${poor.mtld}`);
  assert.ok(rich.hdd > poor.hdd, `HD-D ${rich.hdd} > ${poor.hdd}`);
  assert.ok(rich.cttr > poor.cttr, `CTTR ${rich.cttr} > ${poor.cttr}`);
  assert.ok(rich.brunetW < poor.brunetW, `Brunet ${rich.brunetW} < ${poor.brunetW} (lower = richer)`);
  assert.ok(rich.nounShare > 0.15 && rich.verbShare > 0.05, 'English: noun and verb share');
});

test('MTLD and HD-D on known cases', () => {
  const same = Array(60).fill('tea');
  assert.equal(mtld(same), 2, 'one word repeated: a new factor every 2 words, MTLD 2');
  const allDifferent = Array.from({ length: 60 }, (_, i) => `w${i}x`);
  assert.ok(Math.abs(hdd(allDifferent) - 1) < 1e-9, 'every word different: HD-D 1');
  assert.equal(hdd(allDifferent.slice(0, 30)), null, 'HD-D needs 42 words');
});

test('repetitions, fillers, Hindi', () => {
  const m = languageMeasures(`${RICH} Um, the the tea is, you know, ready ready.`);
  assert.equal(m.repeatedPhrasesCount, 2);
  assert.equal(m.fillersCount, 2);
  const hi = 'सुबह मैं पहले पानी उबालती हूँ फिर उसमें अदरक और इलायची डालती हूँ उसके बाद चाय पत्ती और दूध डालकर धीमी आँच पर पकाती हूँ जब रंग अच्छा हो जाता है तो चीनी डालकर छान लेती हूँ और अपनी पसंद वाले कप में बालकनी में बैठकर आराम से पीती हूँ मेरी बेटी को भी मेरी चाय बहुत पसंद है वो कहती है माँ आपकी चाय सबसे अच्छी है';
  const h = languageMeasures(hi);
  assert.ok(tokens(hi).length >= 50 && h.mtld > 0 && h.cttr > 0);
  assert.equal(h.nounShare, undefined, 'Hindi: no part-of-speech shares');
});
