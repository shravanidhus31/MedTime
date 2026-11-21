// Agent start-up (A2.5). Called once from server/index.js: initAgent().
// Registers the core tools and connects red flags to real caregiver alerts.

const { setEmergencyHandler } = require('./orchestrator');
const { notifyCaregivers } = require('../services/caregiverAlerts');

let started = false;

function initAgent() {
  if (started) return;
  started = true;

  require('./tools/core'); // registers the five core tools

  // A red flag on a call → phone the caregivers at once (neutral, fixed message).
  setEmergencyHandler(async (session, verdict) => {
    if (!session.patientId) {
      console.warn(`[agent] red flag (${verdict.category}) in a session with no patient; no one to alert.`);
      return;
    }
    const what = String(verdict.category || 'help').replace(/_/g, ' ');
    const r = await notifyCaregivers({
      patientId: session.patientId,
      reason: 'red_flag',
      message: `Urgent: during a Med Time call there was a red flag: ${what}. Please call them now.`,
      runId: session.runId,
    });
    if (!r.ok) console.error(`[agent] red-flag alert failed for patient ${session.patientId}: ${r.error}`);
  });
}

module.exports = { initAgent };
