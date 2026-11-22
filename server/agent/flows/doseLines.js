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
  // she is about to take a dose that is already recorded (core scenario 4): stop, family told
  'dose.already_taken_stop': "{name}, your {medicine} is already recorded as taken today. Please don't take another one. I'll let {caregiver} know. Goodbye.",
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

  // Follow-ups between calls (A4.3): asked once, after the dose is recorded. Only ask, never advise.
  'dose.praise_short': "That's right. Well done, {name}.",
  'followup.knee': 'Last time you said your knee was hurting. Is it better today?',
  'followup.back': 'Last time you said your back was hurting. Is it better today?',
  'followup.headache': 'Last time you said you had a headache. Is it better today?',
  'followup.stomach': 'Last time you said your stomach was upset. Is it better today?',
  'followup.sleep': "Last time you said you weren't sleeping well. Are you sleeping better now?",
  'followup.appetite': "Last time you said you weren't feeling hungry. Are you eating better now?",
  'followup.feeling_low': 'Last time you said you were feeling low. Are you feeling a little better today?',
  'followup.visit': 'Last time you said someone was coming to visit. Did they come?',
  'followup.glad': "I'm glad to hear that. Goodbye for now.",
  'followup.noted': "Thank you for telling me. I'll let {caregiver} know. Goodbye for now.",
};

// The same lines in Hindi (Patient.language 'hi'; core scenario 9: "replies in Hindi, same
// decisions"). Same ids and slots; the decisions don't change. Polite "aap" forms that read the
// same for any gender of the listener; the agent speaks as a woman (the neutral Hindi voice).
// Marathi is not written yet: a Marathi patient hears English.
const LINES_HI = {
  'dose.greet.calm': 'नमस्ते {name} जी। {slot} की दवा, {medicine}, लेने का समय हो गया है।{food} क्या आप अभी दवा लेकर मुझे बता सकते हैं?',
  'dose.greet.firmer': '{name} जी, मैं फिर से बोल रही हूँ। आपकी {medicine} अभी बाकी है।{food} क्या आप अभी दवा लेकर मुझे बता सकते हैं?',
  'dose.greet.concerned': '{name} जी, मुझे थोड़ी चिंता हो रही है। आपने अभी तक {medicine} नहीं ली है।{food} क्या आप अभी दवा लेकर मुझे बता सकते हैं?',
  'dose.already_done': '{name} जी, आज की {medicine} हो चुकी है। कृपया दूसरी गोली मत लीजिए। नमस्ते।',
  'dose.already_taken_stop': '{name} जी, आज की {medicine} पहले ही ली जा चुकी है। कृपया दूसरी गोली मत लीजिए। मैं {caregiver} को बता रही हूँ। नमस्ते।',
  'dose.take_your_time': 'कोई जल्दी नहीं। दवा लेने के बाद मुझे बताइए।',
  'dose.check_question': 'बहुत अच्छा। आपने कौन सी गोली ली?',
  'dose.check_reask': 'आपने अभी कौन सी गोली ली?',
  'dose.check_hint': 'आपकी {medicine} ऐसी दिखती है: {pill}। आपने कौन सी गोली ली?',
  'dose.praise': 'बिल्कुल सही। शाबाश, {name} जी। फिर बात करेंगे।',
  'dose.hint_location': 'अपनी {medicine} यहाँ देखिए: {location}। क्या आपको मिल गई?',
  'dose.hint_pillbox': 'अपने पिलबॉक्स में देखिए: {box}। क्या आपको मिल गई?',
  'dose.hint_pill': 'आपकी {medicine} ऐसी दिखती है: {pill}। क्या आपको मिल गई?',
  'dose.hint_generic': 'आपकी {medicine} बाकी दवाइयों के साथ रखी है। क्या आपको मिल गई?',
  'dose.reask': 'क्या आपने अपनी {medicine} ले ली है?',
  'dose.sorry_reask': 'माफ़ कीजिए, मैं समझ नहीं पाई। क्या आपने अपनी {medicine} ले ली है?',
  'dose.redirect': 'मैं इसके बारे में {caregiver} से पूछूँगी। पहले दवा पूरी कर लेते हैं।',
  'dose.unsafe': 'यह बात डॉक्टर या {caregiver} से पूछनी होगी। पहले दवा पूरी कर लेते हैं।',
  'dose.call_back': 'ठीक है। मैं दस मिनट में फिर फ़ोन करूँगी। नमस्ते।',
  'dose.ok_skip': 'कोई बात नहीं, {name} जी। मैं {caregiver} को बता दूँगी। नमस्ते।',
  'dose.dont_take_another': 'कृपया दूसरी गोली मत लीजिए। मैं {caregiver} से आपसे बात करने को कहूँगी। नमस्ते।',
  'dose.handover': '{caregiver} जल्दी ही आपको फ़ोन करके मदद करेंगे। तब तक कोई दवा मत लीजिए। नमस्ते।',
  'dose.handover_unsure': 'अभी और गोलियाँ मत लीजिए। {caregiver} आपको फ़ोन करके पूछेंगे। नमस्ते।',
  'dose.praise_short': 'बिल्कुल सही। शाबाश, {name} जी।',
  'followup.knee': 'पिछली बार आपने कहा था कि आपके घुटने में दर्द है। क्या आज कुछ आराम है?',
  'followup.back': 'पिछली बार आपने कहा था कि आपकी कमर में दर्द है। क्या आज कुछ आराम है?',
  'followup.headache': 'पिछली बार आपने कहा था कि आपके सिर में दर्द है। क्या आज कुछ आराम है?',
  'followup.stomach': 'पिछली बार आपने कहा था कि आपका पेट ठीक नहीं है। क्या आज कुछ आराम है?',
  'followup.sleep': 'पिछली बार आपने कहा था कि आपको नींद ठीक से नहीं आ रही। क्या अब नींद बेहतर है?',
  'followup.appetite': 'पिछली बार आपने कहा था कि आपको भूख नहीं लग रही। क्या अब ठीक से खा पा रहे हैं?',
  'followup.feeling_low': 'पिछली बार आपने कहा था कि आपका मन उदास है। क्या आज मन कुछ बेहतर है?',
  'followup.visit': 'पिछली बार आपने कहा था कि कोई आपसे मिलने आने वाला है। क्या वे आए?',
  'followup.glad': 'यह सुनकर अच्छा लगा। फिर बात करेंगे।',
  'followup.noted': 'बताने के लिए धन्यवाद। मैं {caregiver} को बता दूँगी। फिर बात करेंगे।',
};
const BANKS = { en: LINES, hi: LINES_HI };

const capitalise = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// Text of a line with its slots filled. Unknown slots are left empty; each sentence starts with a
// capital letter (so "{caregiver} will call" reads "Your family will call").
function render(lineId, slots = {}, lang = 'en') {
  const template = (BANKS[lang] || LINES)[lineId] || LINES[lineId];
  if (!template) throw new Error(`Unknown dose line: ${lineId}`);
  const text = template.replace(/\{(\w+)\}/g, (_, k) => (slots[k] === undefined || slots[k] === null ? '' : String(slots[k])));
  return text.replace(/\s+/g, ' ').trim().replace(/(^|[.?!]\s+)([a-z])/g, (m, p, c) => p + c.toUpperCase());
}

// The orchestrator action for a line (contract C8). `text` is the rendered line: the voice front
// ends speak it in the neutral voice until the phrase-bank resolver (A5.5) supplies family audio.
const line = (lineId, slots, lang = 'en') => ({ type: 'play', lineId, slots, lang, text: render(lineId, slots, lang) });

module.exports = { LINES, LINES_HI, render, line, capitalise };
