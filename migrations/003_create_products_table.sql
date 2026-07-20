-- Pricing source-of-truth: two-table design, replacing the earlier
-- single-price-per-product version (never run against Railway, so no
-- migration needed to undo it — this file is a straight rewrite).
--
-- bot_products is descriptive-only now — no price columns. Pricing lives
-- entirely in bot_product_tiers, since real pricing has multiple tiers
-- per product (see 004_seed_products.sql for the actual counts — it's
-- NOT a uniform number of tiers per product).
--
-- NOT executed yet — review together with 004 before running against the
-- live database. bot_products must be created first (bot_product_tiers
-- has an FK to it).

CREATE TABLE IF NOT EXISTS bot_products (
  product_slug VARCHAR(50) PRIMARY KEY,
  product_name VARCHAR(100) NOT NULL,
  category ENUM('kapa_one', 'kapa_ai') NOT NULL,
  trial_days INT DEFAULT 7,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- One row per (product, tier). tier_slug is unique per product (not
-- globally) so e.g. every product could have a 'starter' tier without
-- collisions. tier_order controls display order explicitly, independent
-- of price, in case two tiers ever tie or ordering shouldn't just be
-- ORDER BY monthly_price.
CREATE TABLE IF NOT EXISTS bot_product_tiers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_slug VARCHAR(50) NOT NULL,
  tier_slug VARCHAR(50) NOT NULL,
  tier_name VARCHAR(100) NOT NULL,
  tier_order INT NOT NULL DEFAULT 0,
  setup_fee DECIMAL(10,2) NOT NULL,
  monthly_price DECIMAL(10,2) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_product_tier (product_slug, tier_slug),
  CONSTRAINT fk_tier_product FOREIGN KEY (product_slug)
    REFERENCES bot_products(product_slug)
);
