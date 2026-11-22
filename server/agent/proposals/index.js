/**
 * Proposal Kind Registry — Contract C5 (B4)
 *
 * Each feature owner registers proposal kinds they know how to apply:
 * - Person B: new_schedule, schedule_override
 * - Person A (Planner/Feature 3): call_time_change, calming_clip_first
 */

const registry = new Map();

/**
 * Register a proposal kind with its approval level and handlers.
 *
 * @param {string} kind - Unique identifier for proposal kind
 * @param {object} def - Definition object:
 *   - level: 1 (Caregiver) or 2 (Doctor)
 *   - describe: (payload) => string
 *   - apply: async (payload, proposalDoc) => void
 */
function registerProposalKind(kind, def) {
  if (!def || typeof def.apply !== 'function') {
    throw new Error(`Proposal kind "${kind}" must have an apply(payload) function.`);
  }
  registry.set(kind, {
    level: def.level || 1,
    describe: def.describe || ((p) => JSON.stringify(p)),
    apply: def.apply,
  });
}

function getProposalKind(kind) {
  return registry.get(kind);
}

function listRegisteredProposalKinds() {
  return Array.from(registry.keys());
}

// ─── Register Default Kinds for Person B (Prescription / Schedules) ─────────
const Medicine = require('../../models/Medicine');
const Reminder = require('../../models/Reminder');

registerProposalKind('new_schedule', {
  level: 1, // Can be escalated to 2 if OCR confidence is low
  describe: (payload) => `New schedule: ${payload.name || 'Medicine'} (${payload.dosage || ''})`,
  apply: async (payload, proposalDoc) => {
    // Creates Medicine and generates initial reminders
    const newMed = new Medicine({
      patient: proposalDoc.patient,
      name: payload.name,
      dosage: payload.dosage,
      type: payload.type || 'tablet',
      frequency: payload.frequency || 'once',
      scheduledTimes: payload.scheduledTimes || ['08:00'],
      mealTiming: payload.mealTiming || 'any',
      startDate: payload.startDate ? new Date(payload.startDate) : new Date(),
      tabletCount: payload.tabletCount || 30,
      notificationType: payload.notificationType || 'sms',
      pillDescription: payload.pillDescription,
      pillboxSlot: payload.pillboxSlot,
      locationHint: payload.locationHint,
    });
    await newMed.save();
    return newMed;
  },
});

// Feature 3 (weekly review, fix 8): call earlier in the evening. Level 1, the caregiver approves
// ("earlier evening call" in the plan's approval table). Only the CALL moves; the dose time stays.
registerProposalKind('call_time_change', {
  level: 1,
  describe: (p) => `Call ${Math.abs(p.shiftMinutes || 30)} minutes earlier for ${(p.medicines || []).map((m) => m.name).join(', ')}`,
  apply: async (payload, proposalDoc) => {
    const shift = Math.max(-60, Math.min(0, Number(payload.shiftMinutes) || -30));
    const ids = (payload.medicines || []).map((m) => m.medicineId).filter(Boolean);
    await Medicine.updateMany({ _id: { $in: ids }, patient: proposalDoc.patient }, { $set: { callOffsetMinutes: shift } });
    return { updated: ids.length, shiftMinutes: shift };
  },
});

registerProposalKind('schedule_override', {
  level: 1,
  describe: (payload) => `Temporary override for ${payload.medicineName || 'medicine'}: ${payload.reason || ''}`,
  apply: async (payload) => {
    // Applies temporary schedule adjustment
    console.log('[ProposalRegistry] Applied schedule_override:', payload);
    return true;
  },
});

// ─── Agent loop hand-off (Person A, A2.2; merged here at integration) ─────────
// The agent loop (agent/loop.js) never runs a tool with approvalLevel > 0 itself; it calls
// proposeChange({ tool, input, level, ctx }) and records the run as 'queued_for_approval'.
// Until that is wired to a ProposedChange record (C5), this stand-in only logs the proposal and
// returns a pending id. Plug the real one in with:
//
//   setProposalHandler(async ({ tool, input, level, ctx }) => ({ proposalId, status: 'pending' }));
//
// (This used to be agent/proposals.js. It moved here because agent/proposals.js and
// agent/proposals/index.js answer the same require('./proposals'), and the file won.)

let proposalHandler = async function stubProposal({ tool, input, level, ctx }) {
  const proposalId = `stub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  console.log(`[proposals:stub] ${tool} (level ${level}) queued as ${proposalId} for run ${ctx && ctx.runId}`, input);
  return { proposalId, status: 'pending', stub: true };
};

function setProposalHandler(fn) {
  if (typeof fn !== 'function') throw new TypeError('setProposalHandler needs a function');
  proposalHandler = fn;
}

async function proposeChange(args) {
  return proposalHandler(args);
}

module.exports = {
  registerProposalKind,
  getProposalKind,
  listRegisteredProposalKinds,
  proposeChange,
  setProposalHandler,
};
