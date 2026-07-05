const express = require('express');
const router = express.Router();
const db = require('../services/db');
const whatsapp = require('../services/whatsapp');
const logger = require('../utils/logger');

/**
 * POST /api/errors/report
 * Called by KAPA ONE / KAPA HUB backend whenever a server error, failed
 * job, or downtime event happens. Sends an immediate WhatsApp alert to
 * the office number and every admin number.
 *
 * Body: { source, message, severity }
 *   source   e.g. "KAPA ONE API", "KAPA HUB Cron Job", "Payment Webhook"
 *   message  human-readable description of what went wrong
 *   severity "low" | "medium" | "high" | "critical" (default: "medium")
 */
router.post('/report', async (req, res) => {
  const { source, message, severity } = req.body;

  if (!source || !message) {
    return res.status(400).json({ ok: false, error: 'source and message are required' });
  }

  const level = (severity || 'medium').toLowerCase();
  const icon = { low: '🟡', medium: '🟠', high: '🔴', critical: '🚨' }[level] || '🟠';

  const alertText =
    `${icon} *KAPA System Alert (${level.toUpperCase()})*\n\n` +
    `Source: ${source}\n` +
    `Message: ${message}\n` +
    `Time: ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}`;

  db.get('errors')
    .push({ source, message, severity: level, timestamp: new Date().toISOString() })
    .write();

  const results =
    level === 'critical' || level === 'high'
      ? await whatsapp.sendToAllAdmins(alertText)
      : [await whatsapp.sendToOffice(alertText)];

  logger.warn(`ERROR ALERT [${level}] from ${source}: ${message}`);

  res.json({ ok: true, notified: results.filter((r) => r.ok).length, total: results.length });
});

/**
 * GET /api/errors
 * Recent error log — useful for the Admin Dashboard "system status" command.
 */
router.get('/', (req, res) => {
  const errors = db.get('errors').takeRight(50).reverse().value();
  res.json({ ok: true, count: errors.length, errors });
});

module.exports = router;
