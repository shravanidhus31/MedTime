const cron = require('node-cron');
const Patient = require('../models/Patient');
const { generateDailyJournal } = require('../services/journalService');

/**
 * Daily Care Journal Job — Feature 6 (B8)
 *
 * Runs nightly at 9:00 PM IST (15:30 UTC).
 * Generates an end-of-day care journal entry for every dementiaMode patient,
 * summarizing medication adherence, red flags, proposals, and quotes.
 */
function startJournalJob() {
  // 15:30 UTC = 21:00 (9:00 PM) IST
  cron.schedule('30 15 * * *', async () => {
    console.log('⏰ [JournalJob] Starting nightly 9:00 PM IST journal generation...');
    try {
      const patients = await Patient.find({ dementiaMode: true, isActive: { $ne: false } }).lean();
      console.log(`[JournalJob] Processing ${patients.length} dementiaMode patients`);

      for (const p of patients) {
        try {
          await generateDailyJournal(p._id);
          console.log(`[JournalJob] Generated journal entry for patient ${p._id}`);
        } catch (err) {
          console.error(`[JournalJob] Error generating journal for patient ${p._id}:`, err.message);
        }
      }
    } catch (err) {
      console.error('[JournalJob] Nightly cron execution error:', err.message);
    }
  });

  console.log('⏰ Journal nightly cron registered (9:00 PM IST / 15:30 UTC)');
}

module.exports = { startJournalJob };
