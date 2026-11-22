const AgentQuestion = require('../../models/AgentQuestion');

/**
 * ask_caregiver Tool — Contract C1 & C6 (B4)
 *
 * Used by agents to ask targeted questions to caregivers (CHI 2025).
 * Creates an AgentQuestion document; answering resumes the AgentRun.
 */
module.exports = {
  name: 'ask_caregiver',
  description: 'Ask the caregiver a specific clarification question with optional choices. The answer will resume the run.',
  inputSchema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'The concise clarification question to ask the caregiver.',
      },
      choices: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional list of choice buttons for quick one-tap answering.',
      },
      askedTo: {
        type: 'string',
        description: 'Optional specific caregiver user ID.',
      },
    },
    required: ['question'],
  },
  approvalLevel: 0, // Asking a question is Level 0 (autonomous)

  async run(input, ctx = {}) {
    const { question, choices = [], askedTo } = input;
    const { patientId, runId } = ctx;

    if (!patientId) {
      return { ok: false, error: 'ctx.patientId is required to ask caregiver.' };
    }

    try {
      const q = await AgentQuestion.create({
        run: runId || null,
        patient: patientId,
        askedTo: askedTo || null,
        question,
        choices,
        status: 'pending',
      });

      return {
        ok: true,
        data: {
          questionId: q._id,
          status: 'waiting_for_caregiver',
          message: 'Question queued for caregiver on the dashboard.',
        },
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },
};
