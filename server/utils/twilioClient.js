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
const NGROK_URL = process.env.NGROK_URL || 'https://cardiac-gallstone-quartet.ngrok-free.dev';

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
  const webhookUrl  = `${NGROK_URL}/api/v1/webhooks/voice?medicineId=${medicineId}`;

  if (!client) {
    console.log(`[SIMULATION] Voice Call → ${formattedTo} for "${medName}" (medicineId: ${medicineId})`);
    return true;
  }

  try {
    const call = await client.calls.create({
      twiml: `
        <Response>
          <Gather numDigits="1" action="${webhookUrl}" method="POST">
            <Say voice="alice">
              Hello from Med Time. This is your medication reminder.
              It is time to take your ${medName}.
              Press 1 if you have taken it. Press 2 to snooze for 10 minutes.
            </Say>
          </Gather>
          <Say voice="alice">We did not receive any input. Goodbye!</Say>
        </Response>
      `,
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

module.exports = { sendSMS, makeCall, sendCaregiverSMS, makePatientCall };