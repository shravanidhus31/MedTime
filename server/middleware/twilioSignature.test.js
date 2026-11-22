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
const ENV = ['TWILIO_AUTH_TOKEN', 'PUBLIC_BASE_URL', 'NGROK_URL', 'NODE_ENV'];

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
  process.env.TWILIO_AUTH_TOKEN = TOKEN;
  process.env.PUBLIC_BASE_URL = BASE;
  delete process.env.NGROK_URL;
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
