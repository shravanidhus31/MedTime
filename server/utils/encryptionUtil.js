/**
 * encryptionUtil.js
 *
 * Provides AES-256-GCM symmetric encryption for sensitive PII fields
 * (e.g. doctor email addresses) stored in MongoDB.
 *
 * Format stored in DB: "<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 *
 * Key source: ENCRYPTION_KEY env var — must be a 64-char hex string
 * (representing 32 raw bytes).  Generate once with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'ENCRYPTION_KEY must be set in .env as a 64-character hex string (32 bytes).'
    );
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypts a plaintext string.
 * @param {string} plaintext
 * @returns {string} "<iv>:<authTag>:<ciphertext>" — all hex encoded
 */
function encrypt(plaintext) {
  if (!plaintext) return '';

  const key = getKey();
  const iv  = crypto.randomBytes(12); // 96-bit IV — recommended for GCM

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag   = cipher.getAuthTag(); // 128-bit authentication tag

  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':');
}

/**
 * Decrypts a ciphertext produced by encrypt().
 * Returns '' if the input is empty or not in the expected format.
 * @param {string} ciphertext
 * @returns {string} plaintext
 */
function decrypt(ciphertext) {
  if (!ciphertext) return '';

  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    // Value was stored before encryption was introduced — return as-is
    return ciphertext;
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const key     = getKey();
  const iv      = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const data    = Buffer.from(encryptedHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
