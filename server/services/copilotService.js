// The caregiver copilot (Feature 2, fix 9; plan section 3 and the copilot checks in section 8).
// Rebuilt: Person B's version gave canned text whatever the question, ignored the patient, and
// reported a hard-coded safety score of 1 for every answer ("two safety reviews" never ran).
//
//   processCopilotQuery({ message, requestedMode, patientId, userId }, { chatFn }) →
//     { mode, reply, citations, released, reviews: { safety, grounding }, runId, proposedAction, source }
//
// 1. screen (code)   an emergency in the question → a fixed "call 112" reply; a dosing question →
//                    a fixed refusal ("only her doctor can decide") and an offer to note it for
//                    the doctor; clearly off-topic → a short refusal
// 2. agent           the smart tier with tools (runRecorded, so the Activity panel shows each step):
//                    her records (get_patient_context, get_dose_history, get_care_notes,
//                    lookup_life_notes) and the guidance library (search_guidance); it picks a mode
//                    (inform, coach, relate, listen) and cites a source for every fact
// 3. code guard      an answer with medicine advice is withheld, whatever the reviewers say
// 4. two reviews     CareGuardAI-style, separate model calls: SAFETY risk and HALLUCINATION risk
//                    (against the evidence the tools returned), 1-5; released only if both ≤ 2;
//                    otherwise one rewrite with the reviewers' reasons, reviewed again; then a safe
//                    "I can't answer that reliably" instead
// 5. no model        (rate limit, outage) → a basic answer from the guidance library and her
//                    records, clearly marked, with no claims beyond them
// Zero dosing advice is a hard metric (PRD: copilot dosing advice = 0).

const mongoose = require('mongoose');
const { runRecorded, addStep } = require('../agent/runs');
const { chat: llmChat } = require('../agent/llm');
const { loadPrompt } = require('../agent/prompts');
const { screen } = require('../agent/safety');
const { searchGuidance, library } = require('../agent/tools/copilotTools');

const MAX_MESSAGE = 1000;
const TOOLS = ['get_patient_context', 'get_dose_history', 'get_care_notes', 'lookup_life_notes', 'search_guidance'];
const HELPLINE = 'Tele-MANAS on 14416 (free, 24 hours)';

// ── screening (code) ─────────────────────────────────────────────────────────

function classifyMode(message) {
  const t = String(message || '').toLowerCase();
  if (/(exhausted|burn ?out|crying|cried|can'?t do this|cannot cope|so tired|breaking down|guilt|hopeless|nobody understands|giving up|overwhelmed|alone in this)/.test(t)) return 'listen';
  if (/(how do i|how can i|refuses to|won'?t (take|eat|bathe|sleep)|refusing|how to (get|handle|stop)|tips for|what should i do when)/.test(t)) return 'coach';
  if (/(is it normal|does anyone else|am i a bad|feel terrible|other families|others experience)/.test(t)) return 'relate';
  return 'inform';
}

// A question that asks us to decide about a medicine (dose, timing, stopping, extra).
function isDosingQuery(message) {
  const t = String(message || '').toLowerCase();
  return [
    /(change|increase|decrease|reduce|raise|lower|adjust|double)\b.*\b(dose|dosage|mg|tablet|pill|medicine)/,
    /\b(dose|dosage)\b.*\b(change|increase|decrease|reduce|adjust|double|more|less)/,
    /(give|take|have)\b.*\bhalf\b/, /half (a |the )?(pill|tablet)/,
    /(skip|miss|stop|start|pause)\b.*\b(dose|tablet|pill|medicine|medication|taking)/,
    /\bextra (pill|tablet|dose)\b/, /how (much|many)\b.*\b(give|take|mg|tablets?|pills?)/,
    /(can|should) (i|we) give (her|him)\b/, /\bprescribe\b/, /(instead of|swap|replace)\b.*\b(medicine|tablet|pill)/,
    // "Can I stop the Atorvastatin?" names the medicine, not the word "medicine"
    /\b(can|should|could|may) (i|we|she|he) (stop|skip|pause|start|cut|halve|double|reduce|increase)\b/, /\bstop (giving|the)\b/,
  ].some((re) => re.test(t));
}

// Clearly not about caring for her (a data question with no care words is still fine).
function isOffTopic(message) {
  const t = String(message || '').toLowerCase();
  return /(bitcoin|crypto|stock market|share price|cricket score|weather tomorrow|write (me )?(code|a python|a program)|python script|homework|movie review)/.test(t);
}

// The answer itself gives medicine advice: withheld whatever the reviewers say. Checked sentence by
// sentence; a sentence that defers ("ask her doctor", "don't stop … without …") is not advice.
// (copilot check, 22 Nov: "Give her an extra tablet in the evening." got past the first version.)
const ADVICE = [
  /\b(give|take|offer|increase|decrease|reduce|raise|lower|double|halve|skip|stop|start|pause|cut|split|crush|add)\b[^.!?]{0,40}\b(\d+(\.\d+)?\s?(mg|mcg|ml)|doses?|dosage|tablets?|pills?|capsules?|medicines?|medication)\b/i,
  /\b(extra|another|second|half|double)\s+(tablet|pill|dose|capsule)s?\b/i,
  /\b\d+(\.\d+)?\s?(mg|mcg)\b[^.!?]{0,30}\b(instead|more|less|extra)\b/i,
  // "Stop the Atorvastatin": a medicine named, not the word "medicine"
  /\b(?:[Ss]top|[Ss]kip|[Pp]ause|[Hh]alve|[Dd]ouble|[Ss]plit|[Cc]rush|[Ii]ncrease|[Rr]educe)\s+(?:the\s+|her\s+|his\s+)?[A-Z][a-z]{3,}/,
];
const DEFERS = /(doctor|nurse|pharmacist|don'?t|do not|never|without asking|only her|not safe to|can'?t advise|cannot advise)/i;
const givesMedicineAdvice = (answer) => String(answer || '')
  .split(/(?<=[.!?])\s+/)
  .some((sentence) => !DEFERS.test(sentence) && ADVICE.some((re) => re.test(sentence)));

// Fixed replies for an emergency in the caregiver's question.
const URGENT = {
  fall: 'This sounds urgent. If she is hurt, cannot get up, hit her head or is confused, call 112 now or take her to the nearest hospital. Do not lift her if she is in pain; keep her warm until help comes.',
  chest_pain: 'This sounds urgent: chest pain needs help now. Call 112 or take her to the nearest hospital straight away.',
  breathing: 'This sounds urgent: trouble breathing needs help now. Call 112 or take her to the nearest hospital straight away.',
  breathlessness: 'This sounds urgent: trouble breathing needs help now. Call 112 or take her to the nearest hospital straight away.',
  extra_pills: 'If she has taken extra tablets or someone else\'s, call 112 or go to the nearest hospital now, and take the medicine strips with you so the doctors can see what she took.',
  sudden_confusion: 'Sudden confusion, a drooping face, slurred speech or weakness on one side can be a stroke. Call 112 now; note the time it started.',
  self_harm: `I'm really sorry you're carrying this. Please talk to someone now: ${HELPLINE}, or call 112 if anyone is in danger.`,
};

// ── helpers ─────────────────────────────────────────────────────────────────

// The JSON at the end of the model's reply.
function parseFinal(text) {
  const s = String(text || '');
  const start = s.lastIndexOf('{"mode"') >= 0 ? s.lastIndexOf('{"mode"') : s.indexOf('{');
  if (start >= 0) {
    try {
      const j = JSON.parse(s.slice(start, s.lastIndexOf('}') + 1));
      if (j && typeof j.answer === 'string') return { mode: ['inform', 'coach', 'relate', 'listen'].includes(j.mode) ? j.mode : 'inform', answer: j.answer.trim(), sources: Array.isArray(j.sources) ? j.sources.map(String) : [] };
    } catch { /* fall through */ }
  }
  return s.trim() ? { mode: 'inform', answer: s.trim(), sources: [] } : null;
}

// Citations the caregiver sees, from the sources the answer named (only real library ids).
function citationsFor(sources) {
  const out = [];
  for (const src of sources || []) {
    const m = /^guide:(.+)$/.exec(src);
    if (m) {
      const g = library.find((x) => x.id === m[1].trim());
      if (g && !out.some((c) => c.id === g.id)) out.push({ id: g.id, title: g.title, source: g.source });
    } else if (/^record/.test(src) && !out.some((c) => c.id === 'records')) {
      out.push({ id: 'records', title: 'Her MedTime records', source: 'Dose log, journal and call notes' });
    }
  }
  return out;
}

// What the tools returned, for the hallucination reviewer.
const evidenceOf = (steps) => (steps || [])
  .filter((s) => s.output && s.output.ok)
  .map((s) => `[${s.tool}] ${JSON.stringify(s.output.data).slice(0, 1500)}`)
  .join('\n')
  .slice(0, 7000);

async function review(chatFn, kind, { question, answer, evidence }) {
  const prompt = loadPrompt(kind === 'safety' ? 'copilot_review_safety' : 'copilot_review_grounding', {});
  const content = kind === 'safety'
    ? `QUESTION:\n${question}\n\nANSWER:\n${answer}`
    : `EVIDENCE:\n${evidence || '(none)'}\n\nANSWER:\n${answer}`;
  const r = await chatFn({
    tier: kind === 'safety' ? 'safety' : 'fast',
    system: prompt.text,
    messages: [{ role: 'user', content }],
    jsonSchema: { name: `review_${kind}`, schema: { type: 'object', properties: { score: { type: 'integer' }, reason: { type: 'string' } }, required: ['score', 'reason'], additionalProperties: false } },
    timeoutMs: 15000,
    maxTokens: 600,
  });
  const score = Number(r.json && r.json.score);
  if (!Number.isInteger(score) || score < 1 || score > 5) throw new Error(`no ${kind} score`);
  return { score, reason: String(r.json.reason || '').slice(0, 300), model: r.model };
}

// Without a model: the guidance library and her records only, clearly marked.
async function basicAnswer({ message, mode, patientId }) {
  const hits = searchGuidance(message, 2);
  const parts = [];
  if (mode === 'listen') parts.push(`Caring for someone with memory loss is exhausting, and what you feel is understandable. If it feels like too much, you can talk to someone: ${HELPLINE}.`);
  for (const g of hits) parts.push(`${g.content} [guide:${g.id}]`);
  if (mongoose.isValidObjectId(patientId) && /(pill|medicine|dose|tablet|took|taken|missed)/i.test(message)) {
    const Reminder = require('../models/Reminder');
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const doses = await Reminder.find({ patient: patientId, scheduledTime: { $gte: since, $lte: new Date() } }).select('status').lean();
    const taken = doses.filter((d) => d.status === 'taken').length;
    const missed = doses.filter((d) => d.status === 'missed').length;
    if (doses.length) parts.push(`In the last 7 days, ${taken} of ${doses.length} doses were recorded as taken${missed ? ` and ${missed} missed` : ''}. [record: dose history]`);
  }
  if (!parts.length) parts.push("I couldn't find guidance on that in MedTime's library. Her doctor or nurse is the best person to ask.");
  return { mode, answer: parts.join(' '), sources: [...hits.map((g) => `guide:${g.id}`), ...(parts.some((p) => p.includes('[record')) ? ['record:dose_history'] : [])] };
}

// ── main ────────────────────────────────────────────────────────────────────

async function processCopilotQuery(ctx, { chatFn = llmChat } = {}) {
  const message = String((ctx && ctx.message) || '').trim().slice(0, MAX_MESSAGE);
  const { requestedMode, patientId } = ctx;
  const fixed = (mode, reply, extra = {}) => ({ mode, reply, citations: [], released: true, reviews: { safety: null, grounding: null, note: 'fixed safety reply' }, runId: null, proposedAction: null, source: 'fixed', ...extra });

  // 1. screening
  const red = await screen(message, { patientId, flow: 'copilot', isFinal: true }).catch(() => ({ verdict: 'ok' }));
  if (red && red.verdict === 'redflag' && URGENT[red.category]) return fixed(red.category === 'self_harm' ? 'listen' : 'inform', URGENT[red.category], { urgent: red.category });
  if (isDosingQuery(message)) {
    return fixed('inform', "I can't advise on changing, skipping, splitting or adding medicine doses; only her doctor can decide that, because it depends on her health and her other medicines. I can note this question so you remember to ask the doctor at the next visit.", {
      proposedAction: { type: 'doctor_question', description: 'Note this question for her next doctor visit', question: message },
    });
  }
  if (isOffTopic(message)) return fixed('inform', "I'm MedTime's caregiver copilot, so I can only help with caring for her: her medicines and routine, her calls, and day-to-day dementia care. What would you like to know?");

  const Patient = require('../models/Patient');
  const patient = await Patient.findById(patientId).populate('user', 'name').lean();
  const name = ((patient && patient.user && patient.user.name) || 'the patient').split(' ')[0];
  const mode0 = ['inform', 'coach', 'relate', 'listen'].includes(requestedMode) ? requestedMode : classifyMode(message);
  const prompt = loadPrompt('copilot', { name });

  // 2. the agent: look things up, draft with sources
  let result;
  try {
    result = await runRecorded(
      { trigger: 'copilot', patientId, flow: 'copilot' },
      {
        tier: 'smart',
        system: `${prompt.text}\n\nThe caregiver's preferred mode: ${mode0}.`,
        promptVersion: prompt.promptVersion,
        messages: [{ role: 'user', content: `Caregiver asked: "${message.replace(/"/g, "'")}"` }],
        tools: TOOLS,
        ctx: { patientId: String(patientId) },
        timeoutMs: 30000,
        maxToolCalls: 6,
        check: null,
        chatFn,
      },
    );
  } catch (err) {
    result = { outcome: 'fallback', error: { message: err.message }, steps: [] };
  }
  const runId = result.runId || null;
  const log = (step) => (runId ? addStep(runId, { at: new Date(), ms: 0, ...step }).catch(() => {}) : null);

  let draft = result.outcome === 'done' ? parseFinal(result.text) : null;
  if (!draft) {
    // 5. no model: a basic answer from the library and her records
    const basic = await basicAnswer({ message, mode: mode0, patientId });
    await log({ tool: 'copilot_basic_answer', input: {}, output: { ok: true, reason: (result.error && result.error.message) || result.fallbackReason || 'no answer' }, label: 'agent_noticed', summaryText: 'The model was unavailable: answered from the guidance library and her records only.' });
    return { mode: basic.mode, reply: basic.answer, citations: citationsFor(basic.sources), released: true, reviews: { safety: null, grounding: null, note: 'basic answer (model unavailable)' }, runId, proposedAction: null, source: 'basic' };
  }
  const evidence = evidenceOf(result.steps);

  // 3 + 4. the code guard and the two reviews; one rewrite with the reviewers' reasons
  let reviews = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (givesMedicineAdvice(draft.answer)) {
      reviews = { safety: { score: 5, reason: 'The answer gives medicine advice (code guard).' }, grounding: null };
    } else {
      try {
        const [safety, grounding] = await Promise.all([
          review(chatFn, 'safety', { question: message, answer: draft.answer }),
          review(chatFn, 'grounding', { answer: draft.answer, evidence }),
        ]);
        reviews = { safety, grounding };
      } catch (err) {
        reviews = { safety: null, grounding: null, error: err.message };
      }
    }
    await log({ tool: 'review_answer', input: { attempt: attempt + 1 }, output: { ok: true, ...reviews }, label: 'agent_noticed', summaryText: reviews.safety && reviews.grounding ? `Reviewed: safety risk ${reviews.safety.score}/5, made-up-facts risk ${reviews.grounding.score}/5.` : `Review: ${reviews.safety ? reviews.safety.reason : reviews.error}` });
    const passed = reviews.safety && reviews.grounding && reviews.safety.score <= 2 && reviews.grounding.score <= 2;
    if (passed) {
      await log({ tool: 'release_answer', input: {}, output: { ok: true, mode: draft.mode }, label: 'action_taken', summaryText: 'Answer released to the caregiver (both reviews 2 or lower).' });
      return { mode: draft.mode, reply: draft.answer, citations: citationsFor(draft.sources), released: true, reviews, runId, proposedAction: null, source: 'agent' };
    }
    if (attempt === 0 && (reviews.safety || reviews.grounding)) {
      // one rewrite, told what the reviewers found, with the same evidence only
      try {
        const why = [reviews.safety && reviews.safety.score > 2 ? `Safety: ${reviews.safety.reason}` : null, reviews.grounding && reviews.grounding.score > 2 ? `Unsupported: ${reviews.grounding.reason}` : null].filter(Boolean).join(' ');
        const r = await chatFn({
          tier: 'smart',
          system: `${prompt.text}\n\nRewrite your answer so it fixes this, using ONLY the evidence below. ${why}\n\nEVIDENCE:\n${evidence}`,
          messages: [{ role: 'user', content: `Caregiver asked: "${message.replace(/"/g, "'")}"\n\nYour earlier answer: ${draft.answer}` }],
          timeoutMs: 20000,
          maxTokens: 1500,
        });
        const again = parseFinal(r.text);
        if (again) { draft = again; continue; }
      } catch { /* withheld below */ }
    }
    break;
  }
  // withheld: never shown unless both reviews passed
  await log({ tool: 'withhold_answer', input: {}, output: { ok: true, reviews }, label: 'action_taken', summaryText: 'Answer withheld: it did not pass the safety and accuracy reviews.' });
  return {
    mode: draft.mode,
    reply: "I couldn't put together an answer I'm confident is safe and accurate from her records and the guidance library. Her doctor or nurse is the best person to ask about this.",
    citations: [],
    released: false,
    reviews,
    runId,
    proposedAction: null,
    source: 'withheld',
  };
}

// Kept for older callers and tests.
const retrieveGuidance = (query, topK = 3) => searchGuidance(query, topK);

module.exports = { processCopilotQuery, classifyMode, isDosingQuery, isOffTopic, retrieveGuidance, givesMedicineAdvice, parseFinal, citationsFor };
