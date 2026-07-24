-- bot_dine_sales — one row per DuitNow QR (or other payment method)
-- generated for a sale, tracking it from QR generation through
-- HitPay's async payment confirmation.
--
-- gateway_reference is what ties an incoming HitPay webhook back to the
-- right row: HitPay's payment-request creation call returns its own
-- id, we store it here at qr_generated_at time, and the webhook payload
-- carries the same id back — the lookup is
-- `WHERE gateway_reference = ?`, not tenant+amount+time matching. It's
-- nullable only until the first API call returns (a row can exist
-- briefly between "we decided to generate a QR" and "HitPay
-- acknowledged and gave us an id"), and UNIQUE once populated so the
-- same HitPay reference can never be attributed to two rows.
--
-- status intentionally IS a stored column here, unlike
-- bot_foreign_worker_documents' expiry status (026) — that one was
-- computed at read time because it drifts purely off a date comparison
-- anyone can redo (CURDATE() vs expiry_date). Payment status is not a
-- pure function of anything else in this row; it's an external fact
-- that only HitPay's webhook (or a reconciliation poll) can tell us, so
-- it has to be written down, not derived.
--
-- recorded_by_employee_id: ON DELETE SET NULL, matching the
-- employee-reference convention already established across this schema
-- (009/010/011/012/018/026) — a sale record outlives the employee who
-- rang it up, same reasoning as those tables.
--
-- amount is DECIMAL(10,2), not FLOAT/DOUBLE — this is money; every
-- other currency column in this schema (bot_payroll_records,
-- bot_expense_claims) already uses DECIMAL for the same reason.
--
-- Depends on bot_tenants (006) and bot_employees (006). NOT executed
-- yet — review before running against Railway.

CREATE TABLE IF NOT EXISTS bot_dine_sales (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(50) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  payment_method ENUM('duitnow_qr','cash','card') NOT NULL DEFAULT 'duitnow_qr',
  status ENUM('pending','paid','failed','expired') NOT NULL DEFAULT 'pending',
  gateway_reference VARCHAR(255),
  qr_generated_at TIMESTAMP NULL,
  paid_at TIMESTAMP NULL,
  recorded_by_employee_id INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_gateway_reference (gateway_reference),
  KEY idx_dine_sales_tenant_status (tenant_id, status),
  CONSTRAINT fk_dine_sales_tenant FOREIGN KEY (tenant_id) REFERENCES bot_tenants(tenant_id),
  CONSTRAINT fk_dine_sales_employee FOREIGN KEY (recorded_by_employee_id) REFERENCES bot_employees(id)
    ON DELETE SET NULL
);

-- bot_tenant_payment_gateways — one payment-gateway connection per
-- tenant (UNIQUE tenant_id, not just indexed — this models "the"
-- gateway for a tenant, not "a" gateway; move to a compound key only if
-- multi-gateway support is ever actually built).
--
-- api_key_encrypted: see the accompanying note for the encryption
-- approach (AES-256-GCM via Node's crypto, server-side key from env,
-- NOT bcrypt — this must be reversible since the raw key is needed to
-- call HitPay's API, unlike password_hash which only ever needs
-- one-way comparison). Column is TEXT, not VARCHAR, because the stored
-- value is ciphertext + iv + auth tag, not the raw key — see note for
-- the exact encoding.
--
-- connected_by_employee_id: SET NULL, same convention as every other
-- employee reference in this schema.
--
-- Depends on bot_tenants (006) and bot_employees (006). NOT executed
-- yet — review before running against Railway.

CREATE TABLE IF NOT EXISTS bot_tenant_payment_gateways (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(50) NOT NULL,
  gateway_name VARCHAR(50) NOT NULL DEFAULT 'hitpay',
  api_key_encrypted TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  connected_by_employee_id INT,
  CONSTRAINT uq_tenant_gateway UNIQUE (tenant_id),
  CONSTRAINT fk_tenant_gateway_tenant FOREIGN KEY (tenant_id) REFERENCES bot_tenants(tenant_id),
  CONSTRAINT fk_tenant_gateway_employee FOREIGN KEY (connected_by_employee_id) REFERENCES bot_employees(id)
    ON DELETE SET NULL
);
