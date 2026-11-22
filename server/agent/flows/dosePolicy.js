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
const MAX_CALL_ATTEMPTS = 3; // first call + 2 retries (A4.1), then the caregiver

// ── understanding: the rule-based fallback ───────────────────────────────────

const has = (t, words) => words.some((w) => t.includes(w));

// Does the text name the expected medicine, or describe the pill? expected = { medicine, pill }
function matchesExpected(text, expected = {}) {
  const t = ` ${String(text || '').toLowerCase()} `;
  const name = String(expected.medicine || '').toLowerCase().split(/\s+/)[0];
  if (name && name.length >= 3 && t.includes(name)) return true;
  const describe = String(expected.pill || '').toLowerCase().split(/[\s,]+/).filter((w) => w.length >= 3 && !['the', 'and', 'one', 'pill', 'tablet'].includes(w));
  return describe.length > 0 && describe.some((w) => t.includes(` ${w} `) || t.includes(` ${w},`) || t.includes(` ${w}.`));
}

// A simple English labeller, used when the model is unavailable (rate limit, timeout). It only has
// to be safe: when in doubt it says 'unclear', which re-asks and then hands over.
function ruleLabel(text, expected = {}) {
  const t = ` ${String(text || '').toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ')} `;
  const pill = matchesExpected(text, expected);
  const label = (intent, confidence = 0.7) => ({ intent, pill_mentioned: pill ? expected.medicine || null : null, matches_expected: pill, confidence, source: 'rules' });

  if (!t.trim()) return label('unclear', 0.3);
  if (has(t, [' already took', ' already taken', ' already had', ' took it this morning', ' took it earlier', ' took it before'])) return label('already_took');
  if (has(t, [" can't find", ' cannot find', " don't know where", ' where is', ' where are', ' lost '])) return label('cant_find');
  if (has(t, [" won't take", ' will not take', " don't want", ' do not want', ' skip ', ' not taking', " i'm not going to"])) return label('refuse');
  if (has(t, [' taking it now', ' about to ', ' going to take', ' getting it', ' one minute', ' wait '])) return label('taking_now');
  if (has(t, [' later', ' after food', ' after lunch', ' after dinner', ' call me back', ' not now', ' not yet'])) return label('later');
  if (has(t, [" don't remember", ' not sure', " don't know", ' i forgot', ' confused'])) return label('unsure');
  if (has(t, [' took it', ' have taken', " i've taken", ' taken it', ' just took', ' done ', ' i took', ' swallowed'])) return label('taken');
  if (pill) return label('taken', 0.6);
  if (/\?\s*$/.test(String(text).trim()) || has(t, [' what ', ' why ', ' when ', ' who ', ' how '])) return label('question', 0.6);
  if (has(t, [' yes ', ' yeah ', ' yep ', ' ok ', ' okay ', ' haan ', ' ha '])) return label('yes', 0.6);
  if (has(t, [' no ', ' nope ', ' nahi '])) return label('no', 0.6);
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

module.exports = { INTENTS, MIN_CONFIDENCE, MAX_CALL_ATTEMPTS, matchesExpected, ruleLabel, normaliseLabel, newState, greetLine, decide };
