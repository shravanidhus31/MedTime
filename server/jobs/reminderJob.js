const cron     = require('node-cron');
const Reminder = require('../models/Reminder');
const twilio   = require('../utils/twilioClient'); // module object, so checks can stub sendSMS

// An SMS that fails is retried on the next ticks, at most this many tries in all.
// After that the reminder is marked smsFailed and left alone (A1.2).
const MAX_SMS_ATTEMPTS = 3;

const giveUp = async (reminder, reason) => {
  reminder.smsFailed     = true;
  reminder.smsFailReason = reason;
  await reminder.save();
};

// ─────────────────────────────────────────────────────────────────────────────
// One tick of the SMS reminder job. Exported so checks can run a tick directly.
// Call-type medicines are left to missedDoseCron.js, without logging anything.
// ─────────────────────────────────────────────────────────────────────────────
async function runReminderTick(now = new Date()) {
  try {
    const pendingReminders = await Reminder.find({
      status: 'pending',
      scheduledTime: { $lte: now },
      smsFailed: { $ne: true },
    })
      .populate({
        path: 'patient',
        populate: { path: 'user', model: 'User' },
      })
      .populate('medicine');

    if (pendingReminders.length === 0) return;

    for (const reminder of pendingReminders) {
      const alertType = reminder.medicine?.notificationType || 'sms';

      // Calls are owned by the escalation cron (missedDoseCron.js).
      if (alertType === 'call') continue;

      // ── SMS FLOW ──────────────────────────────────────────────────────────
      const patientPhone = reminder.patient?.user?.phone;
      const medName      = reminder.medicine?.name;
      const medDosage    = reminder.medicine?.dosage;
      const mealTiming   = reminder.medicine?.mealTiming;

      if (!patientPhone) {
        console.warn(`⚠️  [Reminder Job] No phone for reminder ${reminder._id}; not sending its SMS.`);
        await giveUp(reminder, 'no_phone');
        continue;
      }

      try {
        const message = `Hello from MedTime! It's time to take your ${medName} (${medDosage}). Instruction: ${mealTiming} food. Reply '1' when taken, or '2' to skip.`;
        console.log(`💬 [Reminder Job] Sending SMS for ${medName} to ${patientPhone}`);
        await twilio.sendSMS(patientPhone, message);
      } catch (smsError) {
        reminder.smsAttempts = (reminder.smsAttempts || 0) + 1;
        if (reminder.smsAttempts >= MAX_SMS_ATTEMPTS) {
          console.error(`❌ [Reminder Job] SMS for ${medName} failed ${reminder.smsAttempts} times; giving up: ${smsError.message}`);
          await giveUp(reminder, smsError.message);
        } else {
          console.error(`❌ [Reminder Job] SMS for ${medName} failed (try ${reminder.smsAttempts} of ${MAX_SMS_ATTEMPTS}); retrying: ${smsError.message}`);
          await reminder.save();
        }
        continue;
      }

      reminder.status    = 'alerted';
      reminder.alertedAt = new Date();
      await reminder.save();
    }
  } catch (error) {
    console.error('❌ [Reminder Job] Error:', error);
  }
}

const startReminderJob = () => {
  // Runs every 10 seconds — handles SMS-only reminders
  return cron.schedule('*/10 * * * * *', () => runReminderTick());
};

module.exports = { startReminderJob, runReminderTick, MAX_SMS_ATTEMPTS };
