-- Adds requester_employee_id to bot_approval_progress (016). Discovered
-- necessary while implementing services/approvalEngine.js: handleApprovalReply
-- needs the requester's bot_employees row to call resolveApprover() when
-- advancing to a next step (requester_manager resolution) and to
-- re-verify the replying number is actually authorized — but nothing in
-- the engine's function signatures (sendButtonsFn/sendInfoFn/
-- updateStatusFn are all generic/injected specifically to avoid
-- hardcoding a request-type's table) provides a way to fetch it.
--
-- Fix: capture it once at creation time — startApprovalFlow already
-- receives requesterEmployee as a parameter — so handleApprovalReply can
-- look it up directly via a plain bot_employees query, with no new
-- injected function parameter needed.
--
-- bot_approval_progress has 0 rows as of this migration (016 was just
-- created) — no backfill concerns. NOT executed yet — review before
-- running against Railway.

ALTER TABLE bot_approval_progress
  ADD COLUMN requester_employee_id INT NOT NULL AFTER record_id,
  ADD CONSTRAINT fk_progress_requester FOREIGN KEY (requester_employee_id) REFERENCES bot_employees(id);
