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

const app = express();

app.use(express.json());
app.use(morgan('tiny'));

// ── Health check ─────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'KAPA Bot (multi-tenant)',
    tenants: getAllTenants().map((t) => t.id),
    mockMode: config.mockMode,
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

app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

app.listen(config.port, () => {
  logger.info(`KAPA Bot listening on port ${config.port}`);
  logger.info(`Registered tenants: ${getAllTenants().map((t) => t.id).join(', ') || '(none configured)'}`);
  logger.info(`Mock mode (no default META_ACCESS_TOKEN): ${config.mockMode ? 'ON' : 'OFF'}`);
});
