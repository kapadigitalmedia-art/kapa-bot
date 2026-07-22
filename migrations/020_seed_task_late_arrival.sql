-- Seeds the task_late_arrival notify-only chain: TWO rows, one per
-- manager, both approver_type='employee' at step_order=1.
--
-- WHY two employee rows instead of one approver_type='role' row: this
-- mirrors the source's actual behavior (index.js:3178,
-- `for (var m = 0; m < MANAGER_NUMBERS.length; m++)` — every manager
-- gets the late-arrival report, not just one). Our seeded org chart has
-- 2 people with role='manager' (Hafizh id=3, Ahmad Faisal id=4), which
-- is exactly the multi-employee-same-role case resolveApprover's
-- approver_type='role' branch was flagged as an untested placeholder
-- for — it resolves via `ORDER BY id LIMIT 1`, so using role='manager'
-- here would silently notify only Hafizh and drop Ahmad Faisal
-- entirely, under-notifying relative to the real source behavior.
--
-- Using two approver_type='employee' rows instead sidesteps that gap
-- cleanly: broadcastNotifyOnly already iterates every row at the
-- winning tier and resolves each independently (the same mechanism
-- already proven for the Devandran cc row on late_reason/office_staff),
-- so both managers are correctly notified without touching
-- resolveApprover at all.
--
-- This is a DELIBERATELY DEFERRED gap, not a fix: resolveApprover's
-- approver_type='role' branch remains untested/single-contact-only.
-- There is no GATED (approve/reject) use case yet that actually
-- requires role-based routing to multiple people, so designing real
-- multi-approver semantics for it (which also raises unresolved
-- questions about what "multiple people gating one approve/reject
-- decision" should even mean) is left for when such a case exists.
--
-- NOT executed yet — review before running against Railway.

INSERT INTO bot_approval_chains (tenant_id, request_type, applies_to_subtype, applies_to_role, step_order, approver_type, approver_employee_id, cc_only)
VALUES
  ('kapa', 'task_late_arrival', '*', '*', 1, 'employee', 3, FALSE),  -- Hafizh
  ('kapa', 'task_late_arrival', '*', '*', 1, 'employee', 4, FALSE);  -- Ahmad Faisal
