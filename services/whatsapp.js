const axios = require('axios');
const config = require('../config/config');
const logger = require('../utils/logger');

/**
 * Send a plain text WhatsApp message via the official Meta Cloud API.
 * Falls back to console logging ("mock mode") if credentials aren't set yet,
 * so the rest of the system can be built/tested before WhatsApp is live.
 *
 * @param {string} to      Destination number, digits only with country code (e.g. "917550008031")
 * @param {string} message Plain text message body
 * @returns {Promise<{ok: boolean, mock?: boolean, error?: string, data?: any}>}
 */
async function sendText(to, message) {
  if (!to) {
    return { ok: false, error: 'Missing destination number' };
  }

  if (config.mockMode) {
    logger.warn('[MOCK MODE] WhatsApp send suppressed — META_ACCESS_TOKEN / META_PHONE_NUMBER_ID not set.');
    logger.info(`[MOCK MODE] Would send to ${to}:\n${message}`);
    return { ok: true, mock: true };
  }

  const url = `https://graph.facebook.com/${config.meta.graphApiVersion}/${config.meta.phoneNumberId}/messages`;

  try {
    const res = await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${config.meta.accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );
    logger.info(`WhatsApp sent -> ${to} | messageId=${res.data?.messages?.[0]?.id || 'n/a'}`);
    return { ok: true, data: res.data };
  } catch (err) {
    const detail = err.response?.data || err.message;
    logger.error(`WhatsApp send FAILED -> ${to}`, detail);
    return { ok: false, error: JSON.stringify(detail) };
  }
}

/**
 * Send a WhatsApp message to the main office number (used by lead/error/
 * subscription alerts) — convenience wrapper around sendText().
 */
async function sendToOffice(message) {
  return sendText(config.officeNumber, message);
}

/**
 * Broadcast a message to every configured admin number.
 */
async function sendToAllAdmins(message) {
  const results = await Promise.all(config.adminNumbers.map((n) => sendText(n, message)));
  return results;
}

/**
 * Send an interactive location-request message (used to ask an employee
 * to share their location for check-in/check-out verification).
 */
async function requestLocation(to, bodyText) {
  if (config.mockMode) {
    logger.info(`[MOCK MODE] Would request location from ${to}: ${bodyText}`);
    return { ok: true, mock: true };
  }

  const url = `https://graph.facebook.com/${config.meta.graphApiVersion}/${config.meta.phoneNumberId}/messages`;
  try {
    const res = await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'location_request_message',
          body: { text: bodyText },
          action: { name: 'send_location' },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${config.meta.accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );
    return { ok: true, data: res.data };
  } catch (err) {
    const detail = err.response?.data || err.message;
    logger.error(`Location request FAILED -> ${to}`, detail);
    return { ok: false, error: JSON.stringify(detail) };
  }
}

module.exports = {
  sendText,
  sendToOffice,
  sendToAllAdmins,
  requestLocation,
};
