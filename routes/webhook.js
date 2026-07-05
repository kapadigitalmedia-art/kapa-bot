const express = require('express');
const router = express.Router();
const config = require('../config/config');
const { getTenantByPhoneNumberId } = require('../config/tenants');
const whatsapp = require('../services/whatsapp');
const { tenantDb } = require('../services/db');
const logger = require('../utils/logger');
const { recordAttendance } = require('./attendance');
const { handleAdminCommand } = require('../services/adminCommands');

/**
 * GET /webhook
 * One shared verify token works across every tenant's phone number, since
 * they can all live under the same Meta App (or you can add per-App
 * verify token support later if a tenant needs their own App).
 */
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.meta.verifyToken) {
    logger.info('Webhook verified successfully by Meta.');
    return res.status(200).send(challenge);
  }
  logger.warn('Webhook verification FAILED — token mismatch.');
  return res.sendStatus(403);
});

/**
 * POST /webhook
 * Every tenant's incoming messages arrive here. The tenant is resolved
 * from `value.metadata.phone_number_id` — the WhatsApp number the message
 * was sent TO — so one shared endpoint safely serves every customer.
 */
router.post('/', async (req, res) => {
  res.sendStatus(200); // ack immediately, Meta retries on slow/failed acks

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) return; // status update / non-message event — ignore

    const incomingPhoneNumberId = value?.metadata?.phone_number_id;
    const tenant = getTenantByPhoneNumberId(incomingPhoneNumberId);

    if (!tenant) {
      logger.warn(`Incoming message for UNKNOWN phone_number_id=${incomingPhoneNumberId} — no matching tenant in config/tenants.js. Ignoring.`);
      return;
    }

    const from = message.from;
    const contactName = value?.contacts?.[0]?.profile?.name || null;
    const isAdmin = (tenant.adminNumbers || []).includes(from);

    logger.info(`[${tenant.id}] Incoming WhatsApp from ${from} (${contactName || 'unknown'}): type=${message.type}`);

    // ── 1. Location messages — completes a check-in/out ──────────────────
    if (message.type === 'location') {
      const state = tenantDb(tenant.id).get('conversationState').get(from).value();
      if (state && state.step === 'awaiting_location') {
        const record = recordAttendance(tenant.id, {
          phone: from,
          name: contactName,
          type: state.data.type,
          lat: message.location.latitude,
          lng: message.location.longitude,
        });
        tenantDb(tenant.id).get('conversationState').unset(from).write();
        await whatsapp.sendText(
          tenant,
          from,
          `✅ *Check-${record.type === 'in' ? 'In' : 'Out'} Recorded*\n\nTime: ${new Date(record.timestamp).toLocaleTimeString()}\nLocation received. Thank you!`
        );
      } else {
        await whatsapp.sendText(tenant, from, "I wasn't expecting a location right now. Type 'check in' or 'check out' first.");
      }
      return;
    }

    // ── 2. Plain text messages ────────────────────────────────────────────
    if (message.type === 'text') {
      const text = message.text.body.trim().toLowerCase();

      if (tenant.features.attendance && ['check in', 'checkin', 'check-in'].includes(text)) {
        tenantDb(tenant.id).get('conversationState').set(from, { step: 'awaiting_location', data: { type: 'in' } }).write();
        await whatsapp.requestLocation(tenant, from, '📍 Please share your location to confirm check-in.');
        return;
      }
      if (tenant.features.attendance && ['check out', 'checkout', 'check-out'].includes(text)) {
        tenantDb(tenant.id).get('conversationState').set(from, { step: 'awaiting_location', data: { type: 'out' } }).write();
        await whatsapp.requestLocation(tenant, from, '📍 Please share your location to confirm check-out.');
        return;
      }

      if (tenant.features.adminDashboard && isAdmin) {
        const reply = await handleAdminCommand(tenant, text);
        await whatsapp.sendText(tenant, from, reply);
        return;
      }

      await whatsapp.sendText(
        tenant,
        from,
        `👋 Hi! I'm the ${tenant.name} Bot.\n\nEmployees: type 'check in' or 'check out'.\nFor anything else, please contact your administrator.`
      );
    }
  } catch (err) {
    logger.error('Error handling incoming webhook message:', err);
  }
});

module.exports = router;
