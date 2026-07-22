-- Replaces bot_approval_chains' uq_chain_step (again) to resolve the
-- step_order/cc_only ambiguity found while designing the late_reason
-- request type's dual-notification chain (Turai + Devandran both need
-- to fire at the SAME logical step, not sequentially).
--
-- THE PROBLEM THIS FIXES: the previous key (migration 013) was
-- (tenant_id, request_type, applies_to_subtype, applies_to_role,
-- step_order) — meaning only ONE row could exist per step_order at all.
-- A real approver (e.g. Turai, approver_type='requester_manager') and a
-- cc_only recipient meant to fire alongside it (e.g. Devandran,
-- approver_type='employee') could not share step_order=1, forcing an
-- ad-hoc, undocumented-in-the-data convention: give the cc row
-- step_order=2 and just remember that it actually means "same stage as
-- step 1, not a real second step." That convention lived only in
-- comments, not in anything the data itself could prove.
--
-- THE FIX: add approver_type/approver_role/approver_employee_id to the
-- key. Now Turai's row (approver_type='requester_manager') and
-- Devandran's row (approver_type='employee', approver_employee_id=X)
-- can legitimately BOTH carry step_order=1 — they're distinguished by
-- WHO the approver is, not by an artificial step-number offset. "These
-- fire together" is now self-evident from equal step_order values,
-- exactly as step_order was always meant to express.
--
-- RESIDUAL GAP, ACCEPTED NOT FIXED: two approver_type='requester_manager'
-- rows at the same (tenant, type, subtype, role, step) would still not
-- collide under this key — approver_role and approver_employee_id are
-- BOTH NULL for that approver_type (per chk_approver_fields), and MySQL
-- unique indexes treat every NULL as distinct from every other NULL, so
-- two rows with (NULL, NULL) in those columns don't count as duplicates.
-- Same class of issue already fixed once for applies_to_subtype via a
-- '*' sentinel — not repeated here because approver_role could take a
-- cheap VARCHAR sentinel, but approver_employee_id is a real FK'd INT
-- column; giving it a sentinel would need either a dummy placeholder row
-- in bot_employees or weakening the FK, neither worth it for a
-- duplicate-row shape (two identical "the requester's own manager" rows
-- at one step) nobody has a legitimate reason to create.
--
-- bot_approval_chains has 0 rows as of this migration — no backfill
-- concerns. NOT executed yet — review before running against Railway.

ALTER TABLE bot_approval_chains
  DROP INDEX uq_chain_step,
  ADD UNIQUE KEY uq_chain_step (
    tenant_id, request_type, applies_to_subtype, applies_to_role,
    step_order, approver_type, approver_role, approver_employee_id
  );
