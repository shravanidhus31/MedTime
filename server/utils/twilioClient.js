require('dotenv').config();
const twilio = require('twilio');
const { publicBaseUrl } = require('./publicUrl');
const { twilioEnabled, twilioSwitchedOff } = require('./runtime');

// ── Twilio client ─────────────────────────────────────────────────────────────
// Off (simulation mode) when TWILIO_ENABLED=false or credentials are missing:
// calls and SMS are only logged (A1.2). Checked on every send, so tests can
// switch it.
let cachedClient = null;
const getClient = () => {
  if (!twilioEnabled()) return null;
  if (!cachedClient) cachedClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return cachedClient;
};

if (twilioSwitchedOff()) {
  console.warn('⚠️  [Twilio] TWILIO_ENABLED=false: running in simulation mode (calls and SMS are only logged).');
} else if (!twilioEnabled()) {
  console.warn('⚠️  [Twilio] No credentials found: running in simulation mode (calls and SMS are only logged).');
}

// ── Callback URLs ─────────────────────────────────────────────────────────────
// Every URL Twilio calls back on is PUBLIC_BASE_URL + path (A1.2). There is no
// fallback: in production the server won't start without it (index.js), and
// here a missing value is a clear error instead of a dead tunnel.
const callbackUrl = (path) => {
  const base = publicBaseUrl();
  if (!base) throw new Error(`PUBLIC_BASE_URL is not set, so Twilio can't reach ${path}`);
  return base + path;
};

const withCountryCode = (phone) => (String(phone).startsWith('+') ? String(phone) : `+91${phone}`);

// ─────────────────────────────────────────────────────────────────────────────
// sendSMS — sends an SMS to the patient (e.g. for initial dose reminders).
// Throws on failure, so the caller can count retries.
// ─────────────────────────────────────────────────────────────────────────────
const sendSMS = async (to, message) => {
  const formattedTo = withCountryCode(to);
  const client = getClient();

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
// sendCaregiverSMS — sends an escalation/alert SMS to the caregiver.
// Never throws (used by the vitals alert). Missed-dose alerts are phone calls
// on the trial (A1.3, services/caregiverAlerts.js).
// ─────────────────────────────────────────────────────────────────────────────
const sendCaregiverSMS = async (toPhone, messageBody) => {
  const formattedPhone = withCountryCode(toPhone);
  const client = getClient();

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
    // Don't throw — a failed caregiver alert must never crash the caller
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// makePatientCall — calls the patient with a voice IVR menu.
//   toPhone    : patient phone (with or without +91)
//   medName    : medicine name to read aloud
//   medicineId : MongoDB _id of the Medicine document
//   reminderId : MongoDB _id of the Reminder (the dose) this call is about (A1.3).
//                Both go into the webhook URLs, so a key press changes exactly
//                this dose; medicineId alone is the old form, still understood.
// Twilio fetches the call's TwiML from our server: trial accounts reject the
// inline `twiml` parameter but accept a `url` pointing at our own server.
// ─────────────────────────────────────────────────────────────────────────────
const makePatientCall = async (toPhone, medName, medicineId, reminderId) => {
  const formattedTo = withCountryCode(toPhone);
  const query = new URLSearchParams({ medicineId: String(medicineId) });
  if (reminderId) query.set('reminderId', String(reminderId));
  const path = `/api/v1/webhooks/voice/prompt?${query}`;
  const client = getClient();

  if (!client) {
    console.log(`[SIMULATION] Voice Call → ${formattedTo} for "${medName}" (medicineId: ${medicineId}, reminderId: ${reminderId || '-'})`);
    return true;
  }

  try {
    const call = await client.calls.create({
      url: callbackUrl(path),
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
//   simulation mode. Throws if the call can't be placed.
// ─────────────────────────────────────────────────────────────────────────────
const makeAlertCall = async (toPhone, alertId) => {
  const formattedTo = withCountryCode(toPhone);
  const path = `/api/v1/webhooks/voice/alert?alertId=${encodeURIComponent(alertId)}`;
  const client = getClient();

  if (!client) {
    console.log(`[SIMULATION] Caregiver alert call → ${formattedTo} (alertId: ${alertId})`);
    return true;
  }

  const call = await client.calls.create({
    url: callbackUrl(path),
    to: formattedTo,
    from: process.env.TWILIO_PHONE_NUMBER,
  });
  console.log(`📞 Caregiver alert call to ${formattedTo}. Call SID: ${call.sid}`);
  return call;
};

module.exports = { sendSMS, sendCaregiverSMS, makePatientCall, makeAlertCall, callbackUrl };
