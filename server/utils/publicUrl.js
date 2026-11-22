// The public base URL that Twilio calls back on, e.g. https://<service>.onrender.com
// (A1.1, A1.2). Every callback URL we give Twilio, and every URL we check a Twilio
// signature against, is built from this one value, so the two always match.
// Trailing slashes are dropped. Returns '' when it isn't set.
//
// PUBLIC_BASE_URL is the only setting. The old NGROK_URL is no longer read.
const { isProduction, twilioEnabled } = require('./runtime');

const publicBaseUrl = () => (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');

// Startup check (A1.2). Returns { ok, error?, warning? }:
// - production: PUBLIC_BASE_URL must be set and be an http(s) URL, or the server
//   refuses to start (error);
// - local: a missing URL is fine in simulation mode, and only a warning if Twilio is on.
function checkPublicBaseUrl() {
  const base = publicBaseUrl();
  const prod = isProduction();

  if (!base) {
    const hints = [];
    if (process.env.RENDER_EXTERNAL_URL) hints.push(`On this Render service it is probably ${process.env.RENDER_EXTERNAL_URL}`);
    if (process.env.NGROK_URL) hints.push('NGROK_URL is set but no longer read: rename it to PUBLIC_BASE_URL');
    const hint = hints.length ? ` ${hints.join('. ')}.` : '';
    if (prod) {
      return {
        ok: false,
        error: `PUBLIC_BASE_URL is not set. Twilio needs it to reach this server (call menus, key presses, ` +
          `caregiver alerts, signature checks). Set it to the public https URL, with no trailing slash.${hint}`,
      };
    }
    if (twilioEnabled()) {
      return { ok: true, warning: `PUBLIC_BASE_URL is not set, so real Twilio calls will fail.${hint}` };
    }
    return { ok: true };
  }

  let url;
  try { url = new URL(base); } catch { url = null; }
  if (!url || !/^https?:$/.test(url.protocol)) {
    const msg = `PUBLIC_BASE_URL "${base}" is not an http(s) URL.`;
    return prod ? { ok: false, error: msg } : { ok: true, warning: msg };
  }
  if (prod && url.protocol !== 'https:') {
    return { ok: true, warning: `PUBLIC_BASE_URL "${base}" is not https.` };
  }
  return { ok: true };
}

module.exports = { publicBaseUrl, checkPublicBaseUrl };
