/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║        MedTime — Voice Call Reminder & Escalation Engine (Cron)             ║
 * ║                     Runs every minute: * * * * *                            ║
 * ╠══════════════════════════════════════════════════════════════════════════════╣
 * ║  Sole owner of ALL voice call reminders. reminderJob.js handles SMS only.  ║
 * ║                                                                             ║
 * ║  [C] INITIAL CALL   — scheduledTime matches HH:mm, clock not yet armed     ║
 * ║      → Call Patient. Arm caregiverAlertTime = now + 10 min.               ║
 * ║                                                                             ║
 * ║  Patient presses 1  → webhook marks Reminder 'taken', UI turns green.     ║
 * ║  Patient presses 2  → webhook sets snoozeUntil = now + 10 min.            ║
 * ║                                                                             ║
 * ║  [B] SNOOZE EXPIRED — snoozeUntil <= now                                   ║
 * ║      → Re-call patient. Re-arm caregiverAlertTime. Clear snoozeUntil.     ║
 * ║                                                                             ║
 * ║  [A] ESCALATION     — caregiverAlertTime <= now (no response after call)   ║
 * ║      → Mark Reminder 'missed'. Set caregiverAlerted=true. SMS caregivers.  ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

const cron     = require('node-cron');
const Medicine = require('../models/Medicine');
const Patient  = require('../models/Patient');
const Reminder = require('../models/Reminder');
const { makePatientCall, sendCaregiverSMS } = require('../utils/twilioClient');

// ── Helper: 10 minutes from now ───────────────────────────────────────────────
const tenMinsFromNow = () => new Date(Date.now() + 10 * 60 * 1000);

// ── Helper: "HH:mm" string from a Date object ─────────────────────────────────
const toHHMM = (date) =>
  `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

// ─────────────────────────────────────────────────────────────────────────────
// Main cron — runs every minute
// ─────────────────────────────────────────────────────────────────────────────
cron.schedule('* * * * *', async () => {
  const now     = new Date();
  const nowHHMM = toHHMM(now);

  console.log(`\n⏱️  [Escalation Cron] Tick at ${now.toLocaleTimeString()} (${nowHHMM})`);

  try {
    // ── Only process call-type medicines — SMS is handled by reminderJob.js ──
    const candidates = await Medicine.find({
      isActive: true,
      notificationType: 'call',  // ← KEY: this cron owns calls only
      $or: [
        // [A] Escalation clock expired → alert caregiver
        { caregiverAlertTime: { $lte: now, $ne: null } },

        // [B] Snooze expired → re-call patient
        { snoozeUntil: { $lte: now, $ne: null } },

        // [C] Initial reminder — scheduled HH:mm matches, clock not yet armed
        { scheduledTimes: nowHHMM, caregiverAlertTime: null, snoozeUntil: null },
      ],
    }).populate({
      path: 'patient',
      populate: { path: 'user caregivers.user', model: 'User' },
    });

    if (candidates.length === 0) {
      console.log('   → No call reminders need attention this tick.');
      return;
    }

    console.log(`   → ${candidates.length} medicine(s) to process.`);

    for (const medicine of candidates) {
      const patient = medicine.patient;

      if (!patient || !patient.user) {
        console.warn(`   ⚠️  Medicine ${medicine._id} has no linked patient — skipping.`);
        continue;
      }

      const patientPhone = patient.user.phone;
      const patientName  = patient.user.name;
      const medName      = medicine.name;

      // ── [A] ESCALATION EXPIRED — highest priority ──────────────────────────
      if (medicine.caregiverAlertTime && medicine.caregiverAlertTime <= now) {

        console.log(`   🚨 [A] ESCALATION: ${patientName} did not respond to ${medName} in time.`);

        // 1. Disarm clock + mark as alerted so UI card turns red
        medicine.caregiverAlertTime = null;
        medicine.caregiverAlerted   = true;
        await medicine.save();

        // 2. Mark the Reminder as 'missed' in the DB
        const pendingReminder = await Reminder.findOne({
          medicine: medicine._id,
          status: { $in: ['pending', 'alerted'] },
        }).sort({ scheduledTime: -1 });

        if (pendingReminder) {
          pendingReminder.status               = 'missed';
          pendingReminder.caregiverNotified    = true;
          pendingReminder.caregiverNotifiedAt  = new Date();
          await pendingReminder.save();
          console.log(`      📝 Reminder marked as MISSED in DB.`);
        }

        // 3. SMS every linked caregiver
        const caregivers = patient.caregivers || [];
        if (caregivers.length === 0) {
          console.warn(`   ⚠️  No caregivers linked to ${patientName} — cannot escalate.`);
          continue;
        }

        const alertMsg = `🚨 MedTime Alert: ${patientName} did NOT confirm taking their ${medName}. The 10-minute window has expired. Please check on them immediately.`;

        for (const cg of caregivers) {
          if (cg.user?.phone) {
            console.log(`      📱 Alerting caregiver: ${cg.user.name} (${cg.user.phone})`);
            await sendCaregiverSMS(cg.user.phone, alertMsg);
          }
        }

        continue; // Done — move to next medicine
      }

      // ── [B] SNOOZE EXPIRED — re-call patient ──────────────────────────────
      if (medicine.snoozeUntil && medicine.snoozeUntil <= now) {

        console.log(`   ⏰ [B] SNOOZE EXPIRED: Re-calling ${patientName} for ${medName}.`);

        // Clear snooze, arm a fresh 10-minute escalation window
        medicine.snoozeUntil        = null;
        medicine.caregiverAlertTime = tenMinsFromNow();
        await medicine.save();

        try {
          await makePatientCall(patientPhone, medName, medicine._id.toString());
          console.log(`      📞 Re-call placed to ${patientName}.`);
        } catch (callError) {
          console.error(`      ❌ Re-call failed for ${patientName}:`, callError.message);
          // Disarm clock — call never delivered, don't false-alarm caregiver
          medicine.caregiverAlertTime = null;
          await medicine.save();
        }

        continue;
      }

      // ── [C] INITIAL CALL — first contact for this scheduled dose ──────────
      if (
        medicine.scheduledTimes.includes(nowHHMM) &&
        !medicine.snoozeUntil &&
        !medicine.caregiverAlertTime
      ) {
        console.log(`   🔔 [C] INITIAL CALL: Calling ${patientName} for ${medName} at ${nowHHMM}.`);

        // Arm the clock BEFORE the call. If the call fails, clear it immediately
        // so the caregiver isn't woken up for a call that never reached the patient.
        medicine.caregiverAlertTime = tenMinsFromNow();
        await medicine.save();

        try {
          await makePatientCall(patientPhone, medName, medicine._id.toString());
          console.log(`      📞 Initial call placed to ${patientName}.`);
        } catch (callError) {
          console.error(`      ❌ Initial call failed for ${patientName}:`, callError.message);
          medicine.caregiverAlertTime = null;
          await medicine.save();
        }
      }
    }
  } catch (error) {
    console.error('❌ [Escalation Cron] Fatal error in tick:', error);
  }
});