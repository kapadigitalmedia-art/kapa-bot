const express = require('express');
const router = express.Router();
const { tenantDb } = require('../services/db');
const whatsapp = require('../services/whatsapp');
const logger = require('../utils/logger');

/**
 * POST /api/leads
 * Called by a tenant's own system (e.g. submit.php on one.kapa.my) whenever
 * someone signs up. req.tenant is resolved by the requireTenant middleware
 * from the x-api-key header — each customer gets their own key, so this
 * one shared route safely serves every tenant on the platform.
 */
router.post('/', async (req, res) => {
  const tenant = req.tenant;
  const { message, full_name, company_name, email, phone, plan, plan_price } = req.body;

  const waMessage =
    message ||
    `🚀 New Lead!\n\n` +
      `Plan: ${plan || 'N/A'} (${plan_price || ''})\n` +
      `Name: ${full_name || 'N/A'}\n` +
      `Company: ${company_name || 'N/A'}\n` +
      `Email: ${email || 'N/A'}\n` +
      `Phone: ${phone || 'N/A'}\n\n` +
      `Reply within 2 business hours!`;

  const result = await whatsapp.sendToOffice(tenant, waMessage);

  tenantDb(tenant.id)
    .get('leads')
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

  logger.info(`[${tenant.id}] Lead recorded: ${company_name || 'Unknown company'} (${plan || 'no plan'})`);

  if (!result.ok) {
    return res.status(502).json({ ok: false, error: result.error || 'Failed to send WhatsApp notification' });
  }
  res.json({ ok: true, mock: result.mock || false });
});

/**
 * GET /api/leads
 * View this tenant's own recently captured leads.
 */
router.get('/', (req, res) => {
  const leads = tenantDb(req.tenant.id).get('leads').takeRight(50).reverse().value();
  res.json({ ok: true, count: leads.length, leads });
});

module.exports = router;
