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

  // Whether a SPECIFIC tenant is in mock mode — mirrors the exact
  // resolution order services/whatsapp.js uses to send
  // (tenant.accessTokenOverride || config.meta.accessToken), so this
  // reflects that tenant's real send capability, not just the shared
  // default. Use this, not the global `mockMode` below, wherever the
  // answer needs to be accurate for a given tenant.
  tenantMockMode(tenant) {
    return !(tenant.accessTokenOverride || this.meta.accessToken);
  },

  // Global-default-only fallback: true if the shared default token is
  // unset. A tenant with its own accessTokenOverride can still send for
  // real even when this is true — it does NOT account for per-tenant
  // overrides, so don't use it to answer "can tenant X send right now?".
  get mockMode() {
    return !this.meta.accessToken;
  },
};

module.exports = config;

