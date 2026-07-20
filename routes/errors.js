const express = require('express');
const router = express.Router();
const { tenantDb } = require('../services/db');
const { tenantDb: tenantDbMysql } = require('../services/db-mysql');
const whatsapp = require('../services/whatsapp');
const logger = require('../utils/logger');

/**
 * POST /api/errors/report
 * Body: { source, message, severity }
 * severity: "low" | "medium" | "high" | "critical" (default: "medium")
 *
 * Writes to MySQL (bot_errors). If that write fails for any reason, falls
 * back to the old lowdb store so the error report isn't lost — this
 * fallback is a safety net for this first migrated route only, not a
 * long-term dual-write strategy.
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

  const record = { source, message, severity: level, timestamp: new Date().toISOString() };

  try {
    await tenantDbMysql(tenant.id).get('errors').push(record).write();
  } catch (err) {
    logger.warn(`[${tenant.id}] MySQL write failed for errors, falling back to lowdb: ${err.message}`);
    tenantDb(tenant.id).get('errors').push(record).write();
  }

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
router.get('/', async (req, res) => {
  try {
    const errors = await tenantDbMysql(req.tenant.id).get('errors').takeRight(50).reverse().value();
    res.json({ ok: true, count: errors.length, errors });
  } catch (err) {
    logger.warn(`[${req.tenant.id}] MySQL read failed for errors: ${err.message}`);
    res.status(500).json({ ok: false, error: 'Failed to read errors' });
  }
});

module.exports = router;
