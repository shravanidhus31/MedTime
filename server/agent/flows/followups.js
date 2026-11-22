// Follow-ups between calls (A4.3): the fixed list of concerns, and the rules that find them in her
// words and read her answer. Pure functions, unit-tested (followups.test.js). The Planner
// (agent/planner.js) uses the smart-tier model first and these rules when it is unavailable.
//
// Plan 6.1 / MeBo: concerns come from a FIXED list, so every follow-up question is a fixed line
// (phrase bank). Follow-ups only ask, never advise; at most one per call, after the dose.

const CONCERNS = ['knee', 'back', 'headache', 'stomach', 'sleep', 'appetite', 'feeling_low', 'visit'];

// For the caregiver and the journal.
const CONCERN_WORDS = {
  knee: 'knee pain',
  back: 'back pain',
  headache: 'a headache',
  stomach: 'an upset stomach',
  sleep: 'trouble sleeping',
  appetite: 'not feeling hungry',
  feeling_low: 'feeling low',
  visit: 'a visit she was expecting',
};

const PAIN = /(hurt|pain|ache|aching|sore|swollen|stiff|dard|दर्द)/i;

// Each concern: words that name it (English, Hindi, Hinglish); body parts also need a pain word.
const RULES = [
  { concern: 'knee', re: /(\bknees?\b|घुटन|ghutn)/i, needsPain: true },
  { concern: 'back', re: /(\bmy back\b|\bback (pain|hurts|is hurting|aches)|backache|lower back|कमर|\bkamar\b)/i, needsPain: true },
  { concern: 'headache', re: /(headache|head (hurts|is hurting|aches|is paining)|सिर (में )?दर्द|sir ?dard|sar ?dard)/i },
  { concern: 'stomach', re: /(stomach|tummy|acidity|\bgas\b|पेट|\bpet\b)/i, needsPain: false, also: /(upset|pain|hurt|ache|acidity|gas|loose|vomit|dard|दर्द|खराब|kharab)/i },
  { concern: 'sleep', re: /(can'?t sleep|cannot sleep|couldn'?t sleep|could not sleep|did not sleep|not sleeping|didn'?t sleep|no sleep|trouble sleeping|awake all night|नींद नहीं|neend nahi)/i },
  { concern: 'appetite', re: /(not hungry|no appetite|lost my appetite|don'?t feel like eating|not eating|can'?t eat|भूख नहीं|bhook?h nahi)/i },
  { concern: 'feeling_low', re: /(feel(ing)? (so |very |a bit |quite |really )?(low|sad|lonely|down)|i'?m (so |very )?(sad|lonely)|depressed|उदास|अकेला|अकेली|\budaas\b|\bakela\b|\bakeli\b)/i },
  { concern: 'visit', re: /((coming|come) to (visit|see me)|will visit|visiting me|is coming (tomorrow|on|this|next)|are coming (tomorrow|on|this|next)|मिलने आ|milne aa)/i },
];

// She says it's fine ("my knee is fine now"): not a concern.
const FINE = /(is|are|feels?) (fine|better|okay|ok|good) (now|today)?|no (pain|problem)|ठीक है|theek hai/i;

// Concerns in what she said: [{ concern, quote }], at most one per concern, quote = her sentence.
function extractConcernsRules(lines) {
  const found = new Map();
  for (const line of lines || []) {
    const sentences = String(line || '').split(/(?<=[.!?।])\s+/).filter(Boolean);
    for (const s of sentences) {
      if (FINE.test(s)) continue;
      for (const r of RULES) {
        if (found.has(r.concern) || !r.re.test(s)) continue;
        if (r.needsPain && !PAIN.test(s)) continue;
        if (r.also && !r.also.test(s)) continue;
        found.set(r.concern, { concern: r.concern, quote: s.trim().slice(0, 200) });
      }
    }
  }
  return [...found.values()];
}

// Could this text contain a concern at all? (Saves a model call when it can't.)
const MAYBE = /(hurt|pain|ache|sore|swollen|stiff|sleep|hungry|appetite|eat|sad|lonely|low|down|depressed|visit|coming|stomach|tummy|head|knee|back|dard|दर्द|नींद|भूख|उदास|अकेल|मिलने|घुटन|कमर|पेट|सिर|neend|bhook|udaas|milne)/i;
const mayHaveConcern = (lines) => (lines || []).some((l) => MAYBE.test(String(l || '')));

// Her answer to "Is it better today?" (or, for a visit, "Did they come?").
//   'better'      → close (for a visit: it happened)
//   'not_better'  → stays open, asked again on another day (at most 3 times)
//   'unclear'     → stays open
function classifyAnswer(text, concern) {
  const t = ` ${String(text || '').toLowerCase().replace(/[।.,!?]/g, ' ').replace(/\s+/g, ' ')} `;
  if (!t.trim()) return 'unclear';
  if (concern === 'visit') {
    if (/( no | not | didn'?t | did not | nahi | नहीं | नहीं )/.test(t)) return 'not_better';
    if (/( yes | yeah | came | they did | he did | she did | visited | haan | हाँ | हां | आए | आई | aaye | aayi )/.test(t)) return 'better';
    return 'unclear';
  }
  if (/( not (better|good|fine|okay)| no | nope | still | worse | same | hurts | hurting | pain | paining | nahi | नहीं | अभी भी | वैसा ही | waisa hi | abhi bhi )/.test(t)) return 'not_better';
  if (/( better | fine | good | okay | ok | all right | alright | gone | much better | no pain | yes | yeah | haan | हाँ | हां | ठीक | बेहतर | आराम | theek | accha | achha )/.test(t)) return 'better';
  return 'unclear';
}

module.exports = { CONCERNS, CONCERN_WORDS, extractConcernsRules, mayHaveConcern, classifyAnswer };
