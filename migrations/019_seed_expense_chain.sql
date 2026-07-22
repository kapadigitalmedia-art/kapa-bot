-- Seeds the single-step expense approval chain, matching source's
-- ACCOUNTS_NUMBER pattern (sendAccountsApproval, handleExpenseApproval)
-- verified earlier this session: expense approval has no escalation at
-- all, straight to one hardcoded recipient — Sivaranjani, who is both
-- ACCOUNTS_NUMBER and the 'Sivaranjani' office_staff employee (same
-- person, same number, per source: "601165098787" appears as both
-- ACCOUNTS_NUMBER and SIVARANJANI's entry in LATE_REASON_MANAGER).
--
-- Sivaranjani's real bot_employees.id (7) confirmed via live query
-- before writing this, not assumed from the earlier org-chart seed
-- summary.
--
-- generic ('*'/'*') tier — expense has no subtype dimension (no
-- Emergency-Leave-style variant) and no role-specific override; every
-- requester's expense claim resolves to this one row regardless of role.
--
-- NOT executed yet — review before running against Railway.

INSERT INTO bot_approval_chains (tenant_id, request_type, applies_to_subtype, applies_to_role, step_order, approver_type, approver_employee_id, cc_only)
VALUES ('kapa', 'expense', '*', '*', 1, 'employee', 7, FALSE);
