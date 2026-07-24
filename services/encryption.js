// AES-256-GCM encryption for real financial/credential secrets at rest
// (e.g. bot_tenant_payment_gateways.api_key_encrypted) — reversible,
// unlike bcrypt, since callers need the raw plaintext back to actually
// call the gateway's API, not just verify a match.
//
// GATEWAY_CREDENTIALS_KEY is a 32-byte key, hex-encoded, generated once
// via `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
// and stored only in .env (never in the DB, never in git) — same trust
// boundary as every other secret this app already relies on.
//
// Stored format is `iv:authTag:ciphertext` (all hex, colon-joined) — a
// fresh random IV per encrypt() call (GCM requires a unique IV per
// encryption under the same key; reuse breaks its confidentiality
// guarantees), plus the auth tag GCM produces, which is what lets
// decrypt() detect tampering instead of silently returning garbage.

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getKey() {
  const keyHex = process.env.GATEWAY_CREDENTIALS_KEY;
  if (!keyHex) {
    throw new Error('GATEWAY_CREDENTIALS_KEY is not set');
  }
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('GATEWAY_CREDENTIALS_KEY must be a 32-byte hex string');
  }
  return key;
}

function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

function decrypt(stored) {
  const key = getKey();
  const [ivHex, authTagHex, ciphertextHex] = stored.split(':');
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error('Malformed ciphertext: expected iv:authTag:ciphertext');
  }
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

module.exports = { encrypt, decrypt };
