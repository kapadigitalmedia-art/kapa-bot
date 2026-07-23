-- bot_foreign_worker_documents — tracks passport/visa/work permit
-- records per employee, with expiry-based reminder support
-- (reminder_sent_at). Two design questions were flagged for review
-- before this was written, both resolved against existing precedent in
-- this codebase rather than picked arbitrarily:
--
--   1. employee_id FK: ON DELETE SET NULL, not CASCADE. Every other
--      table in this schema that references bot_employees(id) as "whose
--      record is this" — bot_employee_attendance (009), bot_leave_requests
--      (010), bot_task_assignments (011), bot_payroll_records (012),
--      bot_expense_claims (018) — uses SET NULL, never CASCADE, because
--      employees are soft-deleted via is_active in normal operation
--      (SET NULL is a defensive fallback for if that convention is ever
--      broken, not the expected path). Compliance documents like these
--      are, if anything, a STRONGER case for retention after an
--      employee record is gone (labor/immigration audits may require
--      keeping them) than attendance or leave history is — so this
--      follows the same pattern, not an exception to it. employee_name
--      is added (denormalized, same as every SET NULL table above) so
--      an orphaned row still identifies whose document it was, rather
--      than becoming an anonymous document_number with nothing to tie
--      it back to.
--
--   2. status: NOT a stored column. Computed at read time instead —
--      CASE WHEN expiry_date < CURDATE() THEN 'expired'
--           WHEN expiry_date <= CURDATE() + INTERVAL 30 DAY THEN 'expiring_soon'
--           ELSE 'valid' END
--      A stored status enum derived from a date is exactly the failure
--      mode already sitting unfixed in this codebase: bot_trial_signups
--      (022) has a stored status column derived from trial_ends_at, and
--      as of this migration nothing anywhere ever updates it to
--      'expired' when that date passes — tenantResolution.js reads and
--      trusts a column nothing keeps in sync. reminder_sent_at already
--      requires a daily cron to evaluate expiry_date against today
--      anyway (to decide whether a reminder is due), so the "is this
--      expiring soon" computation happens regardless of whether status
--      is stored — storing it too just adds a second value that can
--      drift from expiry_date for no benefit. Left out of this schema;
--      the read-time CASE expression above is the recommended way to
--      surface it wherever this table is queried.
--
-- document_url is a placeholder for future file storage (S3/similar) —
-- NULL until that's built, not used by anything yet.
--
-- Depends on bot_tenants (006) and bot_employees (006). NOT executed
-- yet — review before running against Railway.

CREATE TABLE IF NOT EXISTS bot_foreign_worker_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(50) NOT NULL,
  employee_id INT,
  employee_name VARCHAR(200),
  document_type ENUM('passport','visa','work_permit') NOT NULL,
  document_number VARCHAR(100),
  issue_date DATE,
  expiry_date DATE NOT NULL,
  document_url TEXT,
  reminder_sent_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_fw_docs_tenant FOREIGN KEY (tenant_id) REFERENCES bot_tenants(tenant_id),
  CONSTRAINT fk_fw_docs_employee FOREIGN KEY (employee_id) REFERENCES bot_employees(id)
    ON DELETE SET NULL
);
