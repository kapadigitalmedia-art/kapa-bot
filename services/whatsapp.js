const axios = require('axios');
const config = require('../config/config');
const logger = require('../utils/logger');

/**
 * Send a plain text WhatsApp message on behalf of a specific tenant.
 * Falls back to console logging ("mock mode") if no access token is
 * available (globally or per-tenant), so the rest of the system can be
 * built/tested before WhatsApp is fully wired up for a given tenant.
 *
 * @param {object} tenant  Tenant object from config/tenants.js
 * @param {string} to      Destination number, digits only with country code
 * @param {string} message Plain text message body
 */
async function sendText(tenant, to, message) {
  if (!tenant) return { ok: false, error: 'Unknown tenant' };
  if (!to) return { ok: false, error: 'Missing destination number' };

  const accessToken = tenant.accessTokenOverride || config.meta.accessToken;
  const phoneNumberId = tenant.phoneNumberId;

  if (!accessToken || !phoneNumberId) {
    logger.warn(`[MOCK MODE] [${tenant.id}] WhatsApp send suppressed — missing access token or phoneNumberId for this tenant.`);
    logger.info(`[MOCK MODE] [${tenant.id}] Would send to ${to}:\n${message}`);
    return { ok: true, mock: true };
  }

  const url = `https://graph.facebook.com/${config.meta.graphApiVersion}/${phoneNumberId}/messages`;

  try {
    const res = await axios.post(
      url,
      { messaging_product: 'whatsapp', to, type: 'text', text: { body: message } },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    logger.info(`[${tenant.id}] WhatsApp sent -> ${to} | messageId=${res.data?.messages?.[0]?.id || 'n/a'}`);
    return { ok: true, data: res.data };
  } catch (err) {
    const detail = err.response?.data || err.message;
    logger.error(`[${tenant.id}] WhatsApp send FAILED -> ${to}`, detail);
    return { ok: false, error: JSON.stringify(detail) };
  }
}

/**
 * Send a message to this tenant's configured office number — convenience
 * wrapper used by lead/error/subscription alerts.
 */
async function sendToOffice(tenant, message) {
  return sendText(tenant, tenant.officeNumber, message);
}

/**
 * Broadcast a message to every admin number configured for this tenant.
 */
async function sendToAllAdmins(tenant, message) {
  const numbers = tenant.adminNumbers || [];
  return Promise.all(numbers.map((n) => sendText(tenant, n, message)));
}

/**
 * Send an interactive location-request message (used for attendance
 * check-in/out confirmation).
 */
async function requestLocation(tenant, to, bodyText) {
  const accessToken = tenant.accessTokenOverride || config.meta.accessToken;
  const phoneNumberId = tenant.phoneNumberId;

  if (!accessToken || !phoneNumberId) {
    logger.info(`[MOCK MODE] [${tenant.id}] Would request location from ${to}: ${bodyText}`);
    return { ok: true, mock: true };
  }

  const url = `https://graph.facebook.com/${config.meta.graphApiVersion}/${phoneNumberId}/messages`;
  try {
    const res = await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: { type: 'location_request_message', body: { text: bodyText }, action: { name: 'send_location' } },
      },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    return { ok: true, data: res.data };
  } catch (err) {
    const detail = err.response?.data || err.message;
    logger.error(`[${tenant.id}] Location request FAILED -> ${to}`, detail);
    return { ok: false, error: JSON.stringify(detail) };
  }
}

/**
 * Send an interactive reply-button message — used for approve/reject
 * prompts (leave/expense/etc. approval). buttons is an array of
 * {id, title} objects; WhatsApp caps this at 3, but every caller here
 * only ever sends 2 (approve/reject).
 */
async function sendButtons(tenant, to, bodyText, buttons) {
  if (!tenant) return { ok: false, error: 'Unknown tenant' };
  if (!to) return { ok: false, error: 'Missing destination number' };

  const accessToken = tenant.accessTokenOverride || config.meta.accessToken;
  const phoneNumberId = tenant.phoneNumberId;

  if (!accessToken || !phoneNumberId) {
    logger.info(`[MOCK MODE] [${tenant.id}] Would send buttons to ${to}: ${bodyText} | buttons=${JSON.stringify(buttons)}`);
    return { ok: true, mock: true };
  }

  const url = `https://graph.facebook.com/${config.meta.graphApiVersion}/${phoneNumberId}/messages`;

  try {
    const res = await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: bodyText },
          action: { buttons: buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })) },
        },
      },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    logger.info(`[${tenant.id}] WhatsApp buttons sent -> ${to} | messageId=${res.data?.messages?.[0]?.id || 'n/a'}`);
    return { ok: true, data: res.data };
  } catch (err) {
    const detail = err.response?.data || err.message;
    logger.error(`[${tenant.id}] WhatsApp buttons send FAILED -> ${to}`, detail);
    return { ok: false, error: JSON.stringify(detail) };
  }
}

module.exports = { sendText, sendToOffice, sendToAllAdmins, requestLocation, sendButtons };
