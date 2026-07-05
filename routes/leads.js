const express = require('express');
const router = express.Router();
const db = require('../services/db');
const whatsapp = require('../services/whatsapp');
const logger = require('../utils/logger');

/**
 * POST /api/leads
 * Called by submit.php whenever someone signs up on the KAPA ONE pricing page.
 * Body: { to, message }  — kept compatible with the old /notify-lead shape,
 * but also accepts the raw lead fields directly if you prefer to send those
 * instead of a pre-built message (see the alternate block below).
 */
router.post('/', async (req, res) => {
  const { to, message, full_name, company_name, email, phone, plan, plan_price } = req.body;

  const waMessage =
    message ||
    `🚀 New KAPA ONE Lead!\n\n` +
      `Plan: ${plan || 'N/A'} (${plan_price || ''})\n` +
      `Name: ${full_name || 'N/A'}\n` +
      `Company: ${company_name || 'N/A'}\n` +
      `Email: ${email || 'N/A'}\n` +
      `Phone: ${phone || 'N/A'}\n\n` +
      `Reply within 2 business hours!`;

  const destination = to || require('../config/config').officeNumber;

  const result = await whatsapp.sendText(destination, waMessage);

  db.get('leads')
    .push({
      full_name: full_name || null,
      company_name: company_name || null,
      email: email || null,
      phone: phone || null,
      plan: plan || null,
      plan_price: plan_price || null,
      submittedAt: new Date().toISOString(),
      whatsappSent: result.ok,
    })
    .write();

  logger.info(`Lead recorded: ${company_name || 'Unknown company'} (${plan || 'no plan'})`);

  if (!result.ok) {
    return res.status(502).json({ ok: false, error: result.error || 'Failed to send WhatsApp notification' });
  }
  res.json({ ok: true, mock: result.mock || false });
});

/**
 * GET /api/leads
 * View recently captured leads (for quick internal checking / debugging).
 */
router.get('/', (req, res) => {
  const leads = db.get('leads').takeRight(50).reverse().value();
  res.json({ ok: true, count: leads.length, leads });
});

module.exports = router;
