const config = require('../config/config');

/**
 * Protects internal API routes (called by submit.php, KAPA ONE backend,
 * KAPA HUB, etc.) with a shared secret sent in the `x-api-key` header.
 * This stops random members of the public from POSTing fake leads/errors.
 */
function requireApiKey(req, res, next) {
  const provided = req.headers['x-api-key'];

  if (!config.internalApiKey) {
    // No key configured yet — allow through but warn loudly, so this is
    // impossible to miss during setup, but doesn't block local testing.
    console.warn('⚠️  INTERNAL_API_KEY is not set — internal routes are UNPROTECTED. Set it in .env before going live.');
    return next();
  }

  if (provided && provided === config.internalApiKey) {
    return next();
  }

  return res.status(401).json({ ok: false, error: 'Invalid or missing x-api-key header' });
}

module.exports = { requireApiKey };
