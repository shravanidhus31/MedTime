// Agent start-up (A2.5). Called once from server/index.js: initAgent().
// Registers the core tools, connects red flags to real caregiver alerts, and plugs in
// Person B's real pieces where Person A's runtime had stand-ins (integration):
//   - C3 access check: middleware/access.js canAccess (CaregiverAccess roles)
//   - C9 safety screen: safety/screen.js screen (EN/HI/MR keywords, LLM on final transcripts).
//     If it ever throws, agent/safety.js falls back to its own keyword list.

const { setEmergencyHandler } = require('./orchestrator');
const { setSafetyScreen } = require('./safety');
const { setAccessChecker } = require('./access');
const { notifyCaregivers } = require('../services/caregiverAlerts');

let started = false;

function initAgent() {
  if (started) return;
  started = true;

  require('./tools/core'); // registers the five core tools
  require('./flows/dose'); // registers the 'dose' flow and the end_call tool (A2.7)

  setAccessChecker(require('../middleware/access').canAccess); // C3 (Person B)
  setSafetyScreen(require('../safety/screen').screen); // C9 (Person B)

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
