import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function encryptionKey(value = process.env.MFA_ENCRYPTION_KEY) {
  if (!value) throw new Error('MFA encryption is not configured.');
  const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('MFA_ENCRYPTION_KEY must encode exactly 32 bytes.');
  return key;
}
export function encryptTotpSecret(secret, key = encryptionKey()) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}
export function decryptTotpSecret(value, key = encryptionKey()) {
  const [iv, tag, ciphertext] = String(value || '').split('.').map((part) => Buffer.from(part, 'base64url'));
  if (!iv || iv.length !== 12 || !tag || tag.length !== 16 || !ciphertext) throw new Error('Stored MFA factor is invalid.');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
export function encodeBase32(input) {
  const bytes = Buffer.from(input);
  let bits = 0, value = 0, output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { output += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}
export function decodeBase32(encoded) {
  const clean = String(encoded || '').toUpperCase().replace(/=+$/g, '').replace(/\s/g, '');
  let bits = 0, value = 0; const bytes = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Invalid TOTP secret.');
    value = (value << 5) | index; bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}
export function generateTotpSecret() { return encodeBase32(randomBytes(20)); }
export function totpAt(secret, step = Math.floor(Date.now() / 30000)) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 1000000).padStart(6, '0');
}
export function matchingTotpStep(secret, code, nowMs = Date.now(), lastStep = -1) {
  if (!/^\d{6}$/.test(String(code || ''))) return null;
  const current = Math.floor(nowMs / 30000);
  for (const step of [current, current - 1, current + 1]) {
    if (step <= lastStep) continue;
    const expected = Buffer.from(totpAt(secret, step));
    const actual = Buffer.from(String(code));
    if (expected.length === actual.length && timingSafeEqual(expected, actual)) return step;
  }
  return null;
}
export function hashRecoveryCode(code) { return createHash('sha256').update(String(code || '').trim().toUpperCase()).digest('hex'); }
export function generateRecoveryCodes(count = 10) { return Array.from({ length: count }, () => randomBytes(8).toString('hex').toUpperCase()); }
export function enrollmentUri(secret, email, issuer = 'Cleared') {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const query = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${query}`;
}
