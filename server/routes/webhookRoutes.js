const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const User = require('../models/User');
const Patient = require('../models/Patient');
const Reminder = require('../models/Reminder');
const Medicine = require('../models/Medicine');
const { verifyTwilioSignature } = require('../middleware/twilioSignature');
const { publicBaseUrl } = require('../utils/publicUrl');

const MessagingResponse = twilio.twiml.MessagingResponse;

// A1.1: every route below is called by Twilio, so each request must carry a
// valid X-Twilio-Signature. Forged requests get 403 before any handler runs.
router.use(verifyTwilioSignature);

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

    if (incomingMsg === '1') {
      recentReminder.status = 'taken';
      await recentReminder.save();
      twiml.message("✅ Confirmed! We've recorded that you took your medicine. Have a great day!");
    } else if (incomingMsg === '2') {
      recentReminder.status = 'skipped';
      await recentReminder.save();
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
// The cron job embeds ?medicineId=<id> in the <Gather action> URL so we
// know exactly which Medicine document to update — no ambiguity.
//
// Digits === '1'  → Patient confirmed: mark taken, disarm escalation clock.
// Digits === '2'  → Patient snoozed:   set snoozeUntil = now + 10 min,
//                                       disarm caregiverAlertTime so no false
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

router.post('/voice/prompt', async (req, res) => {
  const medicineId = req.query.medicineId;
  const baseUrl = publicBaseUrl();

  let medName = 'medicine';
  try {
    const medicine = medicineId ? await Medicine.findById(medicineId) : null;
    if (medicine?.name) medName = medicine.name;
  } catch (error) {
    console.error('❌ [Voice Prompt] Could not load medicine:', error.message);
  }

  const actionUrl = `${baseUrl}/api/v1/webhooks/voice?medicineId=${encodeURIComponent(medicineId || '')}`;
  console.log(`📞 [Voice Prompt] Serving menu for "${medName}" (medicineId: ${medicineId})`);

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
  const digits     = req.body.Digits;           // '1' or '2'
  const medicineId = req.query.medicineId;      // Injected by makePatientCall()

  console.log(`📞 [Voice Webhook] Digit pressed: "${digits}" | medicineId: ${medicineId}`);

  // Helper: always returns valid TwiML so Twilio never gets a blank response
  const respond = (message) => {
    res.type('text/xml').send(`<Response><Say voice="alice">${message}</Say></Response>`);
  };

  if (!medicineId) {
    console.warn('⚠️  [Voice Webhook] No medicineId in query — falling back to legacy flow.');
    return respond('Thank you. Goodbye!');
  }

  try {
    const medicine = await Medicine.findById(medicineId);

    if (!medicine) {
      console.error(`❌ [Voice Webhook] Medicine not found for id: ${medicineId}`);
      return respond('Sorry, we could not find your medication record. Please contact support.');
    }

    if (digits === '1') {
      // ── CONFIRMED: disarm every escalation field on Medicine ───────────────
      medicine.snoozeUntil        = null;
      medicine.caregiverAlertTime = null;
      medicine.caregiverAlerted   = false;  // ← clears the red "missed" UI state
      await medicine.save();

      // ── CRITICAL: also mark the Reminder as 'taken' ────────────────────────
      // The GET /medicines endpoint derives displayStatus from the Reminder model,
      // NOT from Medicine fields. Without this, the card stays yellow ("due") even
      // after the patient presses 1, because the Reminder is still 'alerted'.
      const confirmedReminder = await Reminder.findOne({
        medicine: medicine._id,
        scheduledTime: { $lte: new Date() }, // ← CRITICAL: only past slots, not tomorrow's reminder
        status: { $in: ['alerted', 'pending'] }
      }).sort({ scheduledTime: -1 }); // -1 = most recent past reminder first

      if (confirmedReminder) {
        confirmedReminder.status      = 'taken';
        confirmedReminder.confirmedAt = new Date();
        confirmedReminder.confirmedBy = 'ivr';
        await confirmedReminder.save();
        console.log(`✅ [Voice Webhook] Reminder also marked TAKEN for ${medicine.name}.`);
      }

      console.log(`✅ [Voice Webhook] ${medicine.name} marked as TAKEN — escalation clock disarmed.`);
      return respond(`Thank you! We have recorded that you took your ${medicine.name}. Have a great day!`);

    } else if (digits === '2') {
      // ── SNOOZED: set wake-up time, disarm caregiver clock until recall ─────
      const snoozeTime = new Date(Date.now() + 10 * 60 * 1000); // +10 minutes
      medicine.snoozeUntil        = snoozeTime;
      medicine.caregiverAlertTime = null; // Clock paused — will re-arm after recall
      await medicine.save();

      console.log(`⏰ [Voice Webhook] ${medicine.name} SNOOZED until ${snoozeTime.toLocaleTimeString()}.`);
      return respond('No problem. We will call you again in 10 minutes. Goodbye!');

    } else {
      // ── No input / unexpected digit ────────────────────────────────────────
      console.warn(`⚠️  [Voice Webhook] Unexpected digit: "${digits}" for ${medicine.name}`);
      return respond('We did not understand your input. Please try again when we call back.');
    }

  } catch (error) {
    console.error('❌ [Voice Webhook] Error updating medicine:', error);
    return respond('Sorry, an error occurred. Please try again. Goodbye.');
  }
});

module.exports = router;