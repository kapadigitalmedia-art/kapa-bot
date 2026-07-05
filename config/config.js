require('dotenv').config();

const config = {
  port: process.env.PORT || 3000,

  meta: {
    // A shared default access token, used by any tenant that doesn't
    // specify its own override (see config/tenants.js). This covers the
    // common SaaS case: one Kapa-owned Meta App/WABA, many phone numbers
    // (one per customer) all sharing the same access token.
    accessToken: process.env.META_ACCESS_TOKEN || '',
    verifyToken: process.env.META_VERIFY_TOKEN || 'kapa-verify-2026',
    graphApiVersion: 'v20.0',
  },

  // Mock mode kicks in automatically if no default token is set AND no
  // tenant provides its own override — lets you build/test everything
  // before WhatsApp is fully wired up.
  get mockMode() {
    return !this.meta.accessToken;
  },
};

module.exports = config;

