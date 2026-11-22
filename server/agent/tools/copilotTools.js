// Tools for the caregiver copilot (Feature 2, fix 9): the care-guidance library and her care notes.
// Read-only (approval level 0). The patient's own data also comes from get_patient_context,
// get_dose_history and lookup_life_notes.
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { registerTool, getTool } = require('./index');

let library = [];
try { library = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/copilotGuidance.json'), 'utf8')); } catch { library = []; }

// Keyword search over the library (the plan names Atlas Vector Search; a small curated library is
// searched by words for now).
function searchGuidance(query, topK = 3) {
  const terms = String(query || '').toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  return library
    .map((item) => {
      let score = 0;
      for (const term of terms) {
        if ((item.keywords || []).some((k) => k.includes(term))) score += 3;
        if (item.title.toLowerCase().includes(term)) score += 2;
        if (item.content.toLowerCase().includes(term)) score += 1;
        if ((item.topic || '').includes(term)) score += 2;
      }
      return { ...item, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

if (!getTool('search_guidance')) {
  registerTool({
    name: 'search_guidance',
    description: "Search MedTime's curated dementia-care guidance library (NICE, NHS, Alzheimer's Association, WHO summaries). Returns up to 3 entries with an id to cite as [guide:<id>].",
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'What to look for, e.g. "evening agitation", "refuses bath"' } }, required: ['query'], additionalProperties: false },
    approvalLevel: 0,
    run: async (input) => ({ ok: true, data: { results: searchGuidance(input.query).map(({ id, title, source, content }) => ({ id, title, source, content })) } }),
  });
}

if (!getTool('get_care_notes')) {
  registerTool({
    name: 'get_care_notes',
    description: "Her recent care notes: the daily journal (last 3 days), open follow-ups (concerns she mentioned), and the latest weekly review's summary. Cite as [record: journal <date>], [record: follow-up], [record: weekly review].",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    approvalLevel: 0,
    run: async (input, ctx) => {
      if (!mongoose.isValidObjectId(ctx.patientId)) return { ok: false, error: 'No patient' };
      const JournalEntry = require('../../models/JournalEntry');
      const FollowUp = require('../../models/FollowUp');
      const WeeklyReview = require('../../models/WeeklyReview');
      const since = new Date(Date.now() - 3 * 24 * 3600 * 1000);
      const journal = await JournalEntry.find({ patient: ctx.patientId, createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(3).lean();
      const follow = await FollowUp.find({ patient: ctx.patientId, status: 'open' }).lean();
      const review = await WeeklyReview.findOne({ patient: ctx.patientId }).sort({ createdAt: -1 }).lean();
      return {
        ok: true,
        data: {
          journal: journal.map((j) => ({ date: (j.date || j.createdAt).toISOString().slice(0, 10), lines: (j.lines || []).map((l) => l.text).slice(0, 8) })),
          followUps: follow.map((f) => ({ concern: f.concern, said: f.quote, asked: f.asks, lastAnswer: f.lastAnswer || null })),
          weeklyReview: review ? { week: review.weekEndDate, lines: (review.summaryLines || []).map((l) => l.text) } : null,
        },
      };
    },
  });
}

module.exports = { searchGuidance, library };
