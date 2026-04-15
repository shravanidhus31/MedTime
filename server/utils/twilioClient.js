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

  try {
    const call = await client.calls.create({
      // TwiML is the script the robot will read. 
      // We use the <Say> tag to generate text-to-speech.
      twiml: `
        <Response>
          <Say voice="alice">
            Hello from Med Time. This is your automated reminder. 
            It is time to take your ${medName}, ${dosage}. 
            Instructions are: ${mealTiming} food. 
            Have a wonderful day.
          </Say>
        </Response>
      `,
      to: `+91${to}`, // Ensure country code is here for calls
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