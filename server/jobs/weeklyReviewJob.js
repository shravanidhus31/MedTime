// The weekly review (fix 8, Features 1 and 3): every Sunday at 8:00 PM IST (14:30 UTC), for every
// patient with measured calls in the last two weeks.
const cron = require('node-cron');
const Observation = require('../models/Observation');
const { generateWeeklyReview } = require('../services/weeklyReviewService');

async function runWeeklyReviews(now = new Date()) {
  const ids = await Observation.distinct('patient', { timestamp: { $gte: new Date(now.getTime() - 14 * 24 * 3600 * 1000) } });
  let done = 0;
  for (const id of ids) {
    try {
      await generateWeeklyReview(id, now);
      done += 1;
    } catch (err) {
      console.error(`[WeeklyReviewJob] Review for patient ${id} failed:`, err.message);
    }
  }
  console.log(`[WeeklyReviewJob] ${done} weekly review(s) written.`);
  return done;
}

function startWeeklyReviewJob() {
  return cron.schedule('30 14 * * 0', () => {
    console.log('⏰ [WeeklyReviewJob] Sunday 8:00 PM IST weekly reviews...');
    runWeeklyReviews().catch((err) => console.error('[WeeklyReviewJob] failed:', err.message));
  });
}

module.exports = { startWeeklyReviewJob, runWeeklyReviews };
