const express = require('express');
const morgan = require('morgan');
const config = require('./config/config');
const logger = require('./utils/logger');
const { requireApiKey } = require('./middleware/auth');

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
    service: 'KAPA Bot',
    mockMode: config.mockMode,
    time: new Date().toISOString(),
  });
});

// ── WhatsApp webhook (Meta calls these — no API key needed here) ────────
app.use('/webhook', webhookRoutes);

// ── Internal API routes (protected by x-api-key) ─────────────────────────
app.use('/api/leads', requireApiKey, leadsRoutes);
app.use('/api/attendance', requireApiKey, attendanceRoutes);
app.use('/api/errors', requireApiKey, errorsRoutes);
app.use('/api/subscriptions', requireApiKey, subscriptionsRoutes);

// ── 404 fallback ───────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

app.listen(config.port, () => {
  logger.info(`KAPA Bot listening on port ${config.port}`);
  logger.info(`Mock mode: ${config.mockMode ? 'ON (no real WhatsApp messages will be sent)' : 'OFF (live)'}`);
  if (config.mockMode) {
    logger.warn('Set META_ACCESS_TOKEN and META_PHONE_NUMBER_ID in .env to send real WhatsApp messages.');
  }
});
