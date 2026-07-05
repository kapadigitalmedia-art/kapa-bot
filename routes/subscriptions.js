const express = require('express');
const router = express.Router();
const { tenantDb } = require('../services/db');
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

  tenantDb(tenant.id)
    .get('subscriptions')
    .push({ company, event, plan: plan || null, amount: amount || null, timestamp: new Date().toISOString() })
    .write();

  const result = await whatsapp.sendToOffice(tenant, text);
  logger.info(`[${tenant.id}] Subscription alert: ${company} -> ${event}`);

  res.json({ ok: true, sent: result.ok, mock: result.mock || false });
});

/**
 * GET /api/subscriptions
 */
router.get('/', (req, res) => {
  const events = tenantDb(req.tenant.id).get('subscriptions').takeRight(50).reverse().value();
  res.json({ ok: true, count: events.length, events });
});

module.exports = router;
