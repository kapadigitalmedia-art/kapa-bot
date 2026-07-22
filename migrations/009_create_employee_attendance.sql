-- Purpose-built attendance table for the new multi-tenant model, matching
-- kapa-attendance-bot's live `attendance` table shape (pulled via DESCRIBE
-- against Railway, since that repo has no CREATE TABLE in source) but
-- adapted: company_id -> tenant_id (FK to bot_tenants), employee_id
-- string -> real FK to bot_employees(id).
--
-- Design decisions (reasoned through in chat, flagging both explicitly
-- since they're real choices, not copy-paste):
--   1. check_in_time/check_out_time/checkin_attempt_time use TIME, not the
--      source's VARCHAR(10). Source relies on a string comparison
--      (check_in_time < '08:30:00') that only works by zero-padding
--      convention; TIME makes that a real, type-safe comparison. Tradeoff:
--      mysql2 returns TIME as "HH:MM:SS", not the source's "HH:MM" — any
--      code reading this table needs a trivial format adjustment.
--   2. employee_id is nullable with ON DELETE SET NULL (not RESTRICT), so
--      attendance rows survive even a hard delete of the employee row —
--      per the requirement that employee_name/whatsapp_number remain as
--      historical record regardless. Note bot_employees already has
--      is_active for soft-deletion, so in the normal flow employees are
--      never hard-deleted anyway; this SET NULL only matters if that
--      convention is ever broken.
--
-- Same upsert-by-(tenant_id, employee_id, attendance_date) semantics as
-- the source's ON DUPLICATE KEY UPDATE pattern (one row per employee per
-- day) — enforced here via the UNIQUE KEY.
--
-- Depends on bot_tenants and bot_employees (both from migration 006).
-- NOT executed yet — review before running against Railway.

CREATE TABLE IF NOT EXISTS bot_employee_attendance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(50) NOT NULL,
  employee_id INT,
  employee_name VARCHAR(200),
  whatsapp_number VARCHAR(20),
  attendance_date DATE NOT NULL,
  check_in_time TIME,
  check_out_time TIME,
  check_in_latitude DECIMAL(10,6),
  check_in_longitude DECIMAL(10,6),
  check_out_latitude DECIMAL(10,6),
  check_out_longitude DECIMAL(10,6),
  attendance_status ENUM('Present','Absent','Late','On Leave') DEFAULT 'Absent',
  late_minutes INT DEFAULT 0,
  checkin_attempt_time TIME,
  checkin_attempt_lat DECIMAL(10,6),
  checkin_attempt_lng DECIMAL(10,6),
  checkin_fail_reason VARCHAR(255),
  remark TEXT,
  ot_minutes INT DEFAULT 0,
  ot_type VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_employee_date (tenant_id, employee_id, attendance_date),
  KEY idx_whatsapp_number (whatsapp_number),
  CONSTRAINT fk_attendance_tenant FOREIGN KEY (tenant_id) REFERENCES bot_tenants(tenant_id),
  CONSTRAINT fk_attendance_employee FOREIGN KEY (employee_id) REFERENCES bot_employees(id)
    ON DELETE SET NULL
);
