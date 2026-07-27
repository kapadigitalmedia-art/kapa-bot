-- order_id on bot_dine_sales (028) — anchors the gateway-reconciliation
-- record to the real order it was generated for, now that
-- bot_dine_orders (031) exists as the actual "what was sold" record.
--
-- Separate ALTER migration rather than editing 028's original file,
-- matching this schema's established pattern (029 added
-- salt_encrypted to bot_tenant_payment_gateways the same way rather
-- than rewriting 028's CREATE TABLE in place).
--
-- Nullable, not required — a bare "charge this amount" QR with no
-- full order attached is still a plausible quick-charge path
-- (e.g. a takeaway sale rung up without itemized order entry), so
-- bot_dine_sales must keep working without an order_id, not just with
-- one.
--
-- No ON DELETE behavior specified (defaults to RESTRICT) — same
-- reasoning as bot_dine_order_items.menu_item_id in 031: a sales
-- record's order_id should keep resolving to a real row for
-- reconciliation/reporting, and orders aren't expected to be
-- hard-deleted once they exist (cancelled via status='cancelled'
-- instead).
--
-- This is the write path the previous inventory pass flagged as
-- missing entirely — bot_dine_sales (028) has existed with no code
-- ever inserting into it. Wiring QR-order checkout to create a
-- bot_dine_sales row (with this order_id populated) is the follow-up
-- application work this column exists to support; not part of this
-- migration.
--
-- Depends on bot_dine_sales (028) and bot_dine_orders (031). NOT
-- executed yet — review before running against Railway.

ALTER TABLE bot_dine_sales
  ADD COLUMN order_id INT NULL AFTER tenant_id,
  ADD CONSTRAINT fk_dine_sales_order FOREIGN KEY (order_id) REFERENCES bot_dine_orders(id);
