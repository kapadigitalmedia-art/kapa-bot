require('dotenv').config();

function parseList(str) {
  return (str || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const config = {
  port: process.env.PORT || 3000,

  internalApiKey: process.env.INTERNAL_API_KEY || '',

  meta: {
    accessToken: process.env.META_ACCESS_TOKEN || '',
    phoneNumberId: process.env.META_PHONE_NUMBER_ID || '',
    wabaId: process.env.META_WABA_ID || '',
    appSecret: process.env.META_APP_SECRET || '',
    verifyToken: process.env.META_VERIFY_TOKEN || 'kapa-verify-2026',
    graphApiVersion: 'v20.0',
  },

  officeNumber: process.env.OFFICE_WHATSAPP_NUMBER || '',
  adminNumbers: parseList(process.env.ADMIN_WHATSAPP_NUMBERS),

  kapaHub: {
    baseUrl: process.env.KAPA_HUB_API_BASE_URL || '',
    apiKey: process.env.KAPA_HUB_API_KEY || '',
  },

  // Mock mode kicks in automatically if Meta credentials are missing —
  // lets you run and test the whole bot before WhatsApp is fully wired up.
  get mockMode() {
    return !this.meta.accessToken || !this.meta.phoneNumberId;
  },
};

module.exports = config;
