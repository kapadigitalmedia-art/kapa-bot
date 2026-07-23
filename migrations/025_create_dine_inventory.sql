-- bot_dine_inventory — per-tenant inventory tracking for Dine trial
-- tenants (item_name, current_stock, minimum_stock, unit), scoped by
-- tenant_id the same way every other table in this schema is.
--
-- Adapted from kapa-dine-bot's real, working dine_inventory table
-- (already live in production there, backing getInventory/
-- createInventoryItem/updateInventoryStock in that repo's db.js) — same
-- columns, renamed company_id -> tenant_id to match this codebase's
-- convention, plus is_active (soft-delete, consistent with
-- bot_employees/bot_approval_chains) and a real FK to bot_tenants
-- instead of dine-bot's free-standing company_id string.
--
-- Two deliberate improvements over the source, not carried over
-- verbatim:
--
-- 1. Future update/delete functions built against this table should key
--    off the real `id` primary key, not case-insensitive item_name
--    string matching like kapa-dine-bot's updateInventoryStock does
--    (`WHERE company_id=? AND LOWER(item_name)=LOWER(?)`). That works
--    but is fragile — two items differing only by a typo/whitespace
--    collide, and renaming an item silently breaks every existing
--    reference to its old name. id doesn't have either problem.
--
-- 2. A getLowStockItems function will be added when this table is
--    actually wired up — kapa-dine-bot's source has the minimum_stock
--    column but never once queries current_stock against it for a
--    low-stock alert; the column exists there but is fully decorative.
--    This migration keeps the column (still useful, still the right
--    shape) but the follow-up work item is to actually use it, not just
--    carry it forward unused a second time.
--
-- uq_tenant_item mirrors bot_employees' uq_tenant_whatsapp pattern —
-- item names are unique per-tenant, not globally, so two unrelated
-- tenants can both stock an item called "Rice" without conflict.
--
-- Depends on bot_tenants (006). NOT executed yet — review before running
-- against Railway.

CREATE TABLE IF NOT EXISTS bot_dine_inventory (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(50) NOT NULL,
  item_name VARCHAR(200) NOT NULL,
  category VARCHAR(100),
  current_stock DECIMAL(10,2) DEFAULT 0,
  minimum_stock DECIMAL(10,2) DEFAULT 0,
  unit VARCHAR(50),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_item (tenant_id, item_name),
  CONSTRAINT fk_dine_inventory_tenant FOREIGN KEY (tenant_id) REFERENCES bot_tenants(tenant_id)
);
