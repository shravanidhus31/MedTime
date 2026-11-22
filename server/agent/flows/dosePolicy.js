// What the dose agent does next (A4.1). Pure functions: no database, no model, so every rule
// here is unit-tested (dosePolicy.test.js).
//
// Each patient turn: a label says what she meant (from the fast-tier model, or ruleLabel() when
// the model is unavailable), then decide() picks the lines to say, the tools to run and the next
// phase. The rules are the PRD call flow and plan section 6.1, in code, so the model can't skip
// them:
//   - a dose is recorded only after the check question is answered with the right pill
//   - "I already took it": the log decides. Recorded → "don't take another one".
//     Not recorded → "Please don't take another one", the caregiver is phoned and asked.
//   - "I'm taking it now" is not "I've taken it"
//   - can't find it / unsure: a hint, and after two failures a hand-over to the caregiver
//   - a question is answered with a redirect; an unsafe request gets a polite refusal
//   - the whole call fits the 8-turn phone budget (A3.5): near the end, hand over

const INTENTS = ['taken', 'taking_now', 'already_took', 'later', 'refuse', 'cant_find', 'unsure', 'question', 'yes', 'no', 'unclear'];
const MIN_CONFIDENCE = 0.5;
// Answers after which the dose log is checked before deciding (the flow runs check_double_dose).
const LOG_CHECK_INTENTS = ['already_took', 'taken', 'yes', 'taking_now', 'cant_find', 'unsure'];
const MAX_CALL_ATTEMPTS = 3; // first call + 2 retries (A4.1), then the caregiver

// ── understanding: the rule-based fallback ───────────────────────────────────

const has = (t, words) => words.some((w) => t.includes(w));

// Hindi words for how a pill looks, read as the English words the caregiver typed (core scenario 9).
const HINDI_LOOKS = { 'सफ़ेद': 'white', 'सफेद': 'white', 'छोटी': 'small', 'छोटा': 'small', 'बड़ी': 'large', 'बड़ा': 'large', 'बडी': 'large', 'गोल': 'round', 'पीली': 'yellow', 'पीला': 'yellow', 'गुलाबी': 'pink', 'लाल': 'red', 'नीली': 'blue', 'नीला': 'blue', 'लंबी': 'oval', 'हरी': 'green', 'नारंगी': 'orange' };
// The same words as Hindi speech recognition may write them in English letters ("chhoti safed").
const HINGLISH_LOOKS = { safed: 'white', safaid: 'white', sufaid: 'white', chhoti: 'small', choti: 'small', chhota: 'small', chota: 'small', badi: 'large', bada: 'large', badee: 'large', gol: 'round', peeli: 'yellow', pili: 'yellow', peela: 'yellow', laal: 'red', lal: 'red', neeli: 'blue', nili: 'blue', neela: 'blue', gulabi: 'pink', hari: 'green', narangi: 'orange' };
const fromHindi = (text) => String(text || '')
  .replace(/[\u0900-\u0963\u0966-\u097F]+/g, (w) => HINDI_LOOKS[w] || w)
  .replace(/[\u0964\u0965]/g, ' ')
  .replace(/\b[a-z]+\b/gi, (w) => HINGLISH_LOOKS[w.toLowerCase()] || w);

// The consonant sound-skeleton of a word, in Latin or Devanagari, so a medicine name written in
// Devanagari by Hindi speech recognition matches the English name ("\u090F\u092E\u094D\u0932\u094B\u0921\u093F\u092A\u093F\u0928" = Amlodipine \u2192
// "mldpn"; "\u0915\u094D\u0930\u094B\u0938\u093F\u0928" = Crocin \u2192 "krsn"). Vowels and h are dropped; similar sounds merge.
const DEVA = {
  '\u0915': 'k', '\u0916': 'k', '\u0917': 'g', '\u0918': 'g', '\u091A': 'c', '\u091B': 'c', '\u091C': 'j', '\u091D': 'j', '\u091F': 't', '\u0920': 't', '\u0921': 'd', '\u0922': 'd',
  '\u0923': 'n', '\u0924': 't', '\u0925': 't', '\u0926': 'd', '\u0927': 'd', '\u0928': 'n', '\u092A': 'p', '\u092B': 'f', '\u092C': 'b', '\u092D': 'b', '\u092E': 'm', '\u092F': 'y',
  '\u0930': 'r', '\u0932': 'l', '\u0935': 'v', '\u0936': 's', '\u0937': 's', '\u0938': 's', '\u0902': 'n', '\u0901': 'n',
};
function soundSkeleton(word) {
  const w = String(word || '').toLowerCase();
  let out;
  if (/[\u0900-\u097F]/.test(w)) {
    out = [...w.normalize('NFD')].map((ch) => DEVA[ch] || '').join('');
  } else {
    out = w.replace(/ph/g, 'f').replace(/ch/g, 'c').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/q/g, 'k')
      .replace(/x/g, 'ks').replace(/z/g, 'j').replace(/w/g, 'v').replace(/[^a-z]/g, '').replace(/[aeiouyh]/g, '');
  }
  return out.replace(/(.)\1+/g, '$1'); // "tt" \u2192 "t"
}

// Does the text name the expected medicine, or describe the pill? expected = { medicine, pill }
function matchesExpected(text, expected = {}) {
  const t = ` ${fromHindi(text).toLowerCase()} `;
  const name = String(expected.medicine || '').toLowerCase().split(/\s+/)[0];
  if (name && name.length >= 3 && t.includes(name)) return true;
  // The name as it sounds (Devanagari, or a misspelling). Three sounds at least: a two-sound name
  // ("dolo" \u2192 "dl") could match an everyday word ("\u0926\u093F\u0932", heart).
  const nameSkel = soundSkeleton(name);
  if (nameSkel.length >= 3 && String(text || '').split(/[\s,.!?\u0964]+/).some((w) => soundSkeleton(w) === nameSkel)) return true;
  const describe = String(expected.pill || '').toLowerCase().split(/[\s,]+/).filter((w) => w.length >= 3 && !['the', 'and', 'one', 'pill', 'tablet'].includes(w));
  return describe.length > 0 && describe.some((w) => t.includes(` ${w} `) || t.includes(` ${w},`) || t.includes(` ${w}.`));
}

// A simple English labeller, used when the model is unavailable (rate limit, timeout). It only has
// to be safe: when in doubt it says 'unclear', which re-asks and then hands over.
function ruleLabel(text, expected = {}) {
  // Devanagari is kept (Hindi answers, core scenario 9); the danda and other punctuation are not.
  const t = ` ${String(text || '').toLowerCase().replace(/[’']/g, "'").replace(/[\u0964\u0965]/g, ' ').replace(/[^a-z0-9'\u0900-\u097F ]+/g, ' ').replace(/\s+/g, ' ')} `;
  const pill = matchesExpected(text, expected);
  const label = (intent, confidence = 0.7) => ({ intent, pill_mentioned: pill ? expected.medicine || null : null, matches_expected: pill, confidence, source: 'rules' });

  if (!t.trim()) return label('unclear', 0.3);
  if (has(t, [' already took', ' already taken', ' already had', ' took it this morning', ' took it earlier', ' took it before', ' पहले ही ', ' pehle hi ', ' subah hi '])) return label('already_took');
  if (has(t, [" can't find", ' cannot find', " don't know where", ' lost ', ' नहीं मिल', ' nahi mil', ' nahin mil', ' दवा कहाँ', ' दवा कहां', ' दवाई कहाँ', ' दवाई कहां', ' गोली कहाँ', ' गोली कहां', ' dawai kahan', ' dawa kahan', ' goli kahan'])) return label('cant_find');
  // "where is it / my tablet" is about the pill; "Where is Ravi?" is a question (core scenario 5)
  const pillWords = [' it ', ' it?', ' them ', ' pill', ' tablet', ' medicine', ' box', ` ${String(expected.medicine || '').toLowerCase().split(/\s+/)[0] || 'x-none'}`];
  if (has(t, [' where is', ' where are', " where's"]) && has(`${t.replace(/\?/g, ' ? ')} `, pillWords)) return label('cant_find');
  if (has(t, [" won't take", ' will not take', " don't want", ' do not want', ' skip ', ' not taking', " i'm not going to"])) return label('refuse');
  // "found it" after a hint means she is about to take it (Hindi call test, 22 Nov: "मिल गई" was "unclear")
  if (has(t, [' taking it now', ' about to ', ' going to take', ' getting it', ' one minute', ' wait ', ' found it', ' got it', ' i have it', ' मिल गई', ' मिल गया', ' mil gayi ', ' mil gaya ', ' mil gai '])) return label('taking_now');
  if (has(t, [' later', ' after food', ' after lunch', ' after dinner', ' call me back', ' not now', ' not yet', ' बाद में ', ' baad mein ', ' baad me '])) return label('later');
  if (has(t, [" don't remember", ' not sure', " don't know", ' i forgot', ' confused'])) return label('unsure');
  if (has(t, [' took it', ' have taken', " i've taken", ' taken it', ' just took', ' done ', ' i took', ' swallowed', ' ले ली', ' ले लिया', ' खा ली', ' खा लिया', ' le li ', ' le liya ', ' kha li ', ' kha liya '])) return label('taken');
  if (pill) return label('taken', 0.6);
  if (/\?\s*$/.test(String(text).trim()) || has(t, [' what ', ' why ', ' when ', ' who ', ' how '])) return label('question', 0.6);
  if (has(t, [' yes ', ' yeah ', ' yep ', ' ok ', ' okay ', ' haan ', ' ha ', ' हाँ ', ' हां ', ' जी हाँ ', ' ठीक है '])) return label('yes', 0.6);
  if (has(t, [' no ', ' nope ', ' nahi ', ' नहीं '])) return label('no', 0.6);
  return label('unclear', 0.3);
}

// A model label with too little confidence counts as unclear.
function normaliseLabel(label) {
  if (!label || !INTENTS.includes(label.intent)) return { intent: 'unclear', pill_mentioned: null, matches_expected: false, confidence: 0 };
  if (typeof label.confidence === 'number' && label.confidence < MIN_CONFIDENCE) return { ...label, intent: 'unclear' };
  return label;
}

// ── deciding ─────────────────────────────────────────────────────────────────

const newState = () => ({ phase: 'reminder', waits: 0, findFails: 0, unclear: 0, checkFails: 0 });

// The reminder line for this attempt (1 calm, 2 firmer, 3+ concerned).
const greetLine = (attempt) => (attempt >= 3 ? 'dose.greet.concerned' : attempt === 2 ? 'dose.greet.firmer' : 'dose.greet.calm');

// state: from newState(); label: normalised; info: {
//   attempt,        this call's attempt number for the dose (1, 2, 3)
//   turnsLeft,      patient turns left in the call budget after this one
//   hasLocation, hasPillbox, hasPill,   which hint lines have data
//   recorded,       for 'already_took': is the dose recorded as taken? (the flow checks first)
//   unsafe,         the safety screen said 'unsafe' (e.g. a request to change a dose)
// }
// Returns { say: [lineId], tools: [{ name, input }], snooze, informCaregiver, end, state }.
// tool inputs for notify_caregiver/ask_caregiver carry a `why` code; the flow writes the words.
function decide(state, label, info = {}) {
  const s = { ...state };
  const out = (say, extra = {}) => ({ say, tools: [], snooze: false, informCaregiver: false, end: false, ...extra, state: s });
  const end = (say, tools = [], extra = {}) => out(say, { tools, end: true, ...extra });
  const handover = (why = 'handover', lineId = 'dose.handover') =>
    end([lineId], [{ name: 'notify_caregiver', input: { reason: why === 'unsure' ? 'unsure_dose' : 'handover', why } }], { informCaregiver: true });
  const reaskLine = s.phase === 'check' ? 'dose.check_reask' : 'dose.reask';

  // The safety screen flagged an unsafe request: refuse kindly, then back to the dose.
  if (info.unsafe) return out(['dose.unsafe', reaskLine]);

  const intent = label.intent;

  // ── after the check question ("Which tablet did you take?") ──
  if (s.phase === 'check') {
    if (label.matches_expected === true && !['refuse', 'no', 'unsure', 'cant_find', 'question'].includes(intent)) {
      return end(['dose.praise'], [{ name: 'mark_dose', input: { status: 'taken' } }]);
    }
    if (intent === 'question') return out(['dose.redirect', reaskLine]);
    s.checkFails += 1;
    if (s.checkFails >= 2 || info.turnsLeft <= 0) return handover('unsure', 'dose.handover_unsure');
    return out([info.hasPill ? 'dose.check_hint' : 'dose.check_reask']);
  }

  // ── after the reminder ("Can you take it now, and tell me when it's done?") ──
  // Already recorded (ticked in the app during the call, say) and she is about to take it, or
  // looking for it: stop, and tell the family (core scenario 4). "I already took it" is confirmed.
  if (info.recorded && LOG_CHECK_INTENTS.includes(intent)) {
    if (intent === 'already_took') return end(['dose.already_done']);
    return end(['dose.already_taken_stop'], [{ name: 'notify_caregiver', input: { reason: 'other', why: 'tried_again' } }], { informCaregiver: true });
  }

  switch (intent) {
    case 'taken':
    case 'yes':
      if (label.matches_expected === true && intent === 'taken') {
        // She named the right pill already: that answers the check question too.
        return end(['dose.praise'], [{ name: 'mark_dose', input: { status: 'taken' } }]);
      }
      s.phase = 'check';
      return out(['dose.check_question']);

    case 'taking_now':
      s.waits += 1;
      if (s.waits >= 2) {
        s.phase = 'check';
        return out(['dose.check_question']);
      }
      return out(['dose.take_your_time']);

    case 'already_took':
      if (info.recorded) return end(['dose.already_done']);
      return end(['dose.dont_take_another'], [
        { name: 'notify_caregiver', input: { reason: 'unsure_dose', why: 'claims_taken_not_recorded' } },
        { name: 'ask_caregiver', input: { why: 'claims_taken_not_recorded' } },
      ], { informCaregiver: true });

    case 'later':
    case 'no':
      if ((info.attempt || 1) >= MAX_CALL_ATTEMPTS) return handover();
      return end(['dose.call_back'], [], { snooze: true });

    case 'refuse':
      return end(['dose.ok_skip'], [
        { name: 'mark_dose', input: { status: 'skipped' } },
        { name: 'notify_caregiver', input: { reason: 'other', why: 'refused' } },
      ]);

    case 'cant_find':
    case 'unsure': {
      s.findFails += 1;
      if (s.findFails >= 2 || info.turnsLeft <= 0) return handover();
      if (info.hasLocation && s.findFails === 1) return out(['dose.hint_location']);
      if (info.hasPillbox) return out(['dose.hint_pillbox']);
      return out([info.hasPill ? 'dose.hint_pill' : 'dose.hint_generic']);
    }

    case 'question':
      if (info.turnsLeft <= 0) return handover();
      return out(['dose.redirect', reaskLine]);

    default: // unclear
      s.unclear += 1;
      if (s.unclear >= 2 || info.turnsLeft <= 0) return handover();
      return out(['dose.sorry_reask']);
  }
}

module.exports = { INTENTS, LOG_CHECK_INTENTS, MIN_CONFIDENCE, MAX_CALL_ATTEMPTS, matchesExpected, ruleLabel, normaliseLabel, newState, greetLine, decide };
