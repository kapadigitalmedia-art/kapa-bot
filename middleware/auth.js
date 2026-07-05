const { getTenantByApiKey } = require('../config/tenants');

/**
 * Every customer (tenant) gets their own unique x-api-key. This middleware
 * looks up which tenant that key belongs to and attaches it as req.tenant
 * so every downstream route automatically knows whose data it's touching —
 * no tenant ID needs to appear in the URL, and one customer's key can
 * never be used to read/write another customer's data.
 */
function requireTenant(req, res, next) {
  const providedKey = req.headers['x-api-key'];

  if (!providedKey) {
    return res.status(401).json({ ok: false, error: 'Missing x-api-key header' });
  }

  const tenant = getTenantByApiKey(providedKey);

  if (!tenant) {
    return res.status(401).json({ ok: false, error: 'Invalid x-api-key' });
  }

  req.tenant = tenant;
  next();
}

module.exports = { requireTenant };
