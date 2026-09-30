const crypto = require('crypto');

/**
 * AES-256-GCM helpers. Key: 32-byte secret from hex (64 chars) or utf8 padded/hashed.
 */
function resolveKey(raw) {
  if (!raw) throw new Error('encryption key missing');
  const s = String(raw).trim();
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, 'hex');
  return crypto.createHash('sha256').update(s).digest();
}

function encryptAesGcm(plaintext, keyRaw) {
  const key = resolveKey(keyRaw);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(String(plaintext), 'utf8');
  const enc = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  // format: v1:iv:tag:ciphertext (base64 parts)
  return [
    'v1',
    iv.toString('base64'),
    tag.toString('base64'),
    enc.toString('base64')
  ].join(':');
}

function decryptAesGcm(payload, keyRaw) {
  const key = resolveKey(keyRaw);
  const parts = String(payload || '').split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('invalid ciphertext');
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const data = Buffer.from(parts[3], 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

function encryptBufferToFileParts(buf, keyRaw) {
  const key = resolveKey(keyRaw);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(buf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv, tag, ciphertext: enc };
}

function decryptFileParts({ iv, tag, ciphertext }, keyRaw) {
  const key = resolveKey(keyRaw);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

module.exports = {
  resolveKey,
  encryptAesGcm,
  decryptAesGcm,
  encryptBufferToFileParts,
  decryptFileParts
};
