-- Module catalog + tier-to-module mapping + per-tenant add-on modules +
-- customization request tracking.
--
-- Dependency order:
--   1. bot_modules                (no dependencies)
--   2. bot_tier_modules           -> bot_modules, bot_product_tiers (003)
--   3. bot_company_modules        -> bot_tenants (006), bot_modules
--   4. bot_customization_requests -> bot_tenants (006)
--
-- NOT executed yet — review before running against Railway.

CREATE TABLE IF NOT EXISTS bot_modules (
  module_slug VARCHAR(60) PRIMARY KEY,
  module_name VARCHAR(150) NOT NULL,
  category ENUM('shared','industry_specific') NOT NULL,
  description VARCHAR(255),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- product_slug/tier_slug reference bot_product_tiers' composite UNIQUE KEY
-- uq_product_tier (product_slug, tier_slug) from migration 003 — MySQL
-- allows an FK against any unique index, not only the table's PRIMARY KEY,
-- so this is a real composite FK, not just two loose VARCHAR columns.
-- An invalid (product_slug, tier_slug) pair is now rejected by the DB
-- itself rather than silently creating an orphaned mapping.
CREATE TABLE IF NOT EXISTS bot_tier_modules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_slug VARCHAR(50) NOT NULL,
  tier_slug VARCHAR(50) NOT NULL,
  module_slug VARCHAR(60) NOT NULL,
  UNIQUE KEY uq_tier_module (product_slug, tier_slug, module_slug),
  CONSTRAINT fk_tm_tier FOREIGN KEY (product_slug, tier_slug)
    REFERENCES bot_product_tiers(product_slug, tier_slug),
  CONSTRAINT fk_tm_module FOREIGN KEY (module_slug) REFERENCES bot_modules(module_slug)
);

CREATE TABLE IF NOT EXISTS bot_company_modules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(50) NOT NULL,
  module_slug VARCHAR(60) NOT NULL,
  added_by VARCHAR(100),
  note VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_company_module (tenant_id, module_slug),
  CONSTRAINT fk_cm_tenant FOREIGN KEY (tenant_id) REFERENCES bot_tenants(tenant_id),
  CONSTRAINT fk_cm_module FOREIGN KEY (module_slug) REFERENCES bot_modules(module_slug)
);

CREATE TABLE IF NOT EXISTS bot_customization_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  status ENUM('requested','quoted','approved','in_progress','completed','rejected') DEFAULT 'requested',
  quoted_price DECIMAL(10,2),
  approved_by VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cr_tenant FOREIGN KEY (tenant_id) REFERENCES bot_tenants(tenant_id)
);
