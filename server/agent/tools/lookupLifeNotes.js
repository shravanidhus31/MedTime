/**
 * lookup_life_notes Tool — B11 (Call-In Agent, Feature 7)
 *
 * Used by the call-in agent to answer questions about people, places,
 * routines, and sensitive topics from the patient's Life Notes memory graph.
 *
 * Strictly returns approved notes only. Never invents or paraphrases — the
 * agent must quote directly from the stored answer text.
 *
 * Contract C1 compliant.
 */

const LifeNote = require('../../models/LifeNote');

module.exports = {
  name: 'lookup_life_notes',
  description: 'Look up biographical, routine, person, place, or sensitive-topic answers for a patient from their memory graph (Life Notes). Returns approved notes only — never guesses.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The patient\'s question or topic to search for in life notes (e.g. "who is Priya", "morning routine", "grandpa")',
      },
      kind: {
        type: 'string',
        enum: ['person', 'place', 'routine', 'event', 'topic_answer', 'any'],
        description: 'Filter to a specific note category, or "any" to search all',
      },
    },
    required: ['query'],
  },
  approvalLevel: 0,

  async run(input, ctx = {}) {
    const { query, kind } = input;
    const patientId = ctx.patientId || input.patientId;

    if (!patientId) {
      return { ok: false, error: 'ctx.patientId is required to look up life notes.' };
    }

    if (!query || !query.trim()) {
      return { ok: false, error: 'A search query is required.' };
    }

    try {
      const filter = {
        patient: patientId,
        approved: true,
      };
      if (kind && kind !== 'any') {
        filter.kind = kind;
      }

      const allNotes = await LifeNote.find(filter).lean();

      if (allNotes.length === 0) {
        return {
          ok: true,
          found: false,
          notes: [],
          message: 'No approved life notes found for this patient.',
        };
      }

      // Simple keyword matching across title and text
      const qLower = query.toLowerCase().trim();
      const tokens = qLower.split(/\s+/).filter((t) => t.length > 2);

      const scored = allNotes.map((note) => {
        const haystack = `${note.title} ${note.text}`.toLowerCase();
        let score = 0;

        // Exact title match gets highest weight
        if (note.title.toLowerCase().includes(qLower)) score += 10;

        // Each keyword token match in title scores more than text
        for (const token of tokens) {
          if (note.title.toLowerCase().includes(token)) score += 3;
          if (note.text.toLowerCase().includes(token)) score += 1;
        }

        return { note, score };
      });

      const matches = scored
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((s) => ({
          id: s.note._id,
          kind: s.note.kind,
          title: s.note.title,
          text: s.note.text,
          linkedRecordingId: s.note.linkedRecordingId,
          score: s.score,
        }));

      return {
        ok: true,
        found: matches.length > 0,
        notes: matches,
        message: matches.length > 0
          ? `Found ${matches.length} relevant memory note(s).`
          : 'No notes matched the query. Do not invent an answer.',
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },
};
