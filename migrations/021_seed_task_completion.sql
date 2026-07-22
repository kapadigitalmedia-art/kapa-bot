-- Seeds the task_completion chain: TWO rows, one per manager, both
-- approver_type='employee' at step_order=1 — the same multi-manager
-- pattern as task_late_arrival (migration 020), but GATED this time
-- instead of notify-only: this is a real approve/reject decision, not
-- pure FYI fan-out.
--
-- First-responder-wins: whichever manager taps Approve or Reject first
-- resolves the request; the other manager's tap on the now-stale button
-- correctly hits "already resolved" via the compare-and-swap guard
-- added to advanceApprovalProgress/completeApprovalProgress (both now
-- conditional on status='in_progress' AND current_step_order matching
-- the caller's own read, so only the first write actually lands).
--
-- This mirrors the source's handleManagerApprove (index.js:1800) —
-- MANAGER_NUMBERS all get sent a review request, and whichever manager
-- taps "Approve" first wins, deleting the task session so a second
-- manager's tap hits "Task session expired." Our version reproduces
-- that same first-tap-wins behavior, but with two things the source
-- never had: (1) a server-side check that the replying number is
-- actually one of the two seeded managers (source's button handler
-- trusts the embedded techNumber/taskId from the button payload with no
-- authorization check on managerNumber at all), and (2) an actual
-- concurrency guard — the source's "session expired" behavior only
-- worked by accident (deleting sessions["task_" + techNumber] is itself
-- unguarded, so two simultaneous taps could both read the session
-- before either delete lands and both fire the customer-notification
-- send twice); ours uses a real atomic UPDATE ... WHERE status =
-- 'in_progress' AND current_step_order = ? so only one concurrent reply
-- can ever win.
--
-- NOT executed yet — review before running against Railway.

INSERT INTO bot_approval_chains (tenant_id, request_type, applies_to_subtype, applies_to_role, step_order, approver_type, approver_employee_id, cc_only)
VALUES
  ('kapa', 'task_completion', '*', '*', 1, 'employee', 3, FALSE),  -- Hafizh
  ('kapa', 'task_completion', '*', '*', 1, 'employee', 4, FALSE);  -- Ahmad Faisal
