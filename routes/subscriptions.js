const express = require('express');
const router = express.Router();
const db = require('../services/db');
const whatsapp = require('../services/whatsapp');
const logger = require('../utils/logger');

/**
 * POST /api/subscriptions/alert
 * Called whenever a subscription-related event happens for a KAPA ONE
 * customer: payment received, payment failed/due, trial expiring, plan
 * upgraded/downgraded, cancellation, etc.
 *
 * Body: { company, event, plan, amount }
 *   event one of: "payment_received" | "payment_due" | "payment_failed" |
 *                 "trial_expiring" | "upgraded" | "downgraded" | "cancelled"
 */
const EVENT_LABELS = {
  payment_received: { icon: '✅', label: 'Payment Received' },
  payment_due: { icon: '⏰', label: 'Payment Due' },
  payment_failed: { icon: '❌', label: 'Payment Failed' },
  trial_expiring: { icon: '⌛', label: 'Trial Expiring Soon' },
  upgraded: { icon: '⬆️', label: 'Plan Upgraded' },
  downgraded: { icon: '⬇️', label: 'Plan Downgraded' },
  cancelled: { icon: '🛑', label: 'Subscription Cancelled' },
};

router.post('/alert', async (req, res) => {
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

  db.get('subscriptions')
    .push({ company, event, plan: plan || null, amount: amount || null, timestamp: new Date().toISOString() })
    .write();

  const result = await whatsapp.sendToOffice(text);
  logger.info(`Subscription alert: ${company} -> ${event}`);

  res.json({ ok: true, sent: result.ok, mock: result.mock || false });
});

/**
 * GET /api/subscriptions
 * Recent subscription events log.
 */
router.get('/', (req, res) => {
  const events = db.get('subscriptions').takeRight(50).reverse().value();
  res.json({ ok: true, count: events.length, events });
});

module.exports = router;
