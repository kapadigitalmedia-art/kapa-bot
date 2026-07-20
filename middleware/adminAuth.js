const crypto = require('crypto');

/**
 * Admin-only routes (e.g. writing product pricing) aren't tied to any
 * tenant — this is you managing the platform, not a customer sending
 * data — so this is deliberately separate from requireTenant/x-api-key.
 * Checks a single shared ADMIN_API_KEY via its own header, x-admin-key.
 */
function requireAdmin(req, res, next) {
  const providedKey = req.headers['x-admin-key'];
  const realKey = process.env.ADMIN_API_KEY;

  if (!realKey) {
    return res.status(500).json({ ok: false, error: 'ADMIN_API_KEY not configured on server' });
  }

  if (!providedKey) {
    return res.status(401).json({ ok: false, error: 'Missing x-admin-key header' });
  }

  const provided = Buffer.from(providedKey);
  const real = Buffer.from(realKey);

  // timingSafeEqual throws if buffer lengths differ, so check that first —
  // still constant-time for the actual key comparison, avoids leaking key
  // length/content through response-time differences.
  if (provided.length !== real.length || !crypto.timingSafeEqual(provided, real)) {
    return res.status(401).json({ ok: false, error: 'Invalid x-admin-key' });
  }

  next();
}

module.exports = { requireAdmin };
