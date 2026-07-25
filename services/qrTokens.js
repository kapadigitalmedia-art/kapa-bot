// In-memory token -> QR-payload store backing GET /qr/:token.png
// (routes/qr.js). Tokens are short-lived and carry no information
// themselves — the URL sent to WhatsApp is just an opaque random id, so
// a forwarded/leaked message doesn't expose the encoded text (today a
// demo string, eventually a real HitPay payment link) once the token
// expires.
//
// In-memory, not a DB table or Redis: this is demo-scale, single
// short-lived lookup per QR, single Node process. A deploy that scales
// to multiple instances would need this moved to a shared store, since
// a token minted on one instance wouldn't be visible to another.

const crypto = require('crypto');

const TOKEN_TTL_MS = 10 * 60 * 1000; // long enough for WhatsApp to fetch the image after send, short enough that a leaked URL goes dead quickly
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

const store = new Map();

function createQrToken(text) {
  const token = crypto.randomBytes(16).toString('hex');
  store.set(token, { text, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

function getQrToken(token) {
  const entry = store.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(token);
    return null;
  }
  return entry.text;
}

// Periodic sweep so tokens that are minted but never fetched (e.g. the
// WhatsApp send itself failed) don't sit in memory indefinitely.
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of store) {
    if (now > entry.expiresAt) store.delete(token);
  }
}, SWEEP_INTERVAL_MS).unref();

module.exports = { createQrToken, getQrToken };
