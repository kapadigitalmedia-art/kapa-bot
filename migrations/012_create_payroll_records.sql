-- Payroll records table for the new multi-tenant model, matching
-- kapa-attendance-bot's live `payroll` table shape (pulled via DESCRIBE
-- against Railway, since that repo has no CREATE TABLE in source) with
-- two fixes, not a straight port:
--
--   1. FIX: working_days/present_days/absent_days will actually be
--      populated. The source table has these columns (all DEFAULT 0)
--      and calculatePayroll() computes all three, but createPayrollRecord()
--      never includes them in the INSERT — every real payroll record in
--      production has all three silently stuck at 0 regardless of actual
--      attendance.
--
--   2. ADD: gross_salary, late_minutes — calculatePayroll() computes both
--      but the source table has no column for either, so they're
--      discarded the moment the WhatsApp message displaying them is sent.
--
-- Same adaptation pattern as bot_employee_attendance/bot_leave_requests/
-- bot_tasks: company_id -> tenant_id (FK to bot_tenants), employee_id
-- string -> real nullable FK to bot_employees(id) with ON DELETE SET
-- NULL, employee_name/whatsapp_number kept denormalized.
--
-- DELIBERATE DECISION, CONFIRMED — NOT AN OVERSIGHT: this table
-- hardcodes MY-specific column names (epf_employee, socso, eis, etc.)
-- even though bot_statutory_components/bot_statutory_brackets
-- (migration 006) are built to support arbitrary countries with
-- different component sets. A non-MY tenant using different statutory
-- components (e.g. Singapore's CPF) would have nowhere to store them
-- under this schema as it stands today. Explicitly accepted as
-- "correct for today, revisit when country #2 is onboarded" — the
-- calculation side (calculatePayroll's port) stays fully country-
-- configurable via bot_statutory_components/brackets regardless of this
-- storage limitation; only the write-to-bot_payroll_records mapping step
-- is MY-specific. Revisit this table's shape (or add a generic
-- key/value contributions table alongside it) when a second country is
-- actually onboarded, not before — see the pseudocode discussion for how
-- country-configurable even though storage here does not yet.
--
-- Depends on bot_tenants and bot_employees (both from migration 006).
-- NOT executed yet — review before running against Railway.

CREATE TABLE IF NOT EXISTS bot_payroll_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(50) NOT NULL,
  employee_id INT,
  employee_name VARCHAR(200),
  whatsapp_number VARCHAR(20),
  month VARCHAR(10),
  year INT,
  basic_salary DECIMAL(10,2) DEFAULT 0.00,
  allowance DECIMAL(10,2) DEFAULT 0.00,
  overtime DECIMAL(10,2) DEFAULT 0.00,
  deductions DECIMAL(10,2) DEFAULT 0.00,
  epf_employee DECIMAL(10,2) DEFAULT 0.00,
  epf_employer DECIMAL(10,2) DEFAULT 0.00,
  socso DECIMAL(10,2) DEFAULT 0.00,
  socso_employer DECIMAL(10,2) DEFAULT 0.00,
  eis DECIMAL(10,2) DEFAULT 0.00,
  eis_employer DECIMAL(10,2) DEFAULT 0.00,
  net_salary DECIMAL(10,2) DEFAULT 0.00,
  gross_salary DECIMAL(10,2) DEFAULT 0.00,
  late_minutes INT DEFAULT 0,
  working_days INT DEFAULT 0,
  present_days INT DEFAULT 0,
  absent_days INT DEFAULT 0,
  status ENUM('Draft','Approved','Paid') DEFAULT 'Draft',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_payroll_tenant FOREIGN KEY (tenant_id) REFERENCES bot_tenants(tenant_id),
  CONSTRAINT fk_payroll_employee FOREIGN KEY (employee_id) REFERENCES bot_employees(id)
    ON DELETE SET NULL
);
