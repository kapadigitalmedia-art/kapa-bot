-- bot_dine_orders / bot_dine_order_items — the real order-entry record
-- for a table (dine_in) or a walk-up (takeaway), replacing "just an
-- amount" as the unit of business activity. See 032's header for how
-- this relates to bot_dine_sales (028) — orders are the "what was
-- sold" record; bot_dine_sales stays scoped to gateway-reconciliation
-- only, linked back to its order via the order_id column 032 adds.
--
-- table_number is nullable and only meaningful for dine_in — enforced
-- in application code at order-creation time, not a DB CHECK
-- constraint, consistent with this schema's existing convention of
-- validating cross-field invariants in JS (e.g. the QR amount
-- validation in routes/webhook.js) rather than in SQL.
--
-- payment_method is nullable, unlike bot_dine_sales.payment_method
-- (NOT NULL DEFAULT 'duitnow_qr') — a sales row is only ever created
-- once a payment method is already decided (at QR-generation time), but
-- an order exists from the moment it's opened, before staff have
-- decided how the customer will pay. Populated alongside status='paid'
-- and paid_at at settlement time.
--
-- total_amount is a maintained rollup, not a generated column — MySQL
-- can't SUM a child table (bot_dine_order_items) into a generated
-- column on the parent. Application code recomputes and writes it
-- whenever order_items change; bot_dine_order_items remains the source
-- of truth for what's actually in the order.
--
-- created_by_employee_id: ON DELETE SET NULL, the same employee-
-- reference convention as every other table in this schema
-- (009/010/011/012/018/026/028) — an order outlives the staff member
-- who opened it.
--
-- bot_dine_order_items has no tenant_id of its own — reached only via
-- order_id, same pattern as bot_task_assignments (011), a child table
-- with no independent tenant scope.
--
-- order_id: ON DELETE CASCADE — a line item has no meaning without its
-- order, matching this schema's established join-table-child pattern
-- (e.g. bot_task_assignments -> bot_tasks).
--
-- menu_item_id: no ON DELETE clause (defaults to RESTRICT) —
-- deliberately different from the employee-reference SET NULL
-- convention. A historical order line needs its menu_item_id to keep
-- resolving to a real row (name/category for receipts and reporting);
-- menu items are disabled via is_available, not deleted, so this
-- should never actually fire in normal operation.
--
-- unit_price is captured at order time and never re-derived from
-- bot_dine_menu_items.price later — a price change must not
-- retroactively alter historical orders' totals.
--
-- updated_at: same convention as every other mutable table in this
-- schema — tracks edits to an open order (items added/removed,
-- total_amount recomputed) before it's paid.
--
-- No constraint prevents two simultaneously 'open' orders from sharing
-- the same table_number for a tenant — deliberately left as an
-- application-level rule, not a DB one. Whether a table can have at
-- most one open order isn't a fixed invariant of the data (e.g. split
-- bills or reopening a table could legitimately need more than one),
-- so it belongs with the order-creation logic that actually knows the
-- business rule in effect, not baked into the schema as a hard
-- uniqueness constraint.
--
-- Depends on bot_tenants (006), bot_employees (006), and
-- bot_dine_menu_items (030). NOT executed yet — review before running
-- against Railway.

CREATE TABLE IF NOT EXISTS bot_dine_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(50) NOT NULL,
  order_type ENUM('dine_in','takeaway') NOT NULL,
  table_number VARCHAR(20),
  status ENUM('open','paid','cancelled') NOT NULL DEFAULT 'open',
  total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  payment_method ENUM('cash','qr'),
  created_by_employee_id INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  paid_at TIMESTAMP NULL,
  KEY idx_dine_orders_tenant_status (tenant_id, status),
  CONSTRAINT fk_dine_orders_tenant FOREIGN KEY (tenant_id) REFERENCES bot_tenants(tenant_id),
  CONSTRAINT fk_dine_orders_employee FOREIGN KEY (created_by_employee_id) REFERENCES bot_employees(id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS bot_dine_order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  menu_item_id INT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL,
  CONSTRAINT fk_dine_order_items_order FOREIGN KEY (order_id) REFERENCES bot_dine_orders(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_dine_order_items_menu_item FOREIGN KEY (menu_item_id) REFERENCES bot_dine_menu_items(id)
);
