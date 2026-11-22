// The same mobile number however it is typed (22 Nov: a caregiver could not log in after a
// registration typed differently).
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePhone, phoneVariants } = require('./phone');

test('one number, any format', () => {
  for (const t of ['9326450209', '+91 93264 50209', '919326450209', '09326450209', '93264-50209']) assert.equal(normalizePhone(t), '9326450209', t);
  assert.deepEqual(phoneVariants('+91 93264 50209').filter((v) => /^\+?\d+$/.test(v)).sort(), ['+919326450209', '919326450209', '9326450209'].sort());
});
