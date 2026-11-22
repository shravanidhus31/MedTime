require('dotenv').config();
const twilio = require('twilio');

// ── Twilio client (graceful no-op in dev if credentials are missing) ──────────
let client;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
} else {
  console.warn('⚠️  [Twilio] No credentials found — running in simulation mode.');
}

// ── Base ngrok URL for webhook callbacks ─────────────────────────────────────
// Keep this in sync with your active ngrok tunnel.
// A1.1: the same base the webhook signature check uses (utils/publicUrl.js), so
// the URL Twilio calls and the URL we verify against always match. The old
// hard-coded tunnel is only a last resort until A1.2 removes it.
const NGROK_URL = require('./publicUrl').publicBaseUrl() || 'https://cardiac-gallstone-quartet.ngrok-free.dev';

// ─────────────────────────────────────────────────────────────────────────────
// sendSMS — sends an SMS to the patient (e.g. for initial dose reminders)
// ─────────────────────────────────────────────────────────────────────────────
const sendSMS = async (to, message) => {
  const formattedTo = to.startsWith('+') ? to : `+91${to}`;

  if (!client) {
    console.log(`[SIMULATION] SMS → ${formattedTo}: "${message}"`);
    return true;
  }

  try {
    const response = await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: formattedTo,
    });
    console.log(`💬 SMS sent to ${formattedTo}. SID: ${response.sid}`);
    return response.sid;
  } catch (error) {
    console.error(`❌ SMS failed to ${formattedTo}:`, error.message);
    throw error;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// sendCaregiverSMS — sends an escalation/alert SMS to the caregiver
// ─────────────────────────────────────────────────────────────────────────────
const sendCaregiverSMS = async (toPhone, messageBody) => {
  const formattedPhone = toPhone.startsWith('+') ? toPhone : `+91${toPhone}`;

  if (!client) {
    console.log(`[SIMULATION] Caregiver SMS → ${formattedPhone}: "${messageBody}"`);
    return true;
  }

  try {
    const response = await client.messages.create({
      body: messageBody,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: formattedPhone,
    });
    console.log(`📱 Caregiver SMS sent to ${formattedPhone}. SID: ${response.sid}`);
    return response.sid;
  } catch (error) {
    console.error(`❌ Caregiver SMS failed to ${formattedPhone}:`, error.message);
    // Don't throw — a failed caregiver alert must never crash the cron job
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// makePatientCall — calls the patient with a voice IVR menu.
//   toPhone    : patient phone (with or without +91)
//   medName    : medicine name to read aloud
//   medicineId : MongoDB _id of the Medicine document — embedded in the
//                webhook action URL so /voice knows which medicine to update.
// ─────────────────────────────────────────────────────────────────────────────
const makePatientCall = async (toPhone, medName, medicineId) => {
  const formattedTo = toPhone.startsWith('+') ? toPhone : `+91${toPhone}`;
  // Twilio fetches the call's TwiML from our server. Trial accounts reject the
  // inline `twiml` parameter ("trial accounts have limited parameter access"),
  // but accept a `url` pointing at our own server.
  const promptUrl = `${NGROK_URL}/api/v1/webhooks/voice/prompt?medicineId=${medicineId}`;

  if (!client) {
    console.log(`[SIMULATION] Voice Call → ${formattedTo} for "${medName}" (medicineId: ${medicineId})`);
    return true;
  }

  try {
    const call = await client.calls.create({
      url: promptUrl,
      to: formattedTo,
      from: process.env.TWILIO_PHONE_NUMBER,
    });
    console.log(`📞 Voice call initiated to ${formattedTo}. Call SID: ${call.sid}`);
    return call;
  } catch (error) {
    console.error(`❌ Voice call failed to ${formattedTo}:`, error.message);
    throw error;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// makeAlertCall — phones a caregiver with a short spoken alert (A2.5).
//   Twilio fetches the words from POST /api/v1/webhooks/voice/alert?alertId=...
//   (a URL, because the trial rejects inline TwiML). Returns the call, or true in
//   simulation mode.
// ─────────────────────────────────────────────────────────────────────────────
const makeAlertCall = async (toPhone, alertId) => {
  const formattedTo = toPhone.startsWith('+') ? toPhone : `+91${toPhone}`;
  const baseUrl = NGROK_URL;
  const alertUrl = `${baseUrl}/api/v1/webhooks/voice/alert?alertId=${encodeURIComponent(alertId)}`;

  if (!client) {
    console.log(`[SIMULATION] Caregiver alert call → ${formattedTo} (alertId: ${alertId})`);
    return true;
  }

  const call = await client.calls.create({
    url: alertUrl,
    to: formattedTo,
    from: process.env.TWILIO_PHONE_NUMBER,
  });
  console.log(`📞 Caregiver alert call to ${formattedTo}. Call SID: ${call.sid}`);
  return call;
};

// ─────────────────────────────────────────────────────────────────────────────
// makeCall — LEGACY helper used by reminderJob.js (kept intact)
// ─────────────────────────────────────────────────────────────────────────────
const makeCall = async (to, medName, dosage, mealTiming) => {
  const formattedTo = to.startsWith('+') ? to : `+91${to}`;

  if (!client) {
    console.log(`[SIMULATION] Legacy Voice Call → ${formattedTo} for "${medName}"`);
    return true;
  }

  try {
    const call = await client.calls.create({
      twiml: `
        <Response>
          <Gather numDigits="1" action="${NGROK_URL}/api/v1/webhooks/voice" method="POST">
            <Say voice="alice">
              Hello from Med Time. This is your automated reminder.
              It is time to take your ${medName}, ${dosage}.
              Instructions are: ${mealTiming} food.
              Press 1 to confirm you have taken it. Press 2 to skip.
            </Say>
          </Gather>
          <Say voice="alice">We didn't receive any input. Goodbye!</Say>
        </Response>
      `,
      to: formattedTo,
      from: process.env.TWILIO_PHONE_NUMBER,
    });
    console.log(`📞 Legacy call initiated to ${formattedTo}. Call SID: ${call.sid}`);
    return call;
  } catch (error) {
    console.error('❌ Legacy voice call error:', error.message);
    throw error;
  }
};

module.exports = { sendSMS, makeCall, sendCaregiverSMS, makePatientCall, makeAlertCall };