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

// The weekly chat call (Feature 1): Sundays 11:00 AM IST (05:30 UTC), only for patients who have
// it switched on (Patient.weeklyChatEnabled, off by default). Its measures feed the evening review.
async function runWeeklyChats() {
  const Patient = require('../models/Patient');
  const { makeChatCall } = require('../utils/twilioClient');
  const patients = await Patient.find({ weeklyChatEnabled: true }).populate('user', 'phone name').lean();
  let placed = 0;
  for (const p of patients) {
    if (!p.user || !p.user.phone) continue;
    try { await makeChatCall(p.user.phone, String(p._id)); placed += 1; } catch (err) { console.error(`[WeeklyChat] call for ${p._id} failed:`, err.message); }
  }
  console.log(`[WeeklyChat] ${placed} weekly chat call(s) placed.`);
  return placed;
}

function startWeeklyReviewJob() {
  cron.schedule('30 5 * * 0', () => {
    console.log('⏰ [WeeklyChat] Sunday 11:00 AM IST weekly chat calls...');
    runWeeklyChats().catch((err) => console.error('[WeeklyChat] failed:', err.message));
  });
  return cron.schedule('30 14 * * 0', () => {
    console.log('⏰ [WeeklyReviewJob] Sunday 8:00 PM IST weekly reviews...');
    runWeeklyReviews().catch((err) => console.error('[WeeklyReviewJob] failed:', err.message));
  });
}

module.exports = { startWeeklyReviewJob, runWeeklyReviews, runWeeklyChats };
