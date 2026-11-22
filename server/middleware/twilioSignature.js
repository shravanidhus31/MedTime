// Checks that a webhook really comes from Twilio for our call (A1.1, PRD Phase 0 #4).
//
// Two ways to pass, either is enough:
//   1. Twilio's signature: the X-Twilio-Signature header, made with our auth token over the exact
//      URL it called plus the POST parameters. We rebuild that URL from PUBLIC_BASE_URL and
//      req.originalUrl, because behind Render's proxy req.protocol and the Host header can't be
//      trusted to match what Twilio used.
//   2. A capability in the URL we gave Twilio ourselves (third real call, 22 Nov: Twilio's request
//      for the agent call arrived with NO signature header, so every call played Twilio's error):
//        - `t`: an HMAC of the record the URL is about (reminder, medicine or alert), made with a
//          server-side key (webhookToken). We put it in every URL we hand to Twilio.
//        - or a route-specific check (`allow`), e.g. the call's session id: a random UUID that
//          only Twilio (in our TwiML) and this server know.
//      Nobody can make a valid `t` without the key, so a forged request still fails.
//
// - Twilio on: one of the two must hold, or the request gets 403 (and the log says which headers
//   did arrive, to see why a signature was missing).
// - Twilio off locally (no credentials, or TWILIO_ENABLED=false): checks are skipped, so the
//   simulator and curl work. In production (utils/runtime.js) Twilio being off rejects every
//   webhook instead, so a misconfigured server is never left open.
const crypto = require('crypto');
const twilio = require('twilio');
const { publicBaseUrl } = require('../utils/publicUrl');
const { isProduction, twilioEnabled } = require('../utils/runtime');

const forbid = (res) => res.status(403).type('text/plain').send('Forbidden');

// The key for URL tokens: WEBHOOK_SECRET if set, else the Twilio auth token, else the JWT secret.
// Server-side only; tokens stay valid across restarts while the key is unchanged.
const tokenKey = () => process.env.WEBHOOK_SECRET || process.env.TWILIO_AUTH_TOKEN || process.env.JWT_SECRET || '';

// The token for one record id (or a fixed name such as 'incoming').
function webhookToken(value) {
  const key = tokenKey();
  if (!key || !value) return '';
  return crypto.createHmac('sha256', key).update(`medtime-webhook:${value}`).digest('hex').slice(0, 32);
}

// path + `t=<token>` (adds ? or &).
function withToken(path, value) {
  const t = webhookToken(value);
  if (!t) return path;
  return `${path}${path.includes('?') ? '&' : '?'}t=${t}`;
}

function sameToken(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

let warnedBase = false;
let warnedUnsigned = false;

// verifyTwilio({ tokenOf, allow }) → middleware.
//   tokenOf(req) → the value the URL's `t` was made from (e.g. req.query.reminderId), or null
//   allow(req)   → true when the route can vouch for the request itself (e.g. a live session id)
function verifyTwilio({ tokenOf, allow } = {}) {
  return function verifyTwilioRequest(req, res, next) {
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const where = `${req.method} ${req.originalUrl.replace(/([?&]t=)[0-9a-f]+/, '$1…')}`;

    if (!twilioEnabled()) {
      if (isProduction()) {
        console.error(`🚫 [Twilio] Twilio is off or has no credentials in production; rejecting ${where}`);
        return forbid(res);
      }
      return next(); // simulation mode
    }

    const base = publicBaseUrl();
    const signature = req.get('X-Twilio-Signature');
    const params = req.body && typeof req.body === 'object' ? req.body : {};
    const urls = base ? candidateUrls(base, req) : [];
    const matched = signature && urls.find((u) => twilio.validateRequest(authToken, signature, u, params));
    if (matched) {
      if (matched !== urls[0] && !warnedBase) {
        warnedBase = true;
        console.warn(`⚠️  [Twilio] Twilio signed ${matched.split('/api/')[0]} but PUBLIC_BASE_URL is ${base}. Set PUBLIC_BASE_URL to the https address.`);
      }
      return next();
    }

    // No valid signature: the capability in our own URL.
    let viaUrl = false;
    try {
      const value = tokenOf ? tokenOf(req) : null;
      viaUrl = (value && sameToken(webhookToken(value), req.query && req.query.t)) || (allow ? !!allow(req) : false);
    } catch (err) {
      viaUrl = false;
    }
    if (viaUrl) {
      if (!signature && !warnedUnsigned) {
        warnedUnsigned = true;
        console.warn(`⚠️  [Twilio] Twilio sent no signature header (${where}); accepted by the token in our own URL. Headers present: ${headerNames(req)}`);
      }
      return next();
    }

    // The URLs are our own public address, not secrets: logged so a mismatch can be seen.
    console.warn(`🚫 [Twilio] Rejected webhook with a ${signature ? 'bad' : 'missing'} signature and no valid URL token: ${where}. Checked against: ${urls.join(' , ') || '(PUBLIC_BASE_URL not set)'}. Headers present: ${headerNames(req)}`);
    return forbid(res);
  };
}

// Header names only (no values, except the user agent), to see what reached us.
function headerNames(req) {
  const names = Object.keys(req.headers || {}).filter((h) => !/^(cookie|authorization)$/i.test(h));
  return `${names.join(', ')}; user-agent "${String(req.get('user-agent') || '').slice(0, 60)}"`;
}

// The URL Twilio signed is our public address plus the path. It is normally PUBLIC_BASE_URL; the
// https form is also accepted (an http:// PUBLIC_BASE_URL is redirected to https by Render), as are
// Render's own address for this service (RENDER_EXTERNAL_URL) and the https address the request
// arrived on. A forged request still fails: without the auth token no URL gives a valid signature.
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

// Signature only (no URL token): for routes whose URL we don't build ourselves.
const verifyTwilioSignature = verifyTwilio();

module.exports = { verifyTwilioSignature, verifyTwilio, webhookToken, withToken };
