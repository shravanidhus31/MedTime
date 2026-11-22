/**
 * MedTime — voice call reminders and escalation, per dose (cron, every minute).
 *
 * Sole owner of ALL voice call reminders; reminderJob.js handles SMS only.
 * A1.3: every step works on one Reminder (one dose), not on the Medicine, so a
 * medicine taken twice a day has two independent clocks.
 *
 *  [C] FIRST CALL     — dose due in the last 15 min, never called yet
 *      → call the patient, arm caregiverAlertTime = now + 10 min.
 *
 *  Patient presses 1  → webhook → markDose(taken): the dose's clock is disarmed.
 *  Patient presses 2  → webhook sets this dose's snoozeUntil = now + 10 min.
 *
 *  [B] SNOOZE OVER    — snoozeUntil <= now
 *      → call again, re-arm caregiverAlertTime.
 *
 *  [A] ESCALATION     — caregiverAlertTime <= now and still not confirmed
 *      → dementiaMode and fewer than 3 calls so far: call again (A4.1, unanswered ≠ missed)
 *      → otherwise markDose(missed), then PHONE the caregivers (services/caregiverAlerts.js;
 *        trial SMS can't carry custom text). If no call could be placed the dose
 *        gets alertFailed and the next ticks retry, up to 3 tries in all.
 *
 * Patients with dementiaMode: [C] and [B] go through the agent (agent/doseDue.js),
 * which checks the dose log before calling.
 *
 * Safety net next to Person B's reminder top-up (ISSUES #5, jobs/reminderTopUpJob.js):
 * if a daily call-type medicine is due this minute and has no Reminder for it, one is
 * created first, so no dose goes uncalled because its record is missing (e.g. the
 * server was asleep at midnight). Weekly/alternate-day medicines rely on the top-up.
 */

const cron     = require('node-cron');
const Medicine = require('../models/Medicine');
const Reminder = require('../models/Reminder');
const { makePatientCall } = require('../utils/twilioClient');
const { handleDoseDue } = require('../agent/doseDue');
const { markDose } = require('../services/doseService');
const { notifyCaregivers } = require('../services/caregiverAlerts');
const { MAX_CALL_ATTEMPTS } = require('../agent/flows/dosePolicy');

const MINUTE = 60 * 1000;
const ESCALATE_AFTER_MS = 10 * MINUTE;  // unconfirmed this long after a call → caregiver
const FIRST_CALL_WINDOW_MS = 15 * MINUTE; // a missed tick (restart) still calls within this
const MAX_ALERT_ATTEMPTS = 3;
const OPEN = ['pending', 'alerted'];      // not yet confirmed or missed

// ── "HH:mm" in IST (UTC+5:30). Render runs in UTC; scheduledTimes are IST strings.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const toHHMM = (date) => {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`;
};
// "8:05 PM", for the caregiver's spoken alert.
const toSpokenTime = (date) => {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  const h = ist.getUTCHours();
  return `${h % 12 || 12}:${String(ist.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const startOfMinute = (date) => new Date(Math.floor(date.getTime() / MINUTE) * MINUTE);

// ─────────────────────────────────────────────────────────────────────────────
// Stand-in for the nightly top-up: make sure each call-type dose due this minute
// has a Reminder. Upsert on (medicine, minute), so nothing is ever duplicated.
// ─────────────────────────────────────────────────────────────────────────────
async function ensureDueReminders(now) {
  const slot = startOfMinute(now);
  // Daily medicines only, within their dates. Weekly and alternate-day medicines are left to
  // Person B's top-up (jobs/reminderTopUpJob.js), which knows which days they fall on.
  const due = await Medicine.find({
    isActive: true,
    notificationType: 'call',
    scheduledTimes: toHHMM(now),
    frequency: { $nin: ['weekly', 'alternate_days'] },
    $and: [
      { $or: [{ startDate: null }, { startDate: { $lte: now } }] },
      { $or: [{ endDate: null }, { endDate: { $gte: now } }] },
    ],
  }).select('_id patient name').lean();
  let created = 0;
  for (const med of due) {
    const r = await Reminder.updateOne(
      { medicine: med._id, scheduledTime: { $gte: slot, $lt: new Date(slot.getTime() + MINUTE) } },
      { $setOnInsert: { medicine: med._id, patient: med.patient, scheduledTime: slot, status: 'pending' } },
      { upsert: true },
    );
    if (r.upsertedCount) {
      created += 1;
      console.log(`   🧾 No reminder record for ${med.name} at ${toHHMM(now)}; created one.`);
    }
  }
  return created;
}

// ─────────────────────────────────────────────────────────────────────────────
// Call the patient about one dose: count the attempt, arm the 10-minute clock,
// then call. If the call can't be placed the clock is disarmed again, so the
// caregiver isn't alerted about a call that never reached the patient.
// ─────────────────────────────────────────────────────────────────────────────
// agent: true for dementia-mode patients: the call runs the speech agent (A3.5).
async function callPatient(reminder, patientPhone, medName, now, { agent = false } = {}) {
  await Reminder.updateOne(
    { _id: reminder._id },
    { $set: { caregiverAlertTime: new Date(now.getTime() + ESCALATE_AFTER_MS), lastCallAt: now, callError: null }, $inc: { attempts: 1 } },
  );
  try {
    await makePatientCall(patientPhone, medName, String(reminder.medicine._id || reminder.medicine), String(reminder._id), { agent });
  } catch (err) {
    await Reminder.updateOne({ _id: reminder._id }, { $set: { caregiverAlertTime: null, callError: err.message } });
    throw err;
  }
  await Reminder.updateOne({ _id: reminder._id, status: 'pending' }, { $set: { status: 'alerted', alertedAt: now } });
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phone the caregivers about a missed dose. Success → caregiverAlerted (red badge).
// No call placed → alertFailed; retried on the next ticks up to MAX_ALERT_ATTEMPTS.
// ─────────────────────────────────────────────────────────────────────────────
async function alertCaregivers(reminder, patient, medName, now) {
  const patientName = patient.user?.name || 'the patient';
  const result = await notifyCaregivers({
    patientId: patient._id,
    reason: 'missed_dose',
    message: `${patientName} has not confirmed taking their ${medName}, due at ${toSpokenTime(reminder.scheduledTime)}. Ten minutes have passed since the reminder call.`,
  }).catch((err) => ({ ok: false, error: err.message }));

  const tries = (reminder.alertAttempts || 0) + 1;
  if (result.ok) {
    await Reminder.updateOne({ _id: reminder._id }, {
      $set: { caregiverAlerted: true, caregiverNotified: true, caregiverNotifiedAt: now, alertFailed: false, alertError: null },
      $inc: { alertAttempts: 1 },
    });
    console.log(`      📞 Caregiver alerted about ${medName} (${result.data.sent} call(s)).`);
    return true;
  }

  await Reminder.updateOne({ _id: reminder._id }, {
    $set: { alertFailed: true, alertError: result.error },
    $inc: { alertAttempts: 1 },
  });
  if (tries >= MAX_ALERT_ATTEMPTS) {
    console.error(`      ❌ Caregiver alert for ${medName} failed ${tries} times; giving up: ${result.error}`);
  } else {
    console.error(`      ❌ Caregiver alert for ${medName} failed (try ${tries} of ${MAX_ALERT_ATTEMPTS}); retrying next tick: ${result.error}`);
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// One tick of the cron. Exported so checks can run a tick directly.
// ─────────────────────────────────────────────────────────────────────────────
async function runTick(now = new Date()) {
  const nowHHMM = toHHMM(now);
  console.log(`\n⏱️  [Escalation Cron] Tick at ${now.toLocaleTimeString()} (${nowHHMM})`);

  try {
    await ensureDueReminders(now);

    const candidates = await Reminder.find({
      $or: [
        // [A] escalation clock expired → caregiver
        { status: { $in: OPEN }, caregiverAlertTime: { $lte: now, $ne: null } },
        // [A] retry a caregiver alert that couldn't be placed
        { status: 'missed', alertFailed: true, alertAttempts: { $lt: MAX_ALERT_ATTEMPTS } },
        // [B] snooze over → call again
        { status: { $in: OPEN }, snoozeUntil: { $lte: now, $ne: null } },
        // [C] due in the last 15 minutes and never called
        {
          status: 'pending',
          // up to an hour ahead: a medicine with an earlier call (callOffsetMinutes, Feature 3)
          scheduledTime: { $gt: new Date(now.getTime() - FIRST_CALL_WINDOW_MS), $lte: new Date(now.getTime() + 60 * MINUTE) },
          attempts: { $not: { $gt: 0 } },
          snoozeUntil: null,
          caregiverAlertTime: null,
        },
      ],
    })
      .sort({ scheduledTime: 1 })
      .populate('medicine')
      .populate({ path: 'patient', populate: { path: 'user', model: 'User' } });

    // Only call-type medicines: SMS reminders are reminderJob.js's.
    // A dose whose (possibly earlier) call time hasn't come yet waits for a later tick.
    const doses = candidates.filter((r) => r.medicine && r.medicine.isActive && r.medicine.notificationType === 'call')
      .filter((r) => !(r.scheduledTime > now && r.scheduledTime.getTime() + (Number(r.medicine.callOffsetMinutes) || 0) * MINUTE > now.getTime()));
    if (doses.length === 0) {
      console.log('   → No call reminders need attention this tick.');
      return;
    }
    console.log(`   → ${doses.length} dose(s) to process.`);

    for (const reminder of doses) {
      const patient = reminder.patient;
      const medicine = reminder.medicine;
      if (!patient || !patient.user) {
        console.warn(`   ⚠️  Reminder ${reminder._id} has no linked patient — skipping.`);
        continue;
      }
      const patientPhone = patient.user.phone;
      const patientName  = patient.user.name;
      const medName      = medicine.name;
      const doseLabel    = `${medName} (${toHHMM(reminder.scheduledTime)})`;

      try {
        // ── [A] ESCALATION ──────────────────────────────────────────────────
        if (OPEN.includes(reminder.status) && reminder.caregiverAlertTime && reminder.caregiverAlertTime <= now) {
          // Claim it first, so the alert goes out once even if ticks overlap.
          const claimed = await Reminder.findOneAndUpdate(
            { _id: reminder._id, status: { $in: OPEN }, caregiverAlertTime: { $lte: now } },
            { $set: { caregiverAlertTime: null, snoozeUntil: null } },
            { returnDocument: 'after' },
          );
          if (!claimed) continue;

          // Dementia mode (A4.1): an unanswered call is not a missed dose. Call again, up to
          // MAX_CALL_ATTEMPTS calls in all, 10 minutes apart; the agent's tone gets firmer each time.
          if (patient.dementiaMode && (claimed.attempts || 0) < MAX_CALL_ATTEMPTS) {
            console.log(`   🔁 [A] NO ANSWER: calling ${patientName} again for ${doseLabel} (call ${(claimed.attempts || 0) + 1} of ${MAX_CALL_ATTEMPTS}).`);
            const r = await handleDoseDue({ medicine, patient, reminder: claimed, attempt: 'retry', now, placeCall: () => callPatient(claimed, patientPhone, medName, now, { agent: true }) });
            console.log(`      🤖 Agent handover (retry): ${r.called ? 'called' : 'no call'} — ${r.reason} (run ${r.runId}).`);
            continue;
          }

          console.log(`   🚨 [A] ESCALATION: ${patientName} did not confirm ${doseLabel} in time.`);
          await markDose(reminder._id, 'missed', 'scheduler');
          await alertCaregivers(claimed, patient, medName, now);
          continue;
        }

        if (reminder.status === 'missed' && reminder.alertFailed) {
          console.log(`   🔁 [A] Retrying the caregiver alert for ${patientName}'s ${doseLabel}.`);
          await alertCaregivers(reminder, patient, medName, now);
          continue;
        }

        // ── [B] SNOOZE OVER — call again ────────────────────────────────────
        if (reminder.snoozeUntil && reminder.snoozeUntil <= now) {
          const claimed = await Reminder.findOneAndUpdate(
            { _id: reminder._id, status: { $in: OPEN }, snoozeUntil: { $lte: now } },
            { $set: { snoozeUntil: null } },
          );
          if (!claimed) continue;
          console.log(`   ⏰ [B] SNOOZE OVER: calling ${patientName} again for ${doseLabel}.`);
          if (patient.dementiaMode) {
            const r = await handleDoseDue({ medicine, patient, reminder, attempt: 'retry', now, placeCall: () => callPatient(reminder, patientPhone, medName, now, { agent: true }) });
            console.log(`      🤖 Agent handover (re-call): ${r.called ? 'called' : 'no call'} — ${r.reason} (run ${r.runId}).`);
          } else {
            await callPatient(reminder, patientPhone, medName, now);
            console.log(`      📞 Re-call placed to ${patientName}.`);
          }
          continue;
        }

        // ── [C] FIRST CALL ──────────────────────────────────────────────────
        // At the dose time, or earlier if the caregiver approved an earlier call (Feature 3).
        const callAt = reminder.scheduledTime.getTime() + (Number(medicine.callOffsetMinutes) || 0) * MINUTE;
        if (callAt > now.getTime()) continue;
        console.log(`   🔔 [C] FIRST CALL: calling ${patientName} for ${doseLabel}${medicine.callOffsetMinutes ? ` (${-medicine.callOffsetMinutes} min early, as approved)` : ''}.`);
        if (patient.dementiaMode) {
          const r = await handleDoseDue({ medicine, patient, reminder, attempt: 'initial', now, placeCall: () => callPatient(reminder, patientPhone, medName, now, { agent: true }) });
          // "already taken" (confirmed in the app since this tick started) means no call;
          // the dose is no longer 'pending', so it isn't picked up again.
          console.log(`      🤖 Agent handover: ${r.called ? 'called' : 'no call'} — ${r.reason} (run ${r.runId}).`);
        } else {
          await callPatient(reminder, patientPhone, medName, now);
          console.log(`      📞 First call placed to ${patientName}.`);
        }
      } catch (err) {
        console.error(`   ❌ Could not process ${doseLabel} for ${patientName}:`, err.message);
      }
    }
  } catch (error) {
    console.error('❌ [Escalation Cron] Fatal error in tick:', error);
  }
}

// Main cron — runs every minute
const task = cron.schedule('* * * * *', () => runTick());

module.exports = { runTick, task, ensureDueReminders, toHHMM, toSpokenTime, MAX_ALERT_ATTEMPTS };
