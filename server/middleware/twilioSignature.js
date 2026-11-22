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
  const params = req.body && typeof req.body === 'object' ? req.body : {};
  const urls = candidateUrls(base, req);
  const matched = signature && urls.find((u) => twilio.validateRequest(authToken, signature, u, params));
  if (!matched) {
    // The URLs are our own public address, not secrets: logged so a mismatch can be seen.
    console.warn(`🚫 [Twilio] Rejected webhook with a ${signature ? 'bad' : 'missing'} signature: ${where}. Checked against: ${urls.join(' , ')}`);
    return forbid(res);
  }
  if (matched !== urls[0] && !warnedBase) {
    warnedBase = true;
    console.warn(`⚠️  [Twilio] Twilio signed ${matched.split('/api/')[0]} but PUBLIC_BASE_URL is ${base}. Set PUBLIC_BASE_URL to the https address.`);
  }
  return next();
}

// The URL Twilio signed is our public address plus the path. It is normally PUBLIC_BASE_URL; the
// https form is also accepted (found on the first real call, 22 Nov: an http:// PUBLIC_BASE_URL
// is redirected to https by Render, and Twilio signs the https URL it ends up at). The signature
// still needs our auth token; only the scheme of our own address may differ.
// Also accepted: Render's own address for this service (RENDER_EXTERNAL_URL), and the https address
// the request arrived on (Render's proxy sets X-Forwarded-Host/Proto). A forged request still fails:
// without the auth token no URL gives a valid signature.
let warnedBase = false;
function candidateUrls(base, req) {
  const path = req.originalUrl;
  const out = [base + path];
  if (/^http:\/\//i.test(base)) out.push(base.replace(/^http:/i, 'https:') + path);
  const render = (process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, '');
  if (render) out.push(render + path);
  const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  if (host) out.push(`https://${host}${path}`);
  return [...new Set(out)];
}

module.exports = { verifyTwilioSignature };
