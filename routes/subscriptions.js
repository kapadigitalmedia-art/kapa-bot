const express = require('express');
const router = express.Router();
const { tenantDb } = require('../services/db');
const { tenantDb: tenantDbMysql } = require('../services/db-mysql');
const whatsapp = require('../services/whatsapp');
const logger = require('../utils/logger');

const EVENT_LABELS = {
  payment_received: { icon: '✅', label: 'Payment Received' },
  payment_due: { icon: '⏰', label: 'Payment Due' },
  payment_failed: { icon: '❌', label: 'Payment Failed' },
  trial_expiring: { icon: '⌛', label: 'Trial Expiring Soon' },
  upgraded: { icon: '⬆️', label: 'Plan Upgraded' },
  downgraded: { icon: '⬇️', label: 'Plan Downgraded' },
  cancelled: { icon: '🛑', label: 'Subscription Cancelled' },
};

/**
 * POST /api/subscriptions/alert
 * Body: { company, event, plan, amount }
 *
 * Writes to MySQL (bot_subscription_events — the "subscriptions" lowdb
 * collection name is kept here as the tenantDb() key for API-shape
 * consistency with services/db-mysql.js's COLLECTIONS map, even though the
 * underlying table is renamed to avoid confusion with bot_companies'
 * billing state). Falls back to lowdb on write failure, same safety-net
 * pattern as the other three migrated routes.
 */
router.post('/alert', async (req, res) => {
  const tenant = req.tenant;
  const { company, event, plan, amount } = req.body;

  if (!company || !event) {
    return res.status(400).json({ ok: false, error: 'company and event are required' });
  }

  const meta = EVENT_LABELS[event] || { icon: '🔔', label: event };

  const text =
    `${meta.icon} *${meta.label}*\n\n` +
    `Company: ${company}\n` +
    (plan ? `Plan: ${plan}\n` : '') +
    (amount ? `Amount: RM ${amount}\n` : '') +
    `Time: ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}`;

  const record = { company, event, plan: plan || null, amount: amount || null, timestamp: new Date().toISOString() };

  try {
    await tenantDbMysql(tenant.id).get('subscriptions').push(record).write();
  } catch (err) {
    logger.warn(`[${tenant.id}] MySQL write failed for subscriptions, falling back to lowdb: ${err.message}`);
    tenantDb(tenant.id).get('subscriptions').push(record).write();
  }

  const result = await whatsapp.sendToOffice(tenant, text);
  logger.info(`[${tenant.id}] Subscription alert: ${company} -> ${event}`);

  res.json({ ok: true, sent: result.ok, mock: result.mock || false });
});

/**
 * GET /api/subscriptions
 */
router.get('/', async (req, res) => {
  try {
    const events = await tenantDbMysql(req.tenant.id).get('subscriptions').takeRight(50).reverse().value();
    res.json({ ok: true, count: events.length, events });
  } catch (err) {
    logger.warn(`[${req.tenant.id}] MySQL read failed for subscriptions: ${err.message}`);
    res.status(500).json({ ok: false, error: 'Failed to read subscription events' });
  }
});

module.exports = router;
