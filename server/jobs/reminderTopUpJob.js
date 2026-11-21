/**
 * Reminder Top-Up Job — B1.4 (#5) & B12 (#5, #6, #7)
 *
 * Runs nightly at IST midnight (18:30 UTC).
 * For every active medicine, ensures there are Reminder records covering the
 * next 7 days. Skips slots where a Reminder already exists (idempotent).
 *
 * Full B12 feature set:
 * - #5: Extended frequency support ('once', 'twice', 'thrice', 'custom', 'alternate_days', 'weekly')
 * - #6: `regenerateFutureReminders(medicineId)` on medicine edits
 * - #7: Accurate IST "today" calculation (UTC+5:30)
 */

const cron = require('node-cron');
const Medicine = require('../models/Medicine');
const Reminder = require('../models/Reminder');

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Returns a Date object shifted into IST components.
 */
function toIST(date = new Date()) {
  return new Date(date.getTime() + IST_OFFSET_MS);
}

/**
 * Returns UTC timestamp corresponding to 00:00:00 IST of the given date.
 */
function getISTMidnightUTC(date = new Date()) {
  const ist = toIST(date);
  const midnightIST = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 0, 0, 0, 0);
  return new Date(midnightIST - IST_OFFSET_MS);
}

/**
 * Generates reminders for a single active medicine over a 7-day window.
 */
async function generateRemindersForMedicine(med, windowStart = null) {
  if (!med.scheduledTimes || med.scheduledTimes.length === 0) {
    return { created: 0, skipped: 0 };
  }

  const now = new Date();
  const baseStart = windowStart || getISTMidnightUTC(now);

  const start = med.startDate ? new Date(med.startDate) : new Date(0);
  const end = med.endDate ? new Date(med.endDate) : null;

  // For alternate_days calculation
  const startIST = toIST(start);
  const startISTMidnight = Date.UTC(startIST.getUTCFullYear(), startIST.getUTCMonth(), startIST.getUTCDate(), 0, 0, 0, 0);

  let created = 0;
  let skipped = 0;

  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    // Current day IST midnight in UTC
    const dayISTTime = new Date(baseStart.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    const dayIST = toIST(dayISTTime);
    const currentDayISTMidnight = Date.UTC(dayIST.getUTCFullYear(), dayIST.getUTCMonth(), dayIST.getUTCDate(), 0, 0, 0, 0);

    // Respect startDate and endDate
    if (dayISTTime < start) { skipped++; continue; }
    if (end && dayISTTime > end) { skipped++; continue; }

    // ── Frequency Check ──
    const istDayOfWeek = dayIST.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat

    if (med.frequency === 'weekly') {
      const allowedDays = Array.isArray(med.daysOfWeek) && med.daysOfWeek.length > 0 ? med.daysOfWeek : [1];
      if (!allowedDays.includes(istDayOfWeek)) {
        skipped++;
        continue;
      }
    } else if (med.frequency === 'alternate_days') {
      const interval = med.intervalDays || 2;
      const diffDays = Math.round((currentDayISTMidnight - startISTMidnight) / (24 * 60 * 60 * 1000));
      if (diffDays >= 0 && diffDays % interval !== 0) {
        skipped++;
        continue;
      }
    }

    // ── Generate for each scheduled time ──
    for (const timeStr of med.scheduledTimes) {
      if (!timeStr || !timeStr.includes(':')) continue;
      const [hours, minutes] = timeStr.split(':').map(Number);

      // Construct reminder time in UTC (timeStr is in IST)
      const reminderTime = new Date(dayISTTime);
      reminderTime.setUTCHours(hours - 5, minutes - 30, 0, 0);

      // Don't create reminders in the past
      if (reminderTime <= now) { skipped++; continue; }

      // Check if reminder already exists
      const exists = await Reminder.exists({
        medicine: med._id,
        scheduledTime: reminderTime,
      });

      if (exists) { skipped++; continue; }

      await Reminder.create({
        medicine: med._id,
        patient: med.patient,
        scheduledTime: reminderTime,
        status: 'pending',
      });
      created++;
    }
  }

  return { created, skipped };
}

/**
 * Core function — processes all active medicines for the next 7 days.
 */
async function topUpReminders() {
  const medicines = await Medicine.find({ isActive: true }).lean();
  let processed = 0;
  let created = 0;
  let skipped = 0;

  const windowStart = getISTMidnightUTC(new Date());

  for (const med of medicines) {
    const res = await generateRemindersForMedicine(med, windowStart);
    created += res.created;
    skipped += res.skipped;
    processed++;
  }

  return { processed, created, skipped };
}

/**
 * Regenerate future reminders for a medicine when it is edited (#6).
 */
async function regenerateFutureReminders(medicineId) {
  const med = await Medicine.findById(medicineId).lean();
  if (!med || !med.isActive) {
    const del = await Reminder.deleteMany({
      medicine: medicineId,
      scheduledTime: { $gt: new Date() },
      status: 'pending',
    });
    return { created: 0, removed: del.deletedCount };
  }

  // Delete future pending reminders
  const del = await Reminder.deleteMany({
    medicine: med._id,
    scheduledTime: { $gt: new Date() },
    status: 'pending',
  });

  const res = await generateRemindersForMedicine(med);
  return { ...res, removed: del.deletedCount };
}

/**
 * Register the cron schedule.
 * '30 18 * * *' = 18:30 UTC = 00:00 IST (midnight IST).
 */
function startReminderTopUpJob() {
  cron.schedule('30 18 * * *', async () => {
    console.log('⏰ [reminderTopUp] Starting nightly reminder top-up (IST midnight)...');
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
    timezone: 'UTC',
  });

  console.log('⏰ Nightly reminder top-up cron registered (runs 00:00 IST / 18:30 UTC).');
}

module.exports = {
  startReminderTopUpJob,
  topUpReminders,
  generateRemindersForMedicine,
  regenerateFutureReminders,
  getISTMidnightUTC,
};
