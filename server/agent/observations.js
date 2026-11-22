// Measures from every call (fix 8, plan 6.4 / 6.5, A4.2 log_observation): what the weekly review
// compares with her own baseline. Counted in code from the call's transcript and steps, never by a
// model, and never a diagnosis. One Observation row per measure per call.
//
//   computeCallMeasures({ patientLines, steps }) → [{ metric, value }]   (pure, unit-tested)
//   logCallObservations(session, flow)          → writes the rows + a log_observation step
//
// Plan 6.5: timing (time before answering, speech rate) needs word timings, which only the browser
// voice pipeline has; phone calls give transcripts and Twilio's confidence. So every call measures
// what its transcript shows: answer length, fillers, repeated phrases, requests to repeat, answers
// the agent couldn't follow, turns to confirm the dose, distress words; asrConfidence is kept as the
// call-quality check (speech-to-text errors look like hesitation, the paper warns).

const Observation = require('../models/Observation');
const { addStep } = require('./runs');

const FILLERS = /\b(um+|uh+|er+|erm|hmm+|you know|what'?s it called|what do you call it|that thing)\b|(^|\s)(वो वो|क्या कहते हैं|मतलब)(?=\s|$)/gi;
const CLARIFY = /(\bwhat\??$|^what\b|say (that|it) again|say again|repeat|pardon|sorry\?|didn'?t (hear|catch|understand)|can'?t hear|i don'?t understand|क्या\?|क्या कहा|फिर से|दोबारा|समझ नहीं|sunai nahi|samajh nahi|phir se)/i;
const DISTRESS = /(scared|frightened|afraid|worried|anxious|where am i|i want to go home|who are you|i'?m confused|confused|डर|घबरा|घर जाना|मैं कहाँ हूँ|परेशान)/i;

const words = (t) => String(t || '').trim().split(/\s+/).filter(Boolean);

// Back-to-back repeated words or 2-3 word phrases inside one answer, plus an answer that repeats
// her previous answer word for word.
function countRepeats(lines) {
  let n = 0;
  let prev = null;
  for (const line of lines) {
    const w = words(line.toLowerCase().replace(/[.,!?।]/g, ''));
    for (const size of [1, 2, 3]) {
      for (let i = 0; i + 2 * size <= w.length; i += 1) {
        const a = w.slice(i, i + size).join(' ');
        const b = w.slice(i + size, i + 2 * size).join(' ');
        if (a === b && (size > 1 || a.length > 2)) { n += 1; i += size; }
      }
    }
    const norm = w.join(' ');
    if (prev && norm && norm === prev && w.length >= 3) n += 1;
    prev = norm;
  }
  return n;
}

// patientLines: her answers in order ('' = said nothing). steps: the call's AgentRun steps.
function computeCallMeasures({ patientLines = [], steps = [] } = {}) {
  const said = patientLines.map((l) => String(l || '').trim());
  const answers = said.filter((l) => l && !/^\(/.test(l)); // not "(pressed key 1)" / "(says nothing)"
  if (!said.length) return [];
  const out = [];
  const add = (metric, value) => out.push({ metric, value: Math.round(value * 100) / 100 });

  const totalWords = answers.reduce((n, l) => n + words(l).length, 0);
  if (answers.length) add('turnLengthWords', totalWords / answers.length);
  add('fillersCount', answers.reduce((n, l) => n + ((l.match(FILLERS) || []).length), 0));
  add('repeatedPhrasesCount', countRepeats(answers));
  add('clarificationCount', answers.filter((l) => CLARIFY.test(l)).length);
  add('silentTurns', said.filter((l) => !l || l === '(says nothing)').length);
  add('sundowningAnxietyCount', answers.filter((l) => DISTRESS.test(l)).length
    + steps.filter((s) => s.tool === 'safety_screen' && s.output && /confusion/.test(String(s.output.category || ''))).length);

  const understood = steps.filter((s) => s.tool === 'understand' && s.output);
  if (understood.length) add('unclearTurns', understood.filter((s) => s.output.intent === 'unclear').length);
  const said_ = steps.filter((s) => s.tool === 'agent_said' && s.input && Array.isArray(s.input.lines)).flatMap((s) => s.input.lines);
  if (said_.length) add('checkFails', said_.filter((id) => id === 'dose.check_hint' || id === 'dose.check_reask').length);
  const markIdx = steps.findIndex((s) => s.tool === 'mark_dose' && s.input && s.input.status === 'taken');
  if (markIdx >= 0) add('turnsToConfirm', steps.slice(0, markIdx).filter((s) => s.tool === 'patient_said').length);

  const conf = steps.filter((s) => s.tool === 'patient_said' && s.input && typeof s.input.asrConfidence === 'number').map((s) => s.input.asrConfidence);
  if (conf.length) add('asrConfidence', conf.reduce((a, b) => a + b, 0) / conf.length);
  return out.map((o) => ({ ...o, wordCount: totalWords }));
}

// "morning" | "afternoon" | "evening" | "night" in IST.
function istBlock(date) {
  const h = new Date(new Date(date).getTime() + 5.5 * 3600000).getUTCHours();
  return h >= 5 && h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night';
}

const CALL_TYPE = { phone: 'phone', voice: 'browser', text: 'simulation' };

// After a call (dose or call-in flow onEnd). Never throws into the call.
async function logCallObservations(session, flow) {
  try {
    if (!session || !session.patientId || !session.runId) return [];
    const s = session.state || {};
    const patientLines = (s.transcript || []).filter((t) => t.who === 'patient').map((t) => t.text);
    if (!patientLines.length) return [];
    const run = await require('../models/AgentRun').findById(session.runId).select('steps').lean();
    const measures = computeCallMeasures({ patientLines, steps: (run && run.steps) || [] });
    if (!measures.length) return [];
    const at = new Date(session.createdAt || Date.now());
    const timeOfDay = istBlock(at);
    await Observation.insertMany(measures.map((m) => ({
      patient: session.patientId,
      callId: session.runId,
      callType: CALL_TYPE[session.channel] || 'simulation',
      source: 'code',
      metric: m.metric,
      value: m.value,
      timeOfDay,
      metadata: { flow, wordCount: m.wordCount, version: 'call-measures@1' },
      timestamp: at,
    })));
    await addStep(session.runId, {
      tool: 'log_observation',
      input: { flow, timeOfDay },
      output: { ok: true, measures: Object.fromEntries(measures.map((m) => [m.metric, m.value])) },
      ms: 0,
      at: new Date(),
      label: 'agent_noticed',
      summaryText: `Measured this call for the weekly review (${measures.length} measures, ${timeOfDay}).`,
    }).catch(() => {});
    return measures;
  } catch (err) {
    console.error('[observations] could not log call measures:', err.message);
    return [];
  }
}

module.exports = { computeCallMeasures, logCallObservations, countRepeats, istBlock };
