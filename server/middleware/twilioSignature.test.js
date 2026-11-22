// Offline tests for the Twilio webhook signature check (A1.1). They use the real
// webhook router; no database is needed because every request either fails the
// check or hits a branch that doesn't query the database.

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const twilio = require('twilio');

const TOKEN = 'test-auth-token';
const BASE = 'https://medtime.example.test';
const saved = {};
const ENV = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_ENABLED', 'PUBLIC_BASE_URL', 'NODE_ENV', 'RENDER'];

let server, local;
test.before(() => {
  for (const k of ENV) saved[k] = process.env[k];
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use('/api/v1/webhooks', require('../routes/webhookRoutes'));
  server = app.listen(0);
  local = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
test.beforeEach(() => {
  process.env.TWILIO_ACCOUNT_SID = 'AC' + '0'.repeat(32);
  process.env.TWILIO_AUTH_TOKEN = TOKEN;
  process.env.PUBLIC_BASE_URL = BASE;
  delete process.env.TWILIO_ENABLED;
  delete process.env.RENDER;
  process.env.NODE_ENV = 'test';
});

// POSTs form params to `path`; `sign` gives the public URL Twilio would have signed.
const post = async (path, params, { sign, signature } = {}) => {
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (sign) headers['X-Twilio-Signature'] = twilio.getExpectedTwilioSignature(TOKEN, sign, params);
  if (signature) headers['X-Twilio-Signature'] = signature;
  const res = await fetch(local + path, { method: 'POST', headers, body: new URLSearchParams(params) });
  return { status: res.status, text: await res.text() };
};

test('a forged voice webhook with no signature is rejected with 403', async () => {
  const r = await post('/api/v1/webhooks/voice?medicineId=abc', { Digits: '1' });
  assert.equal(r.status, 403);
});

test('a made-up signature is rejected, on every webhook route', async () => {
  for (const path of ['/api/v1/webhooks/voice', '/api/v1/webhooks/voice/prompt', '/api/v1/webhooks/voice/alert', '/api/v1/webhooks/sms']) {
    const r = await post(path, { Digits: '1' }, { signature: 'bm90LWEtcmVhbC1zaWduYXR1cmU=' });
    assert.equal(r.status, 403, path);
  }
});

test('a correctly signed request gets through (the URL is PUBLIC_BASE_URL + the path and query)', async () => {
  const path = '/api/v1/webhooks/voice';
  const r = await post(path, { Digits: '1' }, { sign: BASE + path });
  assert.equal(r.status, 200);
  assert.match(r.text, /<Response>/);
});

test('a trailing slash on PUBLIC_BASE_URL still matches', async () => {
  process.env.PUBLIC_BASE_URL = BASE + '/';
  const path = '/api/v1/webhooks/voice/alert';
  const r = await post(path, {}, { sign: BASE + path });
  assert.equal(r.status, 200);
});

test('a signature for different params or a different URL is rejected', async () => {
  const path = '/api/v1/webhooks/voice';
  const sig = twilio.getExpectedTwilioSignature(TOKEN, BASE + path, { Digits: '2' });
  assert.equal((await post(path, { Digits: '1' }, { signature: sig })).status, 403); // params changed
  const r = await post(path, { Digits: '1' }, { sign: 'http://127.0.0.1' + path }); // host Twilio didn't call
  assert.equal(r.status, 403);
});

test('without PUBLIC_BASE_URL a signed request is still rejected', async () => {
  delete process.env.PUBLIC_BASE_URL;
  const path = '/api/v1/webhooks/voice';
  assert.equal((await post(path, { Digits: '1' }, { sign: BASE + path })).status, 403);
});

test('simulation mode: no auth token skips the check locally, but rejects in production', async () => {
  delete process.env.TWILIO_AUTH_TOKEN;
  assert.equal((await post('/api/v1/webhooks/voice', { Digits: '1' })).status, 200);
  process.env.NODE_ENV = 'production';
  assert.equal((await post('/api/v1/webhooks/voice', { Digits: '1' })).status, 403);
});

test('TWILIO_ENABLED=false skips the check locally even with credentials, and rejects on Render', async () => {
  process.env.TWILIO_ENABLED = 'false';
  assert.equal((await post('/api/v1/webhooks/voice', { Digits: '1' })).status, 200);
  process.env.RENDER = 'true'; // Render sets this on every service
  assert.equal((await post('/api/v1/webhooks/voice', { Digits: '1' })).status, 403);
});

// First real call (22 Nov): Twilio's request was rejected although the auth token was right
// (the same token had just placed the call). The signed URL can differ from PUBLIC_BASE_URL in
// the scheme (an http:// value redirected to https) or be Render's own address.
test('an http:// PUBLIC_BASE_URL accepts the https URL Twilio signed', async () => {
  process.env.PUBLIC_BASE_URL = BASE.replace('https:', 'http:');
  const path = '/api/v1/webhooks/voice/prompt?reminderId=abc';
  const r = await post(path, {}, { sign: BASE + path });
  assert.equal(r.status, 200);
});

test("Render's own address (RENDER_EXTERNAL_URL) is accepted; any other host is not", async () => {
  process.env.PUBLIC_BASE_URL = BASE;
  process.env.RENDER_EXTERNAL_URL = 'https://medtime-api.onrender.example';
  const path = '/api/v1/webhooks/voice/alert';
  assert.equal((await post(path, {}, { sign: 'https://medtime-api.onrender.example' + path })).status, 200);
  assert.equal((await post(path, {}, { sign: 'https://someone-else.example' + path })).status, 403);
  delete process.env.RENDER_EXTERNAL_URL;
});

// Third real call (22 Nov): Twilio's request had no signature header at all. The URLs we give
// Twilio carry a token made with a server-side key; it lets the request through, a wrong one doesn't.
test('no signature header: a valid URL token passes; a wrong or missing token is rejected', async () => {
  process.env.PUBLIC_BASE_URL = BASE;
  const { withToken } = require('./twilioSignature');
  const good = withToken('/api/v1/webhooks/voice/prompt?reminderId=r123', 'r123');
  assert.match(good, /&t=[0-9a-f]{32}$/);
  assert.equal((await post(good, {})).status, 200);
  const other = withToken('/api/v1/webhooks/voice/prompt?reminderId=r999', 'r999').replace('r999', 'r123');
  assert.equal((await post(other, {})).status, 403, 'a token for another dose');
  assert.equal((await post('/api/v1/webhooks/voice/prompt?reminderId=r123&t=00000000000000000000000000000000', {})).status, 403);
  assert.equal((await post('/api/v1/webhooks/voice/prompt?reminderId=r123', {})).status, 403, 'no token');
});
