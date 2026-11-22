// Offline tests for A1.2: PUBLIC_BASE_URL as the only callback setting, the
// startup check, and the TWILIO_ENABLED switch. No database, no network.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ENV = ['PUBLIC_BASE_URL', 'NGROK_URL', 'NODE_ENV', 'RENDER', 'RENDER_EXTERNAL_URL',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_ENABLED'];
const saved = {};
const FAKE_SID = 'AC' + '0'.repeat(32);

test.before(() => { for (const k of ENV) saved[k] = process.env[k]; });
test.after(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
test.beforeEach(() => {
  for (const k of ENV) delete process.env[k];
  process.env.NODE_ENV = 'test';
});

const { publicBaseUrl, checkPublicBaseUrl } = require('./publicUrl');
const { twilioEnabled, isProduction } = require('./runtime');

test('PUBLIC_BASE_URL is the only source; trailing slashes go; NGROK_URL is ignored', () => {
  process.env.NGROK_URL = 'https://old-tunnel.ngrok-free.dev';
  assert.equal(publicBaseUrl(), '');
  process.env.PUBLIC_BASE_URL = ' https://medtime.onrender.com// ';
  assert.equal(publicBaseUrl(), 'https://medtime.onrender.com');
});

test('production without PUBLIC_BASE_URL fails, with hints from Render and the old NGROK_URL', () => {
  process.env.NODE_ENV = 'production';
  process.env.RENDER_EXTERNAL_URL = 'https://medtime.onrender.com';
  process.env.NGROK_URL = 'https://old-tunnel.ngrok-free.dev';
  const r = checkPublicBaseUrl();
  assert.equal(r.ok, false);
  assert.match(r.error, /PUBLIC_BASE_URL is not set/);
  assert.match(r.error, /https:\/\/medtime\.onrender\.com/);
  assert.match(r.error, /rename it to PUBLIC_BASE_URL/);
});

test('RENDER=true counts as production even without NODE_ENV', () => {
  delete process.env.NODE_ENV;
  process.env.RENDER = 'true';
  assert.equal(isProduction(), true);
  assert.equal(checkPublicBaseUrl().ok, false);
});

test('production with a valid URL passes; a non-URL fails; http only warns', () => {
  process.env.NODE_ENV = 'production';
  process.env.PUBLIC_BASE_URL = 'https://medtime.onrender.com';
  assert.deepEqual(checkPublicBaseUrl(), { ok: true });
  process.env.PUBLIC_BASE_URL = 'medtime.onrender.com';
  assert.equal(checkPublicBaseUrl().ok, false);
  process.env.PUBLIC_BASE_URL = 'http://medtime.onrender.com';
  const r = checkPublicBaseUrl();
  assert.equal(r.ok, true);
  assert.match(r.warning, /not https/);
});

test('locally a missing URL is fine with Twilio off, and only a warning with Twilio on', () => {
  assert.deepEqual(checkPublicBaseUrl(), { ok: true });
  process.env.TWILIO_ACCOUNT_SID = FAKE_SID;
  process.env.TWILIO_AUTH_TOKEN = 'x';
  const r = checkPublicBaseUrl();
  assert.equal(r.ok, true);
  assert.match(r.warning, /real Twilio calls will fail/);
});

test('TWILIO_ENABLED=false turns Twilio off even with credentials; unset means on', () => {
  process.env.TWILIO_ACCOUNT_SID = FAKE_SID;
  process.env.TWILIO_AUTH_TOKEN = 'x';
  assert.equal(twilioEnabled(), true);
  for (const off of ['false', 'FALSE', '0', 'no', 'off']) {
    process.env.TWILIO_ENABLED = off;
    assert.equal(twilioEnabled(), false, off);
  }
  process.env.TWILIO_ENABLED = 'true';
  assert.equal(twilioEnabled(), true);
  delete process.env.TWILIO_AUTH_TOKEN;
  assert.equal(twilioEnabled(), false);
});

test('Twilio off: calls and SMS are only logged, nothing is sent', async () => {
  process.env.TWILIO_ACCOUNT_SID = FAKE_SID;
  process.env.TWILIO_AUTH_TOKEN = 'x';
  process.env.TWILIO_ENABLED = 'false';
  const tc = require('./twilioClient');
  assert.equal(await tc.makePatientCall('9999999999', 'Amlodipine', 'abc'), true);
  assert.equal(await tc.makeAlertCall('9999999999', 'alert1'), true);
  assert.equal(await tc.sendSMS('9999999999', 'hi'), true);
});

test('Twilio on without PUBLIC_BASE_URL: a call fails with a clear error instead of using a dead tunnel', async () => {
  process.env.TWILIO_ACCOUNT_SID = FAKE_SID;
  process.env.TWILIO_AUTH_TOKEN = 'x';
  process.env.NGROK_URL = 'https://old-tunnel.ngrok-free.dev';
  const tc = require('./twilioClient');
  await assert.rejects(tc.makePatientCall('9999999999', 'Amlodipine', 'abc'), /PUBLIC_BASE_URL is not set/);
  await assert.rejects(tc.makeAlertCall('9999999999', 'alert1'), /PUBLIC_BASE_URL is not set/);
  process.env.PUBLIC_BASE_URL = 'https://medtime.onrender.com/';
  assert.equal(tc.callbackUrl('/api/v1/webhooks/voice/prompt?medicineId=abc'),
    'https://medtime.onrender.com/api/v1/webhooks/voice/prompt?medicineId=abc');
});

test('the server refuses to start in production without PUBLIC_BASE_URL', () => {
  const env = { ...process.env, NODE_ENV: 'production', PUBLIC_BASE_URL: '', RENDER_EXTERNAL_URL: 'https://medtime.onrender.com' };
  const r = spawnSync(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..'), env, encoding: 'utf8', timeout: 20000,
  });
  assert.equal(r.status, 1, `expected exit code 1, got ${r.status} (signal ${r.signal})\n${r.stderr}`);
  assert.match(r.stderr, /PUBLIC_BASE_URL is not set/);
  assert.match(r.stderr, /https:\/\/medtime\.onrender\.com/);
  assert.doesNotMatch(r.stdout, /connected to MongoDB/);
});
