// Step-by-step guided medicine-taking (Feature 4, A6.1; the egg-task cognitive prosthesis paper,
// JMIR Serious Games 2025, and CHI 2025): the dose broken into 3 to 5 spoken steps built from her
// medicine's details (C10: pillDescription, pillboxSlot, locationHint, mealTiming). Each step: say
// it, wait, then praise and go on, or correct with a simpler version of the step; two failures on
// one step hand over to the caregiver. Then the usual check question. Pure functions, unit-tested
// (steps.test.js); the dose flow (dose.js) runs them when Patient.guidedSteps is on.

// buildSteps({ hasLocation, hasPillbox, hasPill, food }) → [{ id, line, simpler }] (3 to 5 steps)
function buildSteps({ hasLocation, hasPillbox, hasPill, food } = {}) {
  const steps = [];
  if (hasLocation) steps.push({ id: 'go', line: 'step.go', simpler: 'step.go_simple' });
  if (hasPillbox) steps.push({ id: 'box', line: 'step.box', simpler: 'step.box_simple' });
  else if (hasPill) steps.push({ id: 'find', line: 'step.find', simpler: 'step.find_simple' });
  else steps.push({ id: 'find', line: 'step.find_generic', simpler: 'step.find_generic_simple' });
  if (food === 'with' || food === 'after') steps.push({ id: 'food', line: `step.food_${food}`, simpler: 'step.food_simple' });
  else if (food === 'before') steps.push({ id: 'food', line: 'step.food_before', simpler: 'step.food_before' });
  steps.push({ id: 'water', line: 'step.water', simpler: 'step.water_simple' });
  steps.push({ id: 'swallow', line: 'step.swallow', simpler: 'step.swallow_simple' });
  return steps.slice(0, 5);
}

// Her answer to a step: 'done' (go on), 'trouble' (simpler version, then hand over), or null (let
// the dose rules decide: "I already took it", a question, "later", "I won't").
const DONE = /(^|\s)(done|ok|okay|yes|yeah|yep|ready|got it|found it|i have it|i'?ve got it|it'?s open|opened|i'?m there|here|i did|i have|haan|ha|हाँ|हां|ठीक|हो गया|हो गई|मिल गई|मिल गया|ले ली|ले लिया|खोल दिया|खुल गया|aa gayi|ho gaya|mil gaya|mil gayi)(\s|[.,!]|$)/i;
const TROUBLE = /(can'?t|cannot|don'?t know|do not know|not sure|where is|where are|which one|help|lost|confused|\bno\b|nope|नहीं|पता नहीं|कहाँ|कौन सी|nahi|pata nahi|kahan)/i;
function classifyStepAnswer(text) {
  const t = String(text || '').trim();
  if (!t) return 'trouble';
  if (/(already (took|taken|had)|पहले ही)/i.test(t)) return null; // the double-dose rules decide
  if (TROUBLE.test(t) && !/^(yes|ok|okay|done)\b/i.test(t)) return 'trouble';
  if (DONE.test(t)) return 'done';
  return null;
}

module.exports = { buildSteps, classifyStepAnswer };
