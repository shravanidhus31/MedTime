/**
 * Reminder Top-Up Job — B1.4 (#5)
 *
 * Runs nightly at IST midnight (18:30 UTC).
 * For every active medicine, ensures there are Reminder records covering the
 * next 7 days.  Skips slots where a Reminder already exists (idempotent).
 *
 * This is the minimal first version — it supports only the existing frequencies
 * ('once', 'twice', 'thrice', 'custom').  The extended rewrite for
 * alternate_days / weekly and IST-aware "today" (#6, #7) stays in B12 (week 3).
 *
 * Person A's per-dose escalation reads Reminder records starting Friday of week 1,
 * so this job must be live before that PR merges.
 */

const cron     = require('node-cron');
const Medicine = require('../models/Medicine');
const Reminder = require('../models/Reminder');

/**
 * Core function — separated from the cron schedule so it can be unit-tested.
 * Returns { processed, created, skipped } counts.
 */
async function topUpReminders() {
  const now = new Date();
  // Build the 7-day window we want reminders to cover.
  // The window starts at the BEGINNING of today (UTC midnight) so we don't
  // miss any slots that fall before the current clock time today.
  const windowStart = new Date(now);
  windowStart.setUTCHours(0, 0, 0, 0);

  const windowEnd = new Date(windowStart);
  windowEnd.setDate(windowStart.getDate() + 7);

  const medicines = await Medicine.find({ isActive: true }).lean();
  let processed = 0;
  let created   = 0;
  let skipped   = 0;

  for (const med of medicines) {
    if (!med.scheduledTimes || med.scheduledTimes.length === 0) continue;

    // Respect startDate and endDate
    const start = med.startDate ? new Date(med.startDate) : new Date(0);
    const end   = med.endDate   ? new Date(med.endDate)   : null;

    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const day = new Date(windowStart);
      day.setDate(windowStart.getDate() + dayOffset);

      // Skip if this day is before the medicine's startDate or after endDate
      if (day < start) { skipped++; continue; }
      if (end && day > end) { skipped++; continue; }

      for (const timeStr of med.scheduledTimes) {
        const [hours, minutes] = timeStr.split(':').map(Number);
        const reminderTime = new Date(day);
        // scheduledTimes are IST; Render runs UTC → subtract 5 h 30 m
        reminderTime.setUTCHours(hours - 5, minutes - 30, 0, 0);

        // Don't create reminders in the past
        if (reminderTime <= now) { skipped++; continue; }

        // Check if one already exists for this medicine at this exact time
        const exists = await Reminder.exists({
          medicine:      med._id,
          scheduledTime: reminderTime,
        });

        if (exists) { skipped++; continue; }

        await Reminder.create({
          medicine:      med._id,
          patient:       med.patient,
          scheduledTime: reminderTime,
          status:        'pending',
        });
        created++;
      }
    }
    processed++;
  }

  return { processed, created, skipped };
}

/**
 * Register the cron schedule.
 * '30 18 * * *' = 18:30 UTC = 00:00 IST (midnight IST).
 */
function startReminderTopUpJob() {
  cron.schedule('30 18 * * *', async () => {
    console.log('⏰ [reminderTopUp] Starting nightly reminder top-up...');
    try {
      const { processed, created, skipped } = await topUpReminders();
      console.log(
        `✅ [reminderTopUp] Done. Medicines: ${processed}, ` +
        `Reminders created: ${created}, skipped: ${skipped}`
      );
    } catch (err) {
      console.error('❌ [reminderTopUp] Error:', err.message);
    }
  }, {
    scheduled: true,
    timezone:  'UTC', // the schedule is already expressed in UTC above
  });

  console.log('⏰ Nightly reminder top-up cron registered (runs 00:00 IST / 18:30 UTC).');
}

module.exports = { startReminderTopUpJob, topUpReminders };
