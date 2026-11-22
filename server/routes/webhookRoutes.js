const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const User = require('../models/User');
const Patient = require('../models/Patient');
const Reminder = require('../models/Reminder');
const Medicine = require('../models/Medicine');
const mongoose = require('mongoose');
const { markDose } = require('../services/doseService');
const { verifyTwilio, withToken } = require('../middleware/twilioSignature');
const { publicBaseUrl } = require('../utils/publicUrl');

const MessagingResponse = twilio.twiml.MessagingResponse;

// A1.1: every route below is called by Twilio, so each request must carry a
// valid X-Twilio-Signature. Forged requests get 403 before any handler runs.
// Twilio's signature, or the token we put in the URL (the dose or alert it is about). /sms has no
// URL of ours, so it needs the signature.
router.use(verifyTwilio({ tokenOf: (req) => req.query.reminderId || req.query.medicineId || req.query.alertId || null }));

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/webhooks/sms
// Handles inbound SMS replies from the patient (legacy Reminder-based flow).
// ─────────────────────────────────────────────────────────────────────────────
router.post('/sms', async (req, res) => {
  const body = req.body || {};
  // A1.1 guards: Body or From can be missing (e.g. an MMS with no text).
  const incomingMsg = String(body.Body || '').trim().toLowerCase();
  let fromNumber = String(body.From || ''); // e.g., '+919876543210'

  // Strip +91 to match the DB format
  if (fromNumber.startsWith('+91')) {
    fromNumber = fromNumber.replace('+91', '');
  }

  const twiml = new MessagingResponse();
  const reply = (text) => {
    twiml.message(text);
    return res.type('text/xml').send(twiml.toString());
  };

  try {
    const user = fromNumber ? await User.findOne({ phone: fromNumber }) : null;
    if (!user) {
      return reply("Sorry, we couldn't find a MedTime account linked to this number.");
    }

    const patient = await Patient.findOne({ user: user._id });
    if (!patient) {
      return reply("Sorry, there's no patient profile linked to this number yet.");
    }
    const recentReminder = await Reminder.findOne({
      patient: patient._id,
      status: 'alerted'
    }).sort({ scheduledTime: -1 });

    if (!recentReminder) {
      twiml.message("You have no pending medications right now. Great job!");
      return res.type('text/xml').send(twiml.toString());
    }

    // Through markDose (C4), so the dose's escalation is cleared and the event fires (A1.3).
    if (incomingMsg === '1') {
      const r = await markDose(recentReminder._id, 'taken', 'sms');
      if (!r.ok) throw new Error(r.error);
      twiml.message("✅ Confirmed! We've recorded that you took your medicine. Have a great day!");
    } else if (incomingMsg === '2') {
      const r = await markDose(recentReminder._id, 'skipped', 'sms');
      if (!r.ok) throw new Error(r.error);
      twiml.message("⚠️ Noted. We've recorded this dose as skipped. We will update your caregiver.");
    } else {
      twiml.message("Please reply with '1' if you took your medicine, or '2' if you skipped it.");
    }

    res.type('text/xml').send(twiml.toString());
  } catch (error) {
    console.error('❌ [SMS Webhook] Error:', error);
    twiml.message("We experienced an error processing your reply.");
    res.type('text/xml').send(twiml.toString());
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/webhooks/voice
//
// Handles the Escalation Engine IVR callback.
//
// Twilio POSTs here after the patient presses a digit.
// The cron embeds ?reminderId=<id>&medicineId=<id> in the <Gather action> URL,
// so we know exactly which dose (Reminder) to update (A1.3).
//
// Digits === '1'  → Patient confirmed: markDose(taken, 'ivr'), which disarms
//                   this dose's escalation clock.
// Digits === '2'  → Patient snoozed:   this dose's snoozeUntil = now + 10 min,
//                                       caregiverAlertTime disarmed so no false
//                                       alert fires while they snooze.
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/webhooks/voice/prompt?medicineId=...
// Twilio fetches this when an outbound reminder call connects (makePatientCall
// passes this URL instead of inline TwiML, which trial accounts reject).
// Returns the keypad menu; the key press goes to POST /voice below.
// ─────────────────────────────────────────────────────────────────────────────
const escapeXml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// The dose a keypad call is about (A1.3). New calls carry ?reminderId=; calls
// placed before A1.3 only carry ?medicineId=, so fall back to that medicine's
// latest dose that is due and not yet confirmed. Returns a Reminder (with its
// medicine populated) or null.
async function findCallDose({ reminderId, medicineId }) {
  if (reminderId && mongoose.isValidObjectId(reminderId)) {
    const r = await Reminder.findById(reminderId).populate('medicine');
    if (r) return r;
  }
  if (medicineId && mongoose.isValidObjectId(medicineId)) {
    return Reminder.findOne({
      medicine: medicineId,
      scheduledTime: { $lte: new Date() }, // only past slots, not tomorrow's reminder
      status: { $in: ['alerted', 'pending'] },
    }).sort({ scheduledTime: -1 }).populate('medicine');
  }
  return null;
}

router.post('/voice/prompt', async (req, res) => {
  const { medicineId, reminderId } = req.query;
  const baseUrl = publicBaseUrl();

  let medName = 'medicine';
  try {
    const dose = reminderId ? await findCallDose({ reminderId }) : null;
    const medicine = dose?.medicine || (medicineId && mongoose.isValidObjectId(medicineId) ? await Medicine.findById(medicineId) : null);
    if (medicine?.name) medName = medicine.name;
  } catch (error) {
    console.error('❌ [Voice Prompt] Could not load medicine:', error.message);
  }

  const query = new URLSearchParams({ medicineId: medicineId || '' });
  if (reminderId) query.set('reminderId', reminderId);
  const actionUrl = `${baseUrl}${withToken(`/api/v1/webhooks/voice?${query}`, String(reminderId || medicineId || ''))}`;
  console.log(`📞 [Voice Prompt] Serving menu for "${medName}" (medicineId: ${medicineId}, reminderId: ${reminderId || '-'})`);

  res.type('text/xml').send(
    `<Response>` +
      `<Gather numDigits="1" action="${escapeXml(actionUrl)}" method="POST">` +
        `<Say voice="alice">Hello from Med Time. This is your medication reminder. ` +
        `It is time to take your ${escapeXml(medName)}. ` +
        `Press 1 if you have taken it. Press 2 to snooze for 10 minutes.</Say>` +
      `</Gather>` +
      `<Say voice="alice">We did not receive any input. Goodbye!</Say>` +
    `</Response>`
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/webhooks/voice/alert?alertId=...
// Twilio fetches this when a caregiver alert call connects (A2.5, notify_caregiver).
// Says the alert twice, then hangs up.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/voice/alert', async (req, res) => {
  const CaregiverAlert = require('../models/CaregiverAlert');
  let message = 'This is Med Time. Please check on your family member as soon as you can.';
  try {
    const alert = req.query.alertId ? await CaregiverAlert.findById(req.query.alertId).lean() : null;
    if (alert && alert.message) message = alert.message;
  } catch (error) {
    console.error('❌ [Voice Alert] Could not load alert:', error.message);
  }
  const said = escapeXml(message);
  res.type('text/xml').send(
    `<Response>` +
      `<Say voice="alice">${said}</Say>` +
      `<Pause length="1"/>` +
      `<Say voice="alice">Again: ${said}</Say>` +
      `<Hangup/>` +
    `</Response>`
  );
});

router.post('/voice', async (req, res) => {
  const digits = (req.body || {}).Digits; // '1' or '2'
  const { medicineId, reminderId } = req.query; // put in the URL by makePatientCall()

  console.log(`📞 [Voice Webhook] Digit pressed: "${digits}" | reminderId: ${reminderId || '-'} | medicineId: ${medicineId || '-'}`);

  // Helper: always returns valid TwiML so Twilio never gets a blank response
  const respond = (message) => {
    res.type('text/xml').send(`<Response><Say voice="alice">${escapeXml(message)}</Say></Response>`);
  };

  if (!reminderId && !medicineId) {
    console.warn('⚠️  [Voice Webhook] No reminderId or medicineId in query — nothing to update.');
    return respond('Thank you. Goodbye!');
  }

  try {
    // A1.3: the key press changes exactly the dose this call was about.
    const dose = await findCallDose({ reminderId, medicineId });
    if (!dose) {
      console.error(`❌ [Voice Webhook] No dose found (reminderId: ${reminderId}, medicineId: ${medicineId})`);
      return respond('Sorry, we could not find your medication record. Please contact support.');
    }
    const medName = dose.medicine?.name || 'medicine';

    if (digits === '1') {
      // ── CONFIRMED: markDose records it and disarms this dose's escalation ──
      const r = await markDose(dose._id, 'taken', 'ivr');
      if (!r.ok) throw new Error(r.error);
      console.log(`✅ [Voice Webhook] ${medName} (reminder ${dose._id}) marked TAKEN${r.alreadyRecorded ? ' (already recorded)' : ''} — this dose's escalation disarmed.`);
      return respond(`Thank you! We have recorded that you took your ${medName}. Have a great day!`);
    }

    if (digits === '2') {
      // ── SNOOZED: call again in 10 minutes; caregiver clock paused till then ──
      const snoozeTime = new Date(Date.now() + 10 * 60 * 1000);
      const snoozed = await Reminder.findOneAndUpdate(
        { _id: dose._id, status: { $in: ['pending', 'alerted'] } },
        { $set: { snoozeUntil: snoozeTime, caregiverAlertTime: null } },
      );
      if (!snoozed) {
        console.log(`⏰ [Voice Webhook] ${medName} (reminder ${dose._id}) is already ${dose.status}; not snoozed.`);
        return respond(dose.status === 'taken'
          ? `Your ${medName} is already recorded as taken. Please don't take another one. Goodbye!`
          : 'Thank you. Your family will check in with you. Goodbye!');
      }
      console.log(`⏰ [Voice Webhook] ${medName} (reminder ${dose._id}) SNOOZED until ${snoozeTime.toLocaleTimeString()}.`);
      return respond('No problem. We will call you again in 10 minutes. Goodbye!');
    }

    // ── No input / unexpected digit ──────────────────────────────────────────
    console.warn(`⚠️  [Voice Webhook] Unexpected digit: "${digits}" for ${medName}`);
    return respond('We did not understand your input. Please try again when we call back.');
  } catch (error) {
    console.error('❌ [Voice Webhook] Error updating the dose:', error);
    return respond('Sorry, an error occurred. Please try again. Goodbye.');
  }
});

module.exports = router;