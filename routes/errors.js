const express = require('express');
const router = express.Router();
const { tenantDb } = require('../services/db');
const whatsapp = require('../services/whatsapp');
const logger = require('../utils/logger');

/**
 * POST /api/errors/report
 * Body: { source, message, severity }
 * severity: "low" | "medium" | "high" | "critical" (default: "medium")
 */
router.post('/report', async (req, res) => {
  const tenant = req.tenant;
  const { source, message, severity } = req.body;

  if (!source || !message) {
    return res.status(400).json({ ok: false, error: 'source and message are required' });
  }

  const level = (severity || 'medium').toLowerCase();
  const icon = { low: '🟡', medium: '🟠', high: '🔴', critical: '🚨' }[level] || '🟠';

  const alertText =
    `${icon} *${tenant.name} — System Alert (${level.toUpperCase()})*\n\n` +
    `Source: ${source}\n` +
    `Message: ${message}\n` +
    `Time: ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}`;

  tenantDb(tenant.id)
    .get('errors')
    .push({ source, message, severity: level, timestamp: new Date().toISOString() })
    .write();

  const results =
    level === 'critical' || level === 'high'
      ? await whatsapp.sendToAllAdmins(tenant, alertText)
      : [await whatsapp.sendToOffice(tenant, alertText)];

  logger.warn(`[${tenant.id}] ERROR ALERT [${level}] from ${source}: ${message}`);

  res.json({ ok: true, notified: results.filter((r) => r.ok).length, total: results.length });
});

/**
 * GET /api/errors
 */
router.get('/', (req, res) => {
  const errors = tenantDb(req.tenant.id).get('errors').takeRight(50).reverse().value();
  res.json({ ok: true, count: errors.length, errors });
});

module.exports = router;
