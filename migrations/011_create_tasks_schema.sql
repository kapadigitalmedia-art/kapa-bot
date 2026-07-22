-- Task management schema for the new multi-tenant model, matching
-- kapa-attendance-bot's live `tasks` table shape (pulled via DESCRIBE
-- against Railway, since that repo has no CREATE TABLE in source) with
-- two deliberate fixes, not a straight port:
--
--   1. assigned_staff_id/name/whatsapp + assigned_staff2_id/name/whatsapp
--      are REMOVED entirely. The source's two-fixed-slot design caps
--      assignment at exactly 2 people and duplicates employee data
--      inline instead of referencing bot_employees. Replaced by
--      bot_task_assignments below — an unbounded join table.
--
--   2. Four columns are ADDED that the source silently has nowhere to
--      put: end_time, completion_notes, completion_time,
--      manager_approved_by. kapa-attendance-bot's handleManagerApprove
--      already tries to pass this exact data into updateTaskStatus
--      today, but db.js's field whitelist there only persists
--      work_photo_url/work_summary/rework_reason/customer_notified/
--      ai_summary — none of these four exist as columns in the real
--      tasks table, so that completion metadata is discarded on every
--      call, not just occasionally. Adding them here actually captures
--      it going forward instead of reproducing the same silent gap.
--
-- Depends on bot_tenants and bot_employees (both from migration 006).
-- NOT executed yet — review before running against Railway.

CREATE TABLE IF NOT EXISTS bot_tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(50) NOT NULL,
  task_name VARCHAR(255),
  customer_name VARCHAR(200),
  customer_whatsapp VARCHAR(20),
  customer_address TEXT,
  customer_lat DECIMAL(10,6),
  customer_lng DECIMAL(10,6),
  date_field DATE,
  appointment_time VARCHAR(10),
  status ENUM('Pending','Accepted','In Progress','Completed','Cancelled','Rework') DEFAULT 'Pending',
  work_photo_url TEXT,
  work_summary TEXT,
  rework_reason TEXT,
  customer_notified ENUM('Yes','No') DEFAULT 'No',
  overdue_notified TINYINT(1) DEFAULT 0,
  ai_summary TEXT,
  end_time TIME,
  completion_notes TEXT,
  completion_time TIMESTAMP NULL,
  manager_approved_by VARCHAR(200),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_task_tenant FOREIGN KEY (tenant_id) REFERENCES bot_tenants(tenant_id)
);

-- Unbounded replacement for the source's fixed staff/staff2 slots.
-- task_id uses ON DELETE CASCADE (an assignment row has no meaning once
-- its task is gone); employee_id uses ON DELETE SET NULL, same
-- historical-record pattern as bot_employee_attendance/bot_leave_requests
-- (a deleted employee's past assignments stay visible, just unlinked).
-- UNIQUE KEY prevents the same employee being assigned twice to the same
-- task, without capping how many distinct employees a task can have.
CREATE TABLE IF NOT EXISTS bot_task_assignments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT NOT NULL,
  employee_id INT,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_task_employee (task_id, employee_id),
  CONSTRAINT fk_assignment_task FOREIGN KEY (task_id) REFERENCES bot_tasks(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_assignment_employee FOREIGN KEY (employee_id) REFERENCES bot_employees(id)
    ON DELETE SET NULL
);
