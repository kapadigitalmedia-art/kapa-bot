-- Purpose-built leave requests table for the new multi-tenant model,
-- matching kapa-attendance-bot's live `leave_requests` table shape
-- (pulled via DESCRIBE against Railway, since that repo has no CREATE
-- TABLE in source) — same adaptation pattern as bot_employee_attendance
-- (migration 009): company_id -> tenant_id (FK to bot_tenants),
-- employee_id string -> real nullable FK to bot_employees(id) with
-- ON DELETE SET NULL, employee_name/whatsapp_number kept denormalized.
--
-- Deliberately DEFERRED, not solved here:
--   - approval_status keeps the source's exact ENUM
--     ('Pending','Manager Approved','Approved','Rejected') as-is. This
--     already encodes a partial approval-chain state (the "Manager
--     Approved" step before final HR/Turai approval), which really
--     overlaps with what bot_approval_chains (migration 006) models as
--     routing — reconciling the two is a later task, not this one.
--   - first_approver stays a plain denormalized whatsapp_number
--     VARCHAR(20), not a proper FK into bot_employees or a reference
--     into bot_approval_chains. Same reasoning: full chain integration
--     is deferred.
--
-- Depends on bot_tenants and bot_employees (both from migration 006).
-- NOT executed yet — review before running against Railway.

CREATE TABLE IF NOT EXISTS bot_leave_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(50) NOT NULL,
  employee_id INT,
  employee_name VARCHAR(200),
  whatsapp_number VARCHAR(20),
  leave_type VARCHAR(50),
  start_date DATE,
  end_date DATE,
  total_days INT DEFAULT 1,
  reason TEXT,
  approval_status ENUM('Pending','Manager Approved','Approved','Rejected') DEFAULT 'Pending',
  approved_by VARCHAR(200),
  approved_at TIMESTAMP NULL,
  first_approver VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_leave_tenant FOREIGN KEY (tenant_id) REFERENCES bot_tenants(tenant_id),
  CONSTRAINT fk_leave_employee FOREIGN KEY (employee_id) REFERENCES bot_employees(id)
    ON DELETE SET NULL
);
