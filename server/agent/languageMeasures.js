// Language measures for the weekly chat call (Feature 1, plan 6.5), from the speech-screening paper
// (arXiv 2509.03525, Appendix 9): length-corrected vocabulary (MTLD, HD-D, Brunet's index, CTTR),
// noun and verb share, back-to-back repeated phrases. Plus the plan's additions: fillers and
// word-finding phrases, nothing measured under 50 words. Pure, unit-tested (languageMeasures.test.js).
//
//   languageMeasures(text) → null (under 50 words) | { wordCount, mtld, hdd, brunetW, cttr,
//                             nounShare?, verbShare?, repeatedPhrasesCount, fillersCount, method }
// Noun/verb share only for English (the `compromise` tagger; the plan names Stanza, a Python
// library); Hindi text gets the vocabulary measures only. Never a diagnosis: these are compared
// with her own earlier weeks by the weekly review.

const MIN_WORDS = 50;
const MTLD_THRESHOLD = 0.72;
const HDD_SAMPLE = 42;
const FILLERS = /\b(um+|uh+|er+|erm|hmm+|you know|what'?s it called|what do you call it|that thing|i mean)\b|(^|\s)(वो वो|क्या कहते हैं|मतलब)(?=\s|$)/gi;

const tokens = (text) => String(text || '').toLowerCase()
  .replace(/[।॥]/g, ' ')
  .split(/[^a-z0-9'ऀ-ॿ]+/)
  .map((w) => w.replace(/^'+|'+$/g, ''))
  .filter((w) => /[a-zऀ-ॿ]/.test(w));

// One pass of MTLD (McCarthy & Jarvis 2010): how many words, on average, keep the type-token ratio
// above 0.72; the leftover counts as a partial factor.
function mtldPass(ws) {
  let factors = 0;
  let types = new Set();
  let count = 0;
  for (const w of ws) {
    count += 1;
    types.add(w);
    if (types.size / count <= MTLD_THRESHOLD) { factors += 1; types = new Set(); count = 0; }
  }
  if (count > 0) factors += (1 - types.size / count) / (1 - MTLD_THRESHOLD);
  return factors > 0 ? ws.length / factors : ws.length;
}
const mtld = (ws) => (mtldPass(ws) + mtldPass([...ws].reverse())) / 2;

// HD-D (McCarthy & Jarvis 2007): for each word type, the chance it appears in a random sample of
// 42 words (hypergeometric), summed and divided by 42.
function hdd(ws) {
  const n = ws.length;
  if (n < HDD_SAMPLE) return null;
  const freq = new Map();
  for (const w of ws) freq.set(w, (freq.get(w) || 0) + 1);
  let sum = 0;
  for (const f of freq.values()) {
    let pNone = 1; // P(the type is absent from the 42-word sample)
    for (let i = 0; i < HDD_SAMPLE; i += 1) pNone *= Math.max(0, (n - f - i) / (n - i));
    sum += (1 - pNone) / HDD_SAMPLE;
  }
  return sum;
}

// Back-to-back repeated words or 2-3 word phrases ("the the", "I went I went").
function repeats(ws) {
  let k = 0;
  for (const size of [1, 2, 3]) {
    for (let i = 0; i + 2 * size <= ws.length; i += 1) {
      const a = ws.slice(i, i + size).join(' ');
      if (a === ws.slice(i + size, i + 2 * size).join(' ') && (size > 1 || a.length > 2)) { k += 1; i += size; }
    }
  }
  return k;
}

function partsOfSpeech(text) {
  try {
    const nlp = require('compromise');
    const terms = nlp(String(text)).terms().json().map((t) => t.terms[0]).filter(Boolean);
    if (!terms.length) return {};
    const nouns = terms.filter((t) => t.tags.includes('Noun') && !t.tags.includes('Pronoun')).length;
    const verbs = terms.filter((t) => t.tags.includes('Verb')).length;
    return { nounShare: nouns / terms.length, verbShare: verbs / terms.length };
  } catch {
    return {};
  }
}

const r3 = (x) => (x === null || x === undefined ? x : Math.round(x * 1000) / 1000);

function languageMeasures(text) {
  const ws = tokens(text);
  const n = ws.length;
  if (n < MIN_WORDS) return null;
  const v = new Set(ws).size;
  const out = {
    wordCount: n,
    mtld: r3(mtld(ws)),
    hdd: r3(hdd(ws)),
    brunetW: r3(n ** (v ** -0.165)),
    cttr: r3(v / Math.sqrt(2 * n)),
    repeatedPhrasesCount: repeats(ws),
    fillersCount: (String(text).match(FILLERS) || []).length,
    method: 'language-measures@1',
  };
  if (!/[ऀ-ॿ]/.test(String(text))) {
    const pos = partsOfSpeech(text);
    if (pos.nounShare !== undefined) { out.nounShare = r3(pos.nounShare); out.verbShare = r3(pos.verbShare); }
  }
  return out;
}

module.exports = { languageMeasures, tokens, mtld, hdd, MIN_WORDS };
