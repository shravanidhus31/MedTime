require('dotenv').config();
const twilio = require('twilio');

// Initialize Twilio client only if credentials exist to prevent crashes during dev
let client;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

const sendSMS = async (to, message) => {
  if (!client) {
    console.log(`[TWILIO SIMULATION] Would send SMS to ${to}: "${message}"`);
    return true; // Fake success for local testing without credentials
  }

  try {
    const response = await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: `+91${to}` // Assuming India country code
    });
    console.log(`💬 SMS sent successfully to ${to}. SID: ${response.sid}`);
    return response.sid;
  } catch (error) {
    console.error(`❌ Failed to send SMS to ${to}:`, error.message);
    throw error;
  }
};

const makeCall = async (to, medName, dosage, mealTiming) => {
  if (!client) {
    console.log(`[TWILIO SIMULATION] Would call ${to} for ${medName}`);
    return true; 
  }

  // ⚠️ PASTE YOUR ACTIVE NGROK URL HERE (No trailing slash)
  const ngrokUrl = 'https://cardiac-gallstone-quartet.ngrok-free.dev';

  try {
    const call = await client.calls.create({
      // We use <Gather> to listen for exactly 1 digit. 
      // When pressed, it POSTs that digit to our new webhook route.
      twiml: `
        <Response>
          <Gather numDigits="1" action="${ngrokUrl}/api/v1/webhooks/voice" method="POST">
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
      to: `+91${to}`, 
      from: process.env.TWILIO_PHONE_NUMBER
    });
    console.log(`📞 Call initiated to ${to}. Call SID: ${call.sid}`);
    return call;
  } catch (error) {
    console.error('❌ Error making voice call:', error.message);
    throw error;
  }
};

// Export both functions!
module.exports = { sendSMS, makeCall };