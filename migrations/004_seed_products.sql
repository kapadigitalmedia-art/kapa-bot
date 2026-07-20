-- Seeds bot_products + bot_product_tiers with REAL pricing verified
-- directly against the live kapa-website product pages
-- (~/kapa-website/kapa-one-*.html, the `.np-grid` pricing cards —
-- tier name from `.np-plan-name`, price from `.np-price-row`, setup fee
-- from `.np-setup`) as of 2026-07-20.
--
-- IMPORTANT: tier count is NOT uniform across products. 'field' has 4
-- tiers (Starter/Professional/Business/Enterprise); the other 8 products
-- each have only 3 tiers with product-specific branded names (e.g.
-- healthcare: Clinic Basic/Clinic Pro/Hospital Enterprise). This was
-- verified by extracting structured data from each page's np-grid
-- section (not a raw grep — an earlier raw `grep -c np-plan-name` gave
-- misleadingly higher counts because it also matched the CSS class
-- definition `.np-plan-name{...}` in each file's <style> block).
--
-- Total: 9 products, 28 tiers (4 + 8x3).
--
-- NOT executed yet — review together with 003 before running against the
-- live database. Must run after 003 (FK to bot_products).

INSERT INTO bot_products (product_slug, product_name, category, trial_days) VALUES
('field', 'KAPA ONE Field', 'kapa_one', 7),
('dine', 'KAPA ONE Dine', 'kapa_one', 7),
('ports', 'KAPA ONE Ports & Logistics', 'kapa_one', 7),
('healthcare', 'KAPA ONE Healthcare', 'kapa_one', 7),
('education', 'KAPA ONE Education', 'kapa_one', 7),
('hotels', 'KAPA ONE Hotels', 'kapa_one', 7),
('retail', 'KAPA ONE Retail & Trading', 'kapa_one', 7),
('manufacturing', 'KAPA ONE Manufacturing', 'kapa_one', 7),
('finance', 'KAPA ONE Finance', 'kapa_one', 7);

INSERT INTO bot_product_tiers (product_slug, tier_slug, tier_name, tier_order, setup_fee, monthly_price) VALUES
-- field (4 tiers)
('field', 'starter', 'STARTER', 0, 4999.00, 599.00),
('field', 'professional', 'PROFESSIONAL', 1, 9999.00, 999.00),
('field', 'business', 'BUSINESS', 2, 18999.00, 1999.00),
('field', 'enterprise', 'ENTERPRISE', 3, 44999.00, 4999.00),

-- dine (3 tiers)
('dine', 'start', 'KAPA ONE DINE START', 0, 2499.00, 249.00),
('dine', 'pro', 'KAPA ONE DINE PRO', 1, 3999.00, 499.00),
('dine', 'enterprise', 'KAPA ONE DINE ENTERPRISE', 2, 5999.00, 899.00),

-- ports (3 tiers)
('ports', 'starter', 'STARTER', 0, 5999.00, 799.00),
('ports', 'professional', 'PROFESSIONAL', 1, 12999.00, 1499.00),
('ports', 'enterprise', 'ENTERPRISE', 2, 24999.00, 2999.00),

-- healthcare (3 tiers)
('healthcare', 'clinic-basic', 'CLINIC BASIC', 0, 3999.00, 499.00),
('healthcare', 'clinic-pro', 'CLINIC PRO', 1, 7999.00, 999.00),
('healthcare', 'hospital-enterprise', 'HOSPITAL ENTERPRISE', 2, 19999.00, 2499.00),

-- education (3 tiers)
('education', 'school-starter', 'SCHOOL STARTER', 0, 2999.00, 399.00),
('education', 'school-pro', 'SCHOOL PRO', 1, 5999.00, 799.00),
('education', 'institution-enterprise', 'INSTITUTION ENTERPRISE', 2, 9999.00, 1499.00),

-- hotels (3 tiers)
('hotels', 'guesthouse', 'GUESTHOUSE', 0, 3499.00, 449.00),
('hotels', 'hotel-pro', 'HOTEL PRO', 1, 7499.00, 899.00),
('hotels', 'resort-enterprise', 'RESORT ENTERPRISE', 2, 14999.00, 1999.00),

-- retail (3 tiers)
('retail', 'shop-starter', 'SHOP STARTER', 0, 2499.00, 299.00),
('retail', 'retail-pro', 'RETAIL PRO', 1, 4999.00, 599.00),
('retail', 'chain-enterprise', 'CHAIN ENTERPRISE', 2, 9999.00, 1299.00),

-- manufacturing (3 tiers)
('manufacturing', 'factory-basic', 'FACTORY BASIC', 0, 5999.00, 699.00),
('manufacturing', 'factory-pro', 'FACTORY PRO', 1, 11999.00, 1299.00),
('manufacturing', 'enterprise-factory', 'ENTERPRISE FACTORY', 2, 22999.00, 2499.00),

-- finance (3 tiers)
('finance', 'agency-starter', 'AGENCY STARTER', 0, 2999.00, 399.00),
('finance', 'financial-firm-pro', 'FINANCIAL FIRM PRO', 1, 6999.00, 799.00),
('finance', 'enterprise-finance', 'ENTERPRISE FINANCE', 2, 14999.00, 1699.00);
