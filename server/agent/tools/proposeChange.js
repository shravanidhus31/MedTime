const ProposedChange = require('../../models/ProposedChange');
const { getProposalKind } = require('../proposals');

/**
 * propose_change Tool — Contract C1 & C5 (B4)
 *
 * Used by agents (e.g. Planner, Prescription agent) to queue changes for human approval.
 * approvalLevel is determined by the kind (1 = Caregiver, 2 = Doctor).
 */
module.exports = {
  name: 'propose_change',
  description: 'Propose a change to medication schedule or care routine for human approval (caregiver or doctor).',
  inputSchema: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        description: 'The proposal kind, e.g. new_schedule, schedule_override, call_time_change',
      },
      payload: {
        type: 'object',
        description: 'Structured data for the change to be applied once approved',
      },
      evidence: {
        type: 'string',
        description: 'Why the change is needed, quoting transcripts or doctor instructions',
      },
      overrideLevel: {
        type: 'number',
        enum: [1, 2],
        description: 'Optional override for approval level (e.g. elevate to Level 2 for doctor review)',
      },
    },
    required: ['kind', 'payload', 'evidence'],
  },
  approvalLevel: 1, // Base level; dynamic check uses kind definition

  async run(input, ctx = {}) {
    const { kind, payload, evidence, overrideLevel } = input;
    const { patientId, runId } = ctx;

    if (!patientId) {
      return { ok: false, error: 'ctx.patientId is required to propose a change.' };
    }

    const kindDef = getProposalKind(kind);
    const level = overrideLevel || kindDef?.level || 1;

    try {
      const proposal = await ProposedChange.create({
        patient: patientId,
        kind,
        payload,
        evidence,
        level,
        status: 'pending',
        createdByRun: runId || null,
      });

      return {
        ok: true,
        data: {
          proposalId: proposal._id,
          level,
          status: 'pending',
          message: `Change proposal (${kind}) created successfully at Level ${level}. Awaiting approval.`,
        },
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },
};
