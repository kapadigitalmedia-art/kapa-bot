-- bot_dine_menu_items — per-tenant menu catalog (name, category,
-- price) that bot_dine_order_items (031) will reference. Same shape as
-- bot_dine_inventory (025): tenant-scoped, soft-disable flag instead of
-- hard delete, unique per (tenant_id, name).
--
-- is_available (not is_active) — named to match this table's actual
-- meaning: "currently sellable", distinct from bot_dine_inventory's
-- is_active which means "not soft-deleted". A menu item can exist and
-- be visible in admin/reporting while temporarily 86'd (out of an
-- ingredient) without being deleted — that's what this flag is for.
--
-- price is a live, current-facing value — the price a new order would
-- charge right now. It is NOT the value orders bill against once
-- placed; see bot_dine_order_items.unit_price (031) for why that's a
-- separate, frozen column instead of a live lookup against this one.
--
-- Depends on bot_tenants (006). NOT executed yet — review before
-- running against Railway.

CREATE TABLE IF NOT EXISTS bot_dine_menu_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(50) NOT NULL,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(100),
  price DECIMAL(10,2) NOT NULL,
  is_available BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_menu_item (tenant_id, name),
  CONSTRAINT fk_dine_menu_items_tenant FOREIGN KEY (tenant_id) REFERENCES bot_tenants(tenant_id)
);
