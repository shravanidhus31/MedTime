const JournalEntry = require('../../models/JournalEntry');

/**
 * write_journal Tool — Contract C1 & B8 (Feature 6)
 *
 * Used by the Journal Agent (nightly 9 PM IST cron or manual trigger)
 * to write the structured daily care journal for dementia-mode patients.
 *
 * Rules:
 * 1. Every line must link to its source (runId or observationId).
 *    A line without one is strictly rejected.
 * 2. "patient_said" lines must quote transcripts, shortened, never paraphrased.
 * 3. No clinical diagnosis, no "declining", no guessing at causes.
 * 4. Quiet days get 1 line. Max 8 lines per entry.
 */
module.exports = {
  name: 'write_journal',
  description: 'Write the structured daily care journal note for a patient from the day\'s runs and observations.',
  inputSchema: {
    type: 'object',
    properties: {
      date: {
        type: 'string',
        description: 'ISO date string or YYYY-MM-DD for the journal entry',
      },
      lines: {
        type: 'array',
        description: 'Array of 1 to 8 structured care note lines with direct sources',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The line text' },
            source: {
              type: 'string',
              enum: ['patient_said', 'agent_noticed', 'action_taken'],
              description: 'Origin of this line',
            },
            runId: { type: 'string', description: 'ID of the originating AgentRun' },
            observationId: { type: 'string', description: 'ID of the originating Observation' },
          },
          required: ['text', 'source'],
        },
        minItems: 1,
        maxItems: 8,
      },
    },
    required: ['lines'],
  },
  approvalLevel: 0, // Level 0: Informational care note, caregiver can mark lines wrong

  async run(input, ctx = {}) {
    const { date, lines } = input;
    const patientId = ctx.patientId || input.patientId;

    if (!patientId) {
      return { ok: false, error: 'ctx.patientId or input.patientId is required to write a journal entry.' };
    }

    if (!Array.isArray(lines) || lines.length === 0) {
      return { ok: false, error: 'At least one journal line is required.' };
    }

    if (lines.length > 8) {
      return { ok: false, error: 'Journal cannot exceed 8 lines.' };
    }

    // Banned words regex: no diagnosis, declining, guessing causes
    const BANNED_PATTERNS = /\b(diagnos|declining|deteriorat|progressing|uncooperative|incompetent|senile)\b/i;

    const validatedLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (!line.text || typeof line.text !== 'string' || !line.text.trim()) {
        return { ok: false, error: `Line ${i + 1} has empty text.` };
      }

      if (!['patient_said', 'agent_noticed', 'action_taken'].includes(line.source)) {
        return { ok: false, error: `Line ${i + 1} has invalid source: '${line.source}'.` };
      }

      // Rule 1: Every line must have a source link
      if (!line.runId && !line.observationId && !ctx.runId) {
        return {
          ok: false,
          error: `Line ${i + 1} rejected: Every line must link to its source (runId or observationId).`,
        };
      }

      // Rule 3: No clinical diagnosis or subjective decline words
      if (BANNED_PATTERNS.test(line.text)) {
        return {
          ok: false,
          error: `Line ${i + 1} rejected: No medical diagnosis or subjective decline terms allowed in care journal.`,
        };
      }

      validatedLines.push({
        text: line.text.trim(),
        source: line.source,
        runId: line.runId || ctx.runId || null,
        observationId: line.observationId || null,
        markedWrong: false,
      });
    }

    // Target date normalized to start of day (UTC midnight)
    const entryDate = date ? new Date(date) : new Date();
    entryDate.setUTCHours(0, 0, 0, 0);

    try {
      let journal = await JournalEntry.findOne({
        patient: patientId,
        date: entryDate,
      });

      if (journal) {
        journal.lines = validatedLines;
        journal.notified = false;
        await journal.save();
      } else {
        journal = await JournalEntry.create({
          patient: patientId,
          date: entryDate,
          lines: validatedLines,
          notified: false,
        });
      }

      return {
        ok: true,
        journalId: journal._id,
        lineCount: journal.lines.length,
        date: journal.date,
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },
};
