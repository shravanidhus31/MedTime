// Where the server is running and whether Twilio is switched on (A1.2).
// Read at call time, not at load time, so tests can change the environment.

// Render sets NODE_ENV=production for Node services at runtime, and RENDER=true
// on every service (render.com/docs/environment-variables). Either one counts.
const isProduction = () => process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';

// TWILIO_ENABLED=false (or 0 / no / off) turns Twilio off even when credentials
// are present: calls and SMS are only logged. Unset means "on if credentials exist".
const twilioSwitchedOff = () => /^(false|0|no|off)$/i.test(String(process.env.TWILIO_ENABLED || '').trim());

const twilioEnabled = () =>
  !twilioSwitchedOff() && !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);

module.exports = { isProduction, twilioEnabled, twilioSwitchedOff };
