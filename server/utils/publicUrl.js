// The public base URL that Twilio calls back on, e.g. https://<service>.onrender.com
// (A1.1). Every callback URL we give Twilio, and every URL we check a Twilio
// signature against, is built from this one value, so the two always match.
// Trailing slashes are dropped. Returns '' when it isn't set.
//
// NGROK_URL is still read as a fallback until A1.2 makes PUBLIC_BASE_URL the
// only setting.
const publicBaseUrl = () =>
  (process.env.PUBLIC_BASE_URL || process.env.NGROK_URL || '').trim().replace(/\/+$/, '');

module.exports = { publicBaseUrl };
