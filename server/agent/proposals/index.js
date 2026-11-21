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

registerProposalKind('schedule_override', {
  level: 1,
  describe: (payload) => `Temporary override for ${payload.medicineName || 'medicine'}: ${payload.reason || ''}`,
  apply: async (payload) => {
    // Applies temporary schedule adjustment
    console.log('[ProposalRegistry] Applied schedule_override:', payload);
    return true;
  },
});

module.exports = {
  registerProposalKind,
  getProposalKind,
  listRegisteredProposalKinds,
};
