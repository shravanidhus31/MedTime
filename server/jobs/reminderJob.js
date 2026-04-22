const cron     = require('node-cron');
const Reminder = require('../models/Reminder');
const { sendSMS } = require('../utils/twilioClient');

const startReminderJob = () => {
  // Runs every 10 seconds — handles SMS-only reminders
  cron.schedule('*/10 * * * * *', async () => {
    try {
      const now = new Date();

      const pendingReminders = await Reminder.find({
        status: 'pending',
        scheduledTime: { $lte: now },
      })
        .populate({
          path: 'patient',
          populate: { path: 'user', model: 'User' },
        })
        .populate('medicine');

      if (pendingReminders.length === 0) return;

      for (const reminder of pendingReminders) {
        const alertType = reminder.medicine?.notificationType || 'sms';

        // ─────────────────────────────────────────────────────────────────────
        // CALL-TYPE: ownership transferred to missedDoseCron.js (escalation engine).
        // Skip entirely — do NOT mark as 'alerted', do NOT call.
        // The escalation cron will make exactly one call and manage all state.
        // ─────────────────────────────────────────────────────────────────────
        if (alertType === 'call') {
          console.log(`⏩ [Reminder Job] Skipping ${reminder.medicine?.name} — voice calls owned by escalation cron.`);
          continue;
        }

        // ── SMS FLOW ──────────────────────────────────────────────────────────
        const patientPhone = reminder.patient?.user?.phone;
        const medName      = reminder.medicine?.name;
        const medDosage    = reminder.medicine?.dosage;
        const mealTiming   = reminder.medicine?.mealTiming;

        if (!patientPhone) {
          console.warn(`⚠️  [Reminder Job] No phone for reminder ${reminder._id} — skipping.`);
          continue;
        }

        console.log(`💬 [Reminder Job] Sending SMS for ${medName} to ${patientPhone}`);

        try {
          const message = `Hello from MedTime! It's time to take your ${medName} (${medDosage}). Instruction: ${mealTiming} food. Reply '1' when taken, or '2' to skip.`;
          await sendSMS(patientPhone, message);
        } catch (smsError) {
          console.error(`❌ [Reminder Job] SMS failed for ${medName}:`, smsError.message);
          // Don't mark as alerted if SMS failed — we'll retry next tick
          continue;
        }

        reminder.status    = 'alerted';
        reminder.alertedAt = new Date();
        await reminder.save();
      }
    } catch (error) {
      console.error('❌ [Reminder Job] Error:', error);
    }
  });
};

module.exports = { startReminderJob };