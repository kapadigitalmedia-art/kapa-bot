const express = require('express');
const morgan = require('morgan');
const config = require('./config/config');
const { getAllTenants } = require('./config/tenants');
const logger = require('./utils/logger');
const { requireTenant } = require('./middleware/auth');
const { requireAdmin } = require('./middleware/adminAuth');

const webhookRoutes = require('./routes/webhook');
const leadsRoutes = require('./routes/leads');
const { router: attendanceRoutes } = require('./routes/attendance');
const errorsRoutes = require('./routes/errors');
const subscriptionsRoutes = require('./routes/subscriptions');
const productsRoutes = require('./routes/products');
const trialSignupRoutes = require('./routes/trialSignup');
const adminSignupsRoutes = require('./routes/adminSignups');
const hubRoutes = require('./routes/hub');

const app = express();

// CORS — no cors package for a few header lines. Restricted to kapa's
// known real origins (the marketing site + the admin dashboard) rather
// than '*': CORS is a browser-enforced policy only (curl/Postman/
// server-to-server calls were never affected), and doesn't weaken the
// x-api-key/requireTenant/requireAdmin auth already protecting the
// non-public routes — but least-privilege is still the safer default
// when it costs nothing.
// Found missing entirely (app-wide, not route-specific) while verifying
// the live trial-signup wiring: the OPTIONS preflight was returning a
// bare 200 with no Access-Control-* headers at all, which silently
// blocks the actual POST in every real browser — curl-based smoke
// testing never caught it, since curl doesn't enforce CORS.
// Access-Control-Allow-Origin can only ever echo back ONE origin per
// response, not a list — so with multiple allowed origins, the actual
// request's Origin header has to be checked against the allowlist and
// reflected back only on a match, rather than always sending one static
// value. x-admin-key is included in Allow-Headers alongside x-api-key:
// found needed via a real Puppeteer test against the admin dashboard's
// Trial Signups tab, whose preflight sends
// Access-Control-Request-Headers: x-admin-key — omitting it here would
// have left the origin-array fix still incomplete for that specific
// caller. Same class of gap found again for routes/hub.js: every
// authenticated Hub data endpoint sends Authorization: Bearer <token>,
// a non-safelisted header that also triggers a real preflight — caught
// via a real OPTIONS request from a browser-realistic Origin before it
// could silently block every dashboard fetch past login (login itself
// has no Authorization header, so it alone would have looked fine).
// TEMP - http://localhost:8080 added for local kapa-hub.html testing,
// remove before final deploy once testing is done.
const ALLOWED_ORIGINS = ['https://www.kapa.my', 'https://admin.kapa.my', 'http://localhost:8080'];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-api-key, x-admin-key, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());
app.use(morgan('tiny'));

// ── Health check ─────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'KAPA Bot (multi-tenant)',
    tenants: getAllTenants().map((t) => t.id),
    // Per-tenant, not a single global flag — a tenant with its own
    // accessTokenOverride can be sending for real even while the shared
    // default token is unset, so one boolean can't represent this
    // accurately across multiple tenants.
    mockMode: Object.fromEntries(getAllTenants().map((t) => [t.id, config.tenantMockMode(t)])),
    time: new Date().toISOString(),
  });
});

// ── WhatsApp webhook — shared across every tenant, no API key needed ────
app.use('/webhook', webhookRoutes);

// ── Internal API routes — tenant resolved from x-api-key ────────────────
app.use('/api/leads', requireTenant, leadsRoutes);
app.use('/api/attendance', requireTenant, attendanceRoutes);
app.use('/api/errors', requireTenant, errorsRoutes);
app.use('/api/subscriptions', requireTenant, subscriptionsRoutes);

// ── Product pricing — GET is public (website reads it), PUT is
//    admin-only (requireAdmin applied inside routes/products.js itself,
//    since this router mixes public and admin-protected routes) ────────
app.use('/api/products', productsRoutes);
app.use('/api/exchange-rates', productsRoutes.exchangeRatesRouter);

// ── Trial signup — public, no api-key/tenant yet (that's the whole
//    point: this is what CREATES a tenant) ──────────────────────────────
app.use('/api/trial-signup', trialSignupRoutes);
app.use('/api/hub', hubRoutes);

// ── Trial signup admin view — every route in this file is admin-only ───
app.use('/api/admin/trial-signups', requireAdmin, adminSignupsRoutes);

app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

app.listen(config.port, () => {
  logger.info(`KAPA Bot listening on port ${config.port}`);
  logger.info(`Registered tenants: ${getAllTenants().map((t) => t.id).join(', ') || '(none configured)'}`);
  getAllTenants().forEach((t) => {
    const mock = config.tenantMockMode(t);
    logger.info(`Tenant '${t.id}': Mock mode ${mock ? 'ON (no real sends)' : 'OFF (real sending enabled)'}`);
  });
});
