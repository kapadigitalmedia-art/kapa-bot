const express = require('express');
const morgan = require('morgan');
const config = require('./config/config');
const { getAllTenants } = require('./config/tenants');
const logger = require('./utils/logger');
const { requireTenant } = require('./middleware/auth');

const webhookRoutes = require('./routes/webhook');
const leadsRoutes = require('./routes/leads');
const { router: attendanceRoutes } = require('./routes/attendance');
const errorsRoutes = require('./routes/errors');
const subscriptionsRoutes = require('./routes/subscriptions');
const productsRoutes = require('./routes/products');

const app = express();

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
