// Checks the X-Twilio-Signature header on Twilio webhooks (A1.1, PRD Phase 0 #4).
//
// Twilio signs each request with our auth token over the exact URL it called
// plus the POST parameters. We rebuild that URL from PUBLIC_BASE_URL and
// req.originalUrl, because behind Render's proxy req.protocol and the Host
// header can't be trusted to match what Twilio used.
//
// - Twilio on: the signature must be valid, or the request gets 403.
// - Twilio off locally (no credentials, or TWILIO_ENABLED=false): checks are
//   skipped, so the simulator and curl work. In production (utils/runtime.js)
//   Twilio being off rejects every webhook instead, so a misconfigured server
//   is never left open.
const twilio = require('twilio');
const { publicBaseUrl } = require('../utils/publicUrl');
const { isProduction, twilioEnabled } = require('../utils/runtime');

const forbid = (res) => res.status(403).type('text/plain').send('Forbidden');

function verifyTwilioSignature(req, res, next) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const where = `${req.method} ${req.originalUrl}`;

  if (!twilioEnabled()) {
    if (isProduction()) {
      console.error(`🚫 [Twilio] Twilio is off or has no credentials in production; rejecting ${where}`);
      return forbid(res);
    }
    return next(); // simulation mode
  }

  const base = publicBaseUrl();
  if (!base) {
    console.error(`🚫 [Twilio] PUBLIC_BASE_URL is not set, so signatures can't be checked; rejecting ${where}`);
    return forbid(res);
  }

  const signature = req.get('X-Twilio-Signature');
  const url = base + req.originalUrl;
  const params = req.body && typeof req.body === 'object' ? req.body : {};
  if (!signature || !twilio.validateRequest(authToken, signature, url, params)) {
    console.warn(`🚫 [Twilio] Rejected webhook with a missing or bad signature: ${where}`);
    return forbid(res);
  }
  return next();
}

module.exports = { verifyTwilioSignature };
