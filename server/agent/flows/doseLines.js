// The fixed lines of the dose call (A4.1). Everything the dose agent says comes from here, by
// line id, so the family voice (Phase 3) only ever says approved lines. A5.1 moves these into the
// phrase-bank catalogue (contract C7, voice/phrasebank/catalogue.json); the ids stay the same.
//
// Rules from CHI 2025 (plan 6.6): one question at a time and nothing after it, one precaution
// only, say why before asking. Lines that end the call end with "Goodbye".
//
// Slots (filled from the patient's own data, so every value can be pre-rendered later):
//   {name}       her first name
//   {medicine}   the medicine name
//   {pill}       how the pill looks, e.g. "small round white tablet" (only in lines used when it's set)
//   {slot}       time of day ("morning", "evening")
//   {box}        the pillbox compartment, e.g. "Morning, Compartment 1" (only when set)
//   {food}       ' Please take it after food.' etc., or ''
//   {caregiver}  the primary caregiver's first name, or 'your family'
//   {location}   where the pills are kept, e.g. "kitchen table beside the kettle" (only when set)
// The caregiver types the pill, box and location details freely (Person B's medicine form), so
// lines use them as separate phrases rather than inside a sentence (A3.2 test: "the Small round
// white film-coated tablet with 5 debossed Donepezil" and "Your Donepezil is Kitchen table").

const LINES = {
  // reminders, by attempt: calm → firmer → concerned (CHI 2025: change tone after unanswered reminders)
  'dose.greet.calm': "Hello {name}. It's time for your {slot} medicine, {medicine}.{food} Can you take it now, and tell me when it's done?",
  'dose.greet.firmer': "{name}, it's me again. Your {medicine} is still waiting for you.{food} Can you take it now, and tell me when it's done?",
  'dose.greet.concerned': "{name}, I'm a little worried. You haven't taken your {medicine} yet.{food} Can you take it now, and tell me when it's done?",

  'dose.already_done': "{name}, your {medicine} is already done for today. Please don't take another one. Goodbye.",
  'dose.take_your_time': "Take your time. Tell me when you've taken it.",
  'dose.check_question': 'Well done. Which tablet did you take?',
  'dose.check_reask': 'Which tablet did you just take?',
  // asks her to name it again: a bare "yes" to a leading question isn't proof (A4.1 live check)
  'dose.check_hint': 'Your {medicine} looks like this: {pill}. Which tablet did you take?',
  'dose.praise': "That's right. Well done, {name}. Goodbye for now.",

  'dose.hint_location': 'Look for your {medicine} here: {location}. Can you find it?',
  'dose.hint_pillbox': 'Look in your pillbox: {box}. Can you find it?',
  'dose.hint_pill': 'Your {medicine} looks like this: {pill}. Can you find it?',
  'dose.hint_generic': 'Your {medicine} is with your other medicines. Can you find it?',

  'dose.reask': 'Have you taken your {medicine}?',
  'dose.sorry_reask': "Sorry, I didn't catch that. Have you taken your {medicine}?",
  // said before a re-ask line (dose.reask or dose.check_reask), so the question comes last
  'dose.redirect': "I'll ask {caregiver} about that. Let's finish your pills first.",
  'dose.unsafe': "That's one for your doctor or {caregiver}. Let's finish your pills first.",

  'dose.call_back': "All right. I'll call you again in ten minutes. Goodbye.",
  'dose.ok_skip': "That's all right, {name}. I'll let {caregiver} know. Goodbye.",
  'dose.dont_take_another': "Please don't take another one. I'll ask {caregiver} to check with you. Goodbye.",
  'dose.handover': "{caregiver} will call you soon to help. Please don't take anything until then. Goodbye.",
  'dose.handover_unsure': "Please don't take any more tablets now. {caregiver} will call you to check. Goodbye.",
};

const capitalise = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// Text of a line with its slots filled. Unknown slots are left empty; each sentence starts with a
// capital letter (so "{caregiver} will call" reads "Your family will call").
function render(lineId, slots = {}) {
  const template = LINES[lineId];
  if (!template) throw new Error(`Unknown dose line: ${lineId}`);
  const text = template.replace(/\{(\w+)\}/g, (_, k) => (slots[k] === undefined || slots[k] === null ? '' : String(slots[k])));
  return text.replace(/\s+/g, ' ').trim().replace(/(^|[.?!]\s+)([a-z])/g, (m, p, c) => p + c.toUpperCase());
}

// The orchestrator action for a line (contract C8). `text` is the rendered line: the voice front
// ends speak it in the neutral voice until the phrase-bank resolver (A5.5) supplies family audio.
const line = (lineId, slots) => ({ type: 'play', lineId, slots, text: render(lineId, slots) });

module.exports = { LINES, render, line, capitalise };
