-- Generic approval-workflow progress tracker, across leave/expense/
-- payroll_adjustment/etc. (any GATED request_type — see
-- config/requestTypes.js's isGatedRequestType). Designed in conversation
-- alongside the button-ID scheme and resolveTier()/resolveApprover(),
-- never previously migrated.
--
-- One row per (tenant_id, request_type, record_id) — a single approval
-- workflow instance. current_chain_id (not just current_step_order)
-- pins the exact bot_approval_chains row currently awaiting action:
-- step_order alone isn't globally unique (different subtype/role tiers
-- can both define step_order=1), and at reply time a button's chain_id
-- must match this column exactly — a mismatch means the button is stale
-- (superseded by a later step) rather than a signal to trust blindly.
--
-- status only distinguishes 'in_progress' vs 'completed' — a REJECTION
-- at any step also sets 'completed' (the workflow has no more steps to
-- run, regardless of outcome). The actual decision (Approved/Rejected/
-- Manager Approved) lives on the underlying request table (e.g.
-- bot_leave_requests.approval_status), not here.
--
-- NOT used for notify-only request types (e.g. late_reason) — those
-- resolve and complete synchronously in one pass with no progress row
-- at all.
--
-- Depends on bot_tenants (006) and bot_approval_chains (006, altered in
-- 013/014). NOT executed yet — review before running against Railway.

CREATE TABLE IF NOT EXISTS bot_approval_progress (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(50) NOT NULL,
  request_type VARCHAR(30) NOT NULL,
  record_id INT NOT NULL,
  current_step_order INT NOT NULL,
  current_chain_id INT NOT NULL,
  status ENUM('in_progress','completed') DEFAULT 'in_progress',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_progress (tenant_id, request_type, record_id),
  CONSTRAINT fk_progress_tenant FOREIGN KEY (tenant_id) REFERENCES bot_tenants(tenant_id),
  CONSTRAINT fk_progress_chain FOREIGN KEY (current_chain_id) REFERENCES bot_approval_chains(id)
);
