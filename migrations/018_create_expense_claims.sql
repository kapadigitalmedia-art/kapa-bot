-- Expense claims table for the new multi-tenant model, matching
-- kapa-attendance-bot's live `expense_claims` table shape (pulled via
-- DESCRIBE against Railway, since that repo has no CREATE TABLE in
-- source) with one fix and two additions, not a straight port:
--
--   FIX (in the port's createExpenseClaim, not this schema): the source
--   never applies the null/undefined-insertId defensive check that
--   createLeaveRequest got after the documented Sharifah incident —
--   db.js's createExpenseClaim wraps result.insertId into { id: ... }
--   unconditionally, and index.js's wrapper only checks the object
--   itself is truthy, never that .id is a real value. Same bug class,
--   never caught here. Fixed in the port's function, not the schema.
--
--   ADD: approved_at, updated_at — the source table has neither (no
--   escalation state to track since expense approval is single-step,
--   straight to ACCOUNTS_NUMBER/Sivaranjani, no "Manager Approved"
--   intermediate the way leave has). Added anyway for consistency with
--   every other approval-tracked table this session (bot_leave_requests,
--   bot_tasks, bot_payroll_records all have both).
--
-- Same adaptation pattern as bot_leave_requests: company_id -> tenant_id
-- (FK to bot_tenants), employee_id string -> real nullable FK to
-- bot_employees(id) with ON DELETE SET NULL, employee_name/
-- whatsapp_number kept denormalized.
--
-- Depends on bot_tenants and bot_employees (both from migration 006).
-- NOT executed yet — review before running against Railway.

CREATE TABLE IF NOT EXISTS bot_expense_claims (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(50) NOT NULL,
  employee_id INT,
  employee_name VARCHAR(200),
  whatsapp_number VARCHAR(20),
  expense_type VARCHAR(100),
  amount DECIMAL(10,2),
  expense_date DATE,
  description TEXT,
  receipt_url TEXT,
  status ENUM('Pending','Approved','Rejected') DEFAULT 'Pending',
  approved_by VARCHAR(200),
  approved_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_expense_tenant FOREIGN KEY (tenant_id) REFERENCES bot_tenants(tenant_id),
  CONSTRAINT fk_expense_employee FOREIGN KEY (employee_id) REFERENCES bot_employees(id)
    ON DELETE SET NULL
);
