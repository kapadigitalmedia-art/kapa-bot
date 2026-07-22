-- bot_trial_signups — one row per prospect who picks an industry with a
-- working demo (currently just 'field') and signs up for a trial. Each
-- signup gets its own bot_tenants row (tenant_id here is a UNIQUE FK to
-- it), reusing every existing table/function (bot_employees,
-- bot_leave_requests, bot_tasks, the whole approval engine, etc.)
-- completely unmodified — tenant_id is already the sole isolation
-- boundary everywhere in this schema, so a real per-signup tenant row is
-- a single INSERT instead of inventing a parallel sub-scoping mechanism
-- across every table.
--
-- ── The two-role tenant object problem ──────────────────────────────────
-- Everywhere in this codebase, a "tenant" object serves two genuinely
-- different roles: (1) WhatsApp send credentials (phoneNumberId,
-- accessTokenOverride, adminNumbers, features — all read from
-- config/tenants.js's static, env-var-driven TENANTS array), and
-- (2) the DB scoping key (tenant.id, passed as tenantId into every
-- db-mysql.js function). For a trial signup sharing KAPA's single demo
-- WhatsApp number, these two roles must come from TWO DIFFERENT
-- sources: role (1) has to stay KAPA's own config entry (the trial
-- customer has no Meta number/token of their own yet), while role (2)
-- must be THIS signup's own bot_tenants.tenant_id (the whole point of
-- the isolation — otherwise every trial customer's data would land in
-- kapa's own rows).
--
-- resolveTenantForMessage (services/tenantResolution.js, not yet built)
-- resolves this by looking up the static config tenant for the incoming
-- phone_number_id as usual, then — only when that phone_number_id is
-- kapa's shared demo number — looking up the sender's OWN row in this
-- table by whatsapp_number (the UNIQUE lookup key) and building a merged
-- object: `{ ...configTenant, id: trialSignup.tenant_id, name:
-- trialSignup.company_name }`. Every downstream call site keeps working
-- unmodified — services/whatsapp.js still sends via kapa's real
-- credentials, while every db-mysql.js call scores against the trial's
-- own isolated tenant_id.
--
-- ── The upgrade-path gap (deferred, not forgotten) ──────────────────────
-- own_phone_number_id exists for when a trial customer gets their own
-- dedicated WhatsApp Business number, but resolving THAT number back to
-- their tenant isn't implemented by anything built so far:
-- getTenantByPhoneNumberId only ever checks config/tenants.js's static
-- TENANTS array, which has no way to learn about a number that was
-- assigned to a customer at runtime (as opposed to at deploy time via
-- env vars). Making an upgraded customer's own number actually route to
-- their tenant will need either (a) a manual config/tenants.js entry +
-- redeploy per upgrade, or (b) extending resolution to also check this
-- table's own_phone_number_id/status='upgraded' rows, not just the
-- shared demo number path. Column is captured now so the data exists
-- when that gets built; the resolution logic itself does not exist yet.
--
-- country_code is NOT NULL because bot_tenants.country_code is NOT NULL
-- (migration 006) and feeds calculatePayroll's statutory bracket lookup
-- (EPF/SOCSO/EIS are country-specific) — the bot_tenants row this FK
-- points at can't be created without one, so it's captured at signup
-- rather than defaulted silently (prospects aren't guaranteed to be in
-- Malaysia just because Asia Avid is).
--
-- Depends on bot_tenants (006). NOT executed yet — review before running
-- against Railway.

CREATE TABLE IF NOT EXISTS bot_trial_signups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  whatsapp_number VARCHAR(20) NOT NULL UNIQUE,
  tenant_id VARCHAR(50) NOT NULL UNIQUE,
  industry_slug VARCHAR(50) NOT NULL,
  company_name VARCHAR(200),
  contact_name VARCHAR(150),
  email VARCHAR(200),
  country_code VARCHAR(2) NOT NULL,
  trial_started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  trial_ends_at TIMESTAMP NULL,
  status ENUM('trial','upgraded','expired') DEFAULT 'trial',
  upgraded_at TIMESTAMP NULL,
  -- Upgrade-path tenant resolution not yet implemented — see chat/design
  -- notes, this column exists for future use.
  own_phone_number_id VARCHAR(50) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_trial_signup_tenant FOREIGN KEY (tenant_id) REFERENCES bot_tenants(tenant_id)
);
