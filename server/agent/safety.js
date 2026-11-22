// Safety screen used by the orchestrator on every partial and final transcript (contract C9).
//
//   screen(text, ctx) → { verdict: 'ok' | 'redflag' | 'unsafe', category?, responseLineId?, neutralText? }
//
// The real screen is Person B's (C9: the GrandGuard-based screen and server/safety/redflags.json in
// English, Hindi and Marathi). Until it exists, this stand-in matches a short keyword list.
// It runs without an LLM, so it is instant. B swaps in the real one with:
//
//   setSafetyScreen(screen);

// Fixed red-flag responses from the PRD. Always spoken in the neutral voice, never the family voice.
const RESPONSES = {
  fall: {
    responseLineId: 'emergency.fall',
    neutralText: "I'm calling your family right now. Please stay where you are. Help is coming.",
    hiText: 'मैं अभी आपके परिवार को फ़ोन कर रही हूँ। कृपया वहीं रहिए। मदद आ रही है।',
  },
  chest_pain: {
    responseLineId: 'emergency.chest_pain',
    neutralText: "I'm calling your family right now. Please sit down and stay still. Help is coming.",
    hiText: 'मैं अभी आपके परिवार को फ़ोन कर रही हूँ। कृपया बैठ जाइए और हिलिए मत। मदद आ रही है।',
  },
  breathing: {
    responseLineId: 'emergency.breathing',
    neutralText: "I'm calling your family right now. Please sit down and stay still. Help is coming.",
    hiText: 'मैं अभी आपके परिवार को फ़ोन कर रही हूँ। कृपया बैठ जाइए और हिलिए मत। मदद आ रही है।',
  },
  extra_pills: {
    responseLineId: 'emergency.extra_pills',
    neutralText: "Please don't take any more pills. I'm calling your family right now.",
    hiText: 'कृपया और गोलियाँ मत लीजिए। मैं अभी आपके परिवार को फ़ोन कर रही हूँ।',
  },
  self_harm: {
    responseLineId: 'emergency.self_harm',
    neutralText: "You matter, and you're not alone. I'm calling your family right now. You can also call Tele-MANAS on 14416.",
    hiText: 'आप बहुत मायने रखते हैं, और आप अकेले नहीं हैं। मैं अभी आपके परिवार को फ़ोन कर रही हूँ। आप टेली-मानस पर 14416 पर भी फ़ोन कर सकते हैं।',
  },
  scam: {
    responseLineId: 'emergency.scam',
    neutralText: "Please don't share any money details or codes with anyone. I'll let your family know.",
    hiText: 'कृपया किसी को भी पैसे की जानकारी या कोई कोड मत बताइए। मैं आपके परिवार को बता दूँगी।',
  },
  help_key: {
    responseLineId: 'emergency.help',
    neutralText: "I'm calling your family right now. Please stay on the line.",
    hiText: 'मैं अभी आपके परिवार को फ़ोन कर रही हूँ। कृपया फ़ोन पर बने रहिए।',
  },
  sudden_confusion: {
    responseLineId: 'emergency.confusion',
    neutralText: "I'm calling your family right now. Please sit down and stay where you are.",
    hiText: 'मैं अभी आपके परिवार को फ़ोन कर रही हूँ। कृपया बैठ जाइए और वहीं रहिए।',
  },
};
// Person B's screen (C9, server/safety/redflags.json) names two categories differently.
RESPONSES.breathlessness = RESPONSES.breathing;
RESPONSES.financial_scam = RESPONSES.scam;

// Stand-in keyword lists (English, and common Hindi in Latin script). B's redflags.json replaces these.
const KEYWORDS = {
  fall: ['i fell', 'i have fallen', "i've fallen", 'fell down', 'i fall', 'gir gaya', 'gir gayi', 'gir gai'],
  chest_pain: ['chest pain', 'chest hurts', 'pain in my chest', 'chest is hurting', 'seene mein dard', 'seene me dard'],
  breathing: ["can't breathe", 'cannot breathe', 'cant breathe', 'hard to breathe', 'saans nahi', 'saans nahin'],
  // Not "took two" or "took both": a normal dose can be two pills.
  extra_pills: ['extra pills', 'extra pill', 'took them twice', 'took it twice', 'took too many', 'double dose', 'zyada goli'],
  self_harm: ['kill myself', 'end my life', 'want to die', 'hurt myself', 'marna chahti', 'marna chahta'],
  scam: ['otp', 'bank details', 'pin number', 'send money', 'card number'],
};

function normalise(text) {
  return ` ${String(text || '').toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ')} `;
}

async function keywordScreen(text) {
  const t = normalise(text);
  for (const [category, words] of Object.entries(KEYWORDS)) {
    if (words.some((w) => t.includes(` ${w} `))) {
      return { verdict: 'redflag', category, ...RESPONSES[category] };
    }
  }
  return { verdict: 'ok' };
}

let screenFn = keywordScreen;

function setSafetyScreen(fn) {
  if (typeof fn !== 'function') throw new TypeError('setSafetyScreen needs a function');
  screenFn = fn;
}

// If the plugged-in screen fails, the keyword list still runs: a broken screen must never let a
// red flag through.
async function screen(text, ctx) {
  if (screenFn === keywordScreen) return keywordScreen(text);
  try {
    return await screenFn(text, ctx);
  } catch (err) {
    console.error('[agent:safety] screen failed, using the keyword list:', err.message);
    return keywordScreen(text);
  }
}

// The response for a red flag, with the neutral text filled in when the screen gave none.
// lang 'hi': the Hindi line (core scenario 9), whatever language the screen's own text is in.
function responseFor(verdict, lang) {
  const fixed = RESPONSES[verdict.category] || RESPONSES.help_key;
  return {
    responseLineId: verdict.responseLineId || fixed.responseLineId,
    neutralText: lang === 'hi' && fixed.hiText ? fixed.hiText : verdict.neutralText || fixed.neutralText,
  };
}

module.exports = { screen, setSafetyScreen, responseFor, keywordScreen, RESPONSES };
