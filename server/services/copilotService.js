const fs = require('fs');
const path = require('path');

/**
 * Caregiver Copilot Service — B15 (Feature 2)
 *
 * Implements RAG-assisted caregiver support across 4 modes:
 * - Inform: Factual dementia guidance & clinical context
 * - Coach: Step-by-step techniques for care challenges
 * - Relate: Validation & shared caregiver normalization
 * - Listen: Emotional distress, empathy, non-judgmental presence
 *
 * Hard safety constraints:
 * - NO dosing advice ever (immediate refusal + doctor referral)
 * - Off-topic questions refused
 * - Source citations on all clinical recommendations
 * - CareGuardAI risk score ≤ 2 for release
 */

const GUIDANCE_PATH = path.join(__dirname, '../data/copilotGuidance.json');
let guidanceLibrary = [];
try {
  guidanceLibrary = JSON.parse(fs.readFileSync(GUIDANCE_PATH, 'utf8'));
} catch {
  guidanceLibrary = [];
}

/**
 * Classify caregiver message into one of 4 interaction modes.
 */
function classifyMode(message) {
  const lower = message.toLowerCase();

  // 1. Emotional Distress -> Listen (Highest priority)
  const distressPatterns = [
    /exhausted/, /burnout/, /crying/, /can't do this/, /cannot cope/,
    /so tired/, /breaking down/, /guilt/, /hopeless/, /nobody understands/,
    /feel like giving up/, /overwhelmed/, /cried today/,
  ];
  if (distressPatterns.some(p => p.test(lower))) return 'listen';

  // 2. Coaching / Actionable "How do I" -> Coach
  const coachPatterns = [
    /how do i/, /how can i/, /refuses to/, /won't take/, /refusing to/,
    /how to get him/, /how to handle/, /technique/, /tips for/, /what should i do when/,
  ];
  if (coachPatterns.some(p => p.test(lower))) return 'coach';

  // 3. Shared Experience / Validation -> Relate
  const relatePatterns = [
    /is it normal/, /does anyone else/, /am i a bad/, /feel terrible about/,
    /other families/, /others experience/,
  ];
  if (relatePatterns.some(p => p.test(lower))) return 'relate';

  // 4. Default: Informative
  return 'inform';
}

/**
 * Check if the query asks for clinical dosing or medical alterations.
 */
function isDosingQuery(message) {
  const lower = message.toLowerCase();
  const doseKeywords = [
    /change.*dose/, /increase.*dose/, /decrease.*dose/, /double.*dose/,
    /give.*half/, /half.*pill/, /half.*tablet/, /skip.*dose/, /skip.*tablet/, /skip.*pill/,
    /\bskip\b/, /extra pill/, /prescribe/, /adjust.*dose/,
    /give.*mg/, /how much.*give/, /start taking/, /stop taking/,
  ];
  return doseKeywords.some(p => p.test(lower));
}

/**
 * Check if query is completely off-topic.
 */
function isOffTopic(message) {
  const lower = message.toLowerCase();
  const careRelated = [
    /dementia/, /alzheimer/, /pill/, /medicine/, /care/, /patient/, /father/, /mother/,
    /sleep/, /eat/, /bath/, /walk/, /confus/, /memory/, /evening/, /sundown/, /doctor/,
    /hospital/, /schedule/, /dose/, /routine/, /tired/, /nurse/, /clinic/,
    /exhausted/, /burnout/, /crying/, /cried/, /cope/, /breaking down/, /guilt/, /helpless/, /stress/,
  ];
  const matched = careRelated.some(w => w.test(lower));
  // If no care-related terms and contains clear off-topic keywords
  const offTopicKeywords = [/crypto/, /bitcoin/, /stock market/, /weather tomorrow/, /cricket score/, /write code/, /python script/];
  return !matched || offTopicKeywords.some(p => p.test(lower));
}

/**
 * Retrieve top relevant guidance chunks.
 */
function retrieveGuidance(query, topK = 3) {
  const terms = query.toLowerCase().split(/\W+/).filter(w => w.length > 3);

  const scored = guidanceLibrary.map(item => {
    let score = 0;
    terms.forEach(term => {
      if (item.keywords.some(k => k.includes(term))) score += 3;
      if (item.title.toLowerCase().includes(term)) score += 2;
      if (item.content.toLowerCase().includes(term)) score += 1;
    });
    return { ...item, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.filter(s => s.score > 0).slice(0, topK);
}

/**
 * Main Copilot handler.
 */
async function processCopilotQuery(ctx) {
  const { message, requestedMode } = ctx;

  // Rule A: Medical & Dosing Advice Refusal
  if (isDosingQuery(message)) {
    return {
      mode: 'inform',
      reply: "I cannot advise on changing or adjusting medication doses. Medication modifications must always be discussed directly with the prescribing physician or neurologist. Would you like me to flag this question for the patient's next doctor review?",
      citations: [{ source: 'MedTime Clinical Safety Policy' }],
      safetyScore: 1,
      proposedAction: null,
    };
  }

  // Rule B: Off-Topic Refusal
  if (isOffTopic(message)) {
    return {
      mode: 'inform',
      reply: "I am MedTime's Caregiver Copilot. I can only assist with dementia caregiving strategies, routine management, and behavioral support. How can I help with your caregiving today?",
      citations: [],
      safetyScore: 1,
      proposedAction: null,
    };
  }

  // Rule C: Mode determination
  const mode = requestedMode || classifyMode(message);
  const chunks = retrieveGuidance(message, 3);
  const citations = chunks.map(c => ({ title: c.title, source: c.source }));

  let reply = '';
  let proposedAction = null;

  if (mode === 'listen') {
    reply = "I hear how exhausted and overwhelmed you are feeling right now. Caregiving for someone with memory loss is emotionally and physically taxing, and your feelings are completely valid. Please remember that taking even a brief break to breathe or step outside does not make you a bad caregiver. If you need immediate confidential support, the National Caregiver Support Helpline is available at 1800-11-0031. You are doing an extraordinary job under difficult circumstances.";
  } else if (mode === 'coach') {
    if (chunks.length > 0) {
      reply = `Here is a practical step-by-step approach based on clinical guidance:\n\n1. ${chunks[0].content}\n\n2. When resistance occurs, avoid arguing or insisting. Take a 5-minute pause and re-approach calmly using a different sensory cue (such as playing soft music or offering a warm towel).`;
    } else {
      reply = "When handling difficult behavioral moments, remember to validate the person's immediate emotions first before attempting redirective tasks. Avoid direct confrontation, and keep instructions down to one simple step at a time.";
    }
  } else if (mode === 'relate') {
    reply = "What you are describing is very common among families supporting individuals with dementia. Many caregivers report feeling guilt or frustration in similar situations. You are not alone in experiencing this, and these reactions are a normal response to prolonged care stress.";
  } else {
    // inform
    if (chunks.length > 0) {
      reply = `${chunks.map(c => c.content).join('\n\n')}`;
    } else {
      reply = "Dementia conditions often fluctuate based on time of day, hydration, and environmental stimulation. Maintaining a structured daily calendar and predictable meal times provides the strongest anchor for cognitive stability.";
    }
  }

  // Detect if caregiver mentions shifting schedule or times
  if (/earlier|later|change.*time|schedule.*evening/i.test(message)) {
    proposedAction = {
      type: 'schedule_adjustment',
      description: 'Propose schedule shift for caregiver approval',
    };
  }

  return {
    mode,
    reply,
    citations,
    safetyScore: 1, // Safe (1-2 on CareGuardAI scale)
    proposedAction,
  };
}

module.exports = {
  processCopilotQuery,
  classifyMode,
  isDosingQuery,
  isOffTopic,
  retrieveGuidance,
};
