const express = require('express');
const router = express.Router();
const config = require('../config/config');
const whatsapp = require('../services/whatsapp');
const db = require('../services/db');
const logger = require('../utils/logger');
const { recordAttendance } = require('./attendance');
const { handleAdminCommand } = require('../services/adminCommands');

/**
 * GET /webhook
 * Meta calls this once, when you set up the webhook in the App dashboard,
 * to verify you own this URL. Must echo back the "hub.challenge" value.
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
 * Meta sends every incoming WhatsApp message/event here. This is where
 * the two-way conversation logic lives: attendance check-in/out flow,
 * and admin dashboard commands.
 */
router.post('/', async (req, res) => {
  // Always ack immediately — Meta expects a fast 200, retries otherwise.
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) return; // status update / non-message event — ignore

    const from = message.from; // sender's number, digits only
    const contactName = value?.contacts?.[0]?.profile?.name || null;

    logger.info(`Incoming WhatsApp from ${from} (${contactName || 'unknown'}): type=${message.type}`);

    const isAdmin = config.adminNumbers.includes(from);

    // ── 1. Handle location messages (used to complete a check-in/out) ────
    if (message.type === 'location') {
      const state = db.get('conversationState').get(from).value();
      if (state && state.step === 'awaiting_location') {
        const record = recordAttendance({
          phone: from,
          name: contactName,
          type: state.data.type,
          lat: message.location.latitude,
          lng: message.location.longitude,
        });
        db.get('conversationState').unset(from).write();
        await whatsapp.sendText(
          from,
          `✅ *Check-${record.type === 'in' ? 'In' : 'Out'} Recorded*\n\nTime: ${new Date(record.timestamp).toLocaleTimeString()}\nLocation received. Thank you!`
        );
      } else {
        await whatsapp.sendText(from, "I wasn't expecting a location right now. Type 'check in' or 'check out' first.");
      }
      return;
    }

    // ── 2. Handle plain text messages ─────────────────────────────────────
    if (message.type === 'text') {
      const text = message.text.body.trim().toLowerCase();

      // Attendance keywords
      if (text === 'check in' || text === 'checkin' || text === 'check-in') {
        db.get('conversationState').set(from, { step: 'awaiting_location', data: { type: 'in' } }).write();
        await whatsapp.requestLocation(from, '📍 Please share your location to confirm check-in.');
        return;
      }
      if (text === 'check out' || text === 'checkout' || text === 'check-out') {
        db.get('conversationState').set(from, { step: 'awaiting_location', data: { type: 'out' } }).write();
        await whatsapp.requestLocation(from, '📍 Please share your location to confirm check-out.');
        return;
      }

      // Admin dashboard commands — only for numbers listed in ADMIN_WHATSAPP_NUMBERS
      if (isAdmin) {
        const reply = await handleAdminCommand(text);
        await whatsapp.sendText(from, reply);
        return;
      }

      // Default fallback for anyone else texting the bot
      await whatsapp.sendText(
        from,
        "👋 Hi! I'm the KAPA Bot.\n\nEmployees: type 'check in' or 'check out'.\nFor anything else, please contact your KAPA administrator."
      );
    }
  } catch (err) {
    logger.error('Error handling incoming webhook message:', err);
  }
});

module.exports = router;
