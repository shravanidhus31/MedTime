// The Planner's follow-ups (A4.3, plan 6.1, MeBo's Planner): after a call, find the concerns she
// mentioned and keep them to ask about once on a later call.
//
//   planFollowUps({ patientId, runId, lines }) → { ok, created: [concern], updated: [concern], source }
//
// lines = her own words from the call. The smart-tier model reads them (prompt
// planner_followups.md) when they could hold a concern at all; if the model is unavailable, the
// rules in flows/followups.js decide. One open FollowUp per concern: a concern already open gets
// her newer words, never a second entry. A plan_followup step is added to the call's AgentRun, so
// the Activity panel and the journal show what was noted. Runs in the background after the call;
// it never delays or breaks a call.

const mongoose = require('mongoose');
const FollowUp = require('../models/FollowUp');
const { chat } = require('./llm');
const { loadPrompt } = require('./prompts');
const { addStep } = require('./runs');
const { CONCERNS, CONCERN_WORDS, extractConcernsRules, mayHaveConcern } = require('./flows/followups');

const SCHEMA = {
  name: 'followup_concerns',
  schema: {
    type: 'object',
    properties: {
      concerns: {
        type: 'array',
        items: {
          type: 'object',
          properties: { concern: { type: 'string', enum: CONCERNS }, quote: { type: 'string' } },
          required: ['concern', 'quote'],
          additionalProperties: false,
        },
      },
      other: { type: 'array', items: { type: 'string' } },
    },
    required: ['concerns', 'other'],
    additionalProperties: false,
  },
};

// The model's concerns, kept only when the quote really is her words (never invented).
async function modelConcerns(lines) {
  const prompt = loadPrompt('planner_followups', {});
  const r = await chat({
    tier: 'smart',
    system: prompt.text,
    messages: [{ role: 'user', content: lines.map((l) => `Patient said: "${String(l).replace(/"/g, "'")}"`).join('\n') }],
    jsonSchema: SCHEMA,
    timeoutMs: 15000,
    maxTokens: 800,
  });
  if (!r.json) throw new Error('no JSON in the reply');
  const all = lines.join(' ').toLowerCase();
  const seen = new Set();
  const concerns = (r.json.concerns || []).filter((c) => {
    if (!CONCERNS.includes(c.concern) || seen.has(c.concern)) return false;
    const q = String(c.quote || '').trim().toLowerCase().replace(/[.!?।]+$/, '');
    if (!q || !all.includes(q)) return false; // a quote that isn't hers is dropped
    seen.add(c.concern);
    return true;
  });
  return { concerns, other: (r.json.other || []).slice(0, 3), promptVersion: prompt.promptVersion };
}

async function planFollowUps({ patientId, runId, lines, now = new Date() }) {
  if (!mongoose.isValidObjectId(patientId)) return { ok: false, error: 'Not a valid patient id' };
  const said = (lines || []).map((l) => String(l || '').trim()).filter((l) => l && !/^\(/.test(l)); // not "(pressed key 1)"
  if (!said.length || !mayHaveConcern(said)) return { ok: true, created: [], updated: [], source: 'none' };

  const t0 = Date.now();
  let found;
  let source = 'model';
  let other = [];
  let fallbackReason;
  try {
    const m = await modelConcerns(said);
    found = m.concerns;
    other = m.other;
  } catch (err) {
    source = 'rules';
    fallbackReason = err.message;
    found = extractConcernsRules(said);
  }

  const created = [];
  const updated = [];
  for (const c of found) {
    const open = await FollowUp.findOne({ patient: patientId, concern: c.concern, status: 'open' });
    if (open) {
      open.quote = c.quote;
      if (mongoose.isValidObjectId(runId)) open.sourceRun = runId;
      await open.save();
      updated.push(c.concern);
    } else {
      await FollowUp.create({
        patient: patientId,
        concern: c.concern,
        quote: c.quote,
        sourceRun: mongoose.isValidObjectId(runId) ? runId : undefined,
        // asked on the next dose call (PRD gate); FOLLOWUP_DELAY_HOURS can hold it back
        nextAsk: new Date(now.getTime() + Number(process.env.FOLLOWUP_DELAY_HOURS || 0) * 3600 * 1000),
      });
      created.push(c.concern);
    }
  }

  if (runId && (found.length || other.length)) {
    const words = found.map((c) => CONCERN_WORDS[c.concern]).join(', ');
    await addStep(runId, {
      tool: 'plan_followup',
      input: { lines: said.length },
      output: { ok: true, created, updated, concerns: found, other, source, fallbackReason },
      ms: Date.now() - t0,
      at: new Date(),
      label: 'agent_noticed',
      summaryText: found.length ? `Will ask about ${words} on the next call.` : `Noted for the journal: "${other[0]}"`,
    }).catch((err) => console.error('[planner] could not save step:', err.message));
  }
  return { ok: true, created, updated, other, source };
}

module.exports = { planFollowUps };
