require('dotenv').config();

/**
 * ── TENANT REGISTRY ──────────────────────────────────────────────────────
 * Every company using the KAPA Bot platform is a "tenant" here — including
 * Kapa Technologies itself (for its own internal use + customer enquiries).
 *
 * To onboard a NEW customer:
 *   1. Add their WhatsApp number in Meta (either as a new number under
 *      Kapa's existing App, or their own App if they need separate billing/
 *      ownership — both work fine with this design).
 *   2. Add one new object to the TENANTS array below.
 *   3. Set their env vars in Render (or hardcode non-secret values directly
 *      here if you prefer — only tokens/keys should stay in env vars).
 *   4. Point their number's webhook (Meta → WhatsApp → Configuration) at
 *      this same shared URL: https://kapa-bot.onrender.com/webhook
 *   5. Give them their own INTERNAL_API_KEY-equivalent (the `apiKey` field
 *      below) to use in their own systems' x-api-key header.
 *
 * No other code changes needed — every route and the webhook handler
 * automatically resolve the correct tenant from either the incoming
 * phone_number_id (WhatsApp messages) or the x-api-key header (API calls).
 */

const TENANTS = [
  {
    id: 'kapa',
    name: 'Kapa Technologies',
    // The WhatsApp number Meta gives this number when you register it —
    // found in Meta → WhatsApp → API Setup → "Phone number ID"
    phoneNumberId: process.env.KAPA_PHONE_NUMBER_ID || '',
    // The actual number, digits only, used as the "office" destination for
    // lead/error/subscription alerts
    officeNumber: process.env.KAPA_OFFICE_NUMBER || '917550008031',
    adminNumbers: (process.env.KAPA_ADMIN_NUMBERS || '917550008031')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    // Leave blank to use the shared global META_ACCESS_TOKEN from config.js
    // (normal case: one Kapa-owned Meta App, many numbers under it)
    accessTokenOverride: process.env.KAPA_ACCESS_TOKEN || '',
    // Secret this tenant's own systems (e.g. submit.php on one.kapa.my)
    // must send as the x-api-key header
    apiKey: process.env.KAPA_API_KEY || '',
    // Which modules are switched on for this tenant
    features: {
      attendance: true,
      leads: true,
      errors: true,
      subscriptions: true,
      adminDashboard: true,
    },
  },

  // ── EXAMPLE: template for the next customer you onboard ────────────────
  // Duplicate this block, fill in their real values, and they're live.
  // Asia Avid's CURRENT system (kapa-attendance-bot1) is a separate,
  // untouched deployment — this entry is just a ready-to-fill template for
  // when you're ready to migrate them onto this shared platform, or onboard
  // any new customer using the same blueprint.
  //
  // {
  //   id: 'asia-avid',
  //   name: 'Asia Avid Sdn Bhd',
  //   phoneNumberId: process.env.ASIAAVID_PHONE_NUMBER_ID || '',
  //   officeNumber: process.env.ASIAAVID_OFFICE_NUMBER || '',
  //   adminNumbers: (process.env.ASIAAVID_ADMIN_NUMBERS || '').split(',').map(s => s.trim()).filter(Boolean),
  //   accessTokenOverride: process.env.ASIAAVID_ACCESS_TOKEN || '', // set this if they're on a separate Meta App
  //   apiKey: process.env.ASIAAVID_API_KEY || '',
  //   features: { attendance: true, leads: false, errors: false, subscriptions: false, adminDashboard: true },
  // },
];

// The shared demo number prospects message on before they have a
// tenant of their own — same env var as 'kapa's own phoneNumberId
// above, not a separately hardcoded literal, so the two can never drift
// out of sync with each other.
const SHARED_DEMO_PHONE_NUMBER_ID = process.env.KAPA_PHONE_NUMBER_ID || '';

function getTenantByPhoneNumberId(phoneNumberId) {
  return TENANTS.find((t) => t.phoneNumberId && t.phoneNumberId === phoneNumberId) || null;
}

function getTenantByApiKey(apiKey) {
  return TENANTS.find((t) => t.apiKey && t.apiKey === apiKey) || null;
}

function getTenantById(id) {
  return TENANTS.find((t) => t.id === id) || null;
}

function getAllTenants() {
  return TENANTS;
}

module.exports = {
  TENANTS,
  SHARED_DEMO_PHONE_NUMBER_ID,
  getTenantByPhoneNumberId,
  getTenantByApiKey,
  getTenantById,
  getAllTenants,
};
