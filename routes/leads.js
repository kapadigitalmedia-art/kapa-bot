const express = require('express');
const router = express.Router();
const { tenantDb } = require('../services/db');
const { tenantDb: tenantDbMysql } = require('../services/db-mysql');
const whatsapp = require('../services/whatsapp');
const logger = require('../utils/logger');

/**
 * POST /api/leads
 * Called by a tenant's own system (e.g. submit.php on one.kapa.my) whenever
 * someone signs up. req.tenant is resolved by the requireTenant middleware
 * from the x-api-key header — each customer gets their own key, so this
 * one shared route safely serves every tenant on the platform.
 *
 * Writes to MySQL (bot_leads). If that write fails for any reason, falls
 * back to the old lowdb store so the lead isn't lost — same safety-net
 * pattern as routes/errors.js, not a long-term dual-write strategy.
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

  const record = {
    full_name: full_name || null,
    company_name: company_name || null,
    email: email || null,
    phone: phone || null,
    plan: plan || null,
    plan_price: plan_price || null,
    submittedAt: new Date().toISOString(),
    whatsappSent: result.ok,
  };

  try {
    await tenantDbMysql(tenant.id).get('leads').push(record).write();
  } catch (err) {
    logger.warn(`[${tenant.id}] MySQL write failed for leads, falling back to lowdb: ${err.message}`);
    tenantDb(tenant.id).get('leads').push(record).write();
  }

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
router.get('/', async (req, res) => {
  try {
    const leads = await tenantDbMysql(req.tenant.id).get('leads').takeRight(50).reverse().value();
    res.json({ ok: true, count: leads.length, leads });
  } catch (err) {
    logger.warn(`[${req.tenant.id}] MySQL read failed for leads: ${err.message}`);
    res.status(500).json({ ok: false, error: 'Failed to read leads' });
  }
});

module.exports = router;
