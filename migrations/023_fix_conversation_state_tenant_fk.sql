-- Fixes bot_conversation_state's FK, which points at the WRONG tenant
-- table — a real bug found via an end-to-end trial-signup test, not a
-- deliberate design.
--
-- ── How this drift happened ──────────────────────────────────────────────
-- bot_companies (migration 001, seeded 002) was this project's ORIGINAL
-- tenant table, created before any of the org-chart/approval-engine
-- schema existed. It backs bot_attendance, bot_leads, bot_errors,
-- bot_subscription_events, and bot_conversation_state.
--
-- bot_tenants (migration 006 onward) was introduced later, when the org
-- chart / approval-engine system was built, and has backed EVERY table
-- built since: bot_employees, bot_approval_chains, bot_leave_requests,
-- bot_tasks, bot_payroll_records, bot_approval_progress,
-- bot_expense_claims, bot_trial_signups. Migration 006 seeded 'kapa' into
-- bot_tenants without migrating bot_conversation_state's FK across too —
-- there's no comment anywhere explaining an intentional two-registry
-- design, and 'kapa' having a matching row in BOTH tables masked the gap
-- ever since: every new tenant_id needed a row in both tables to work
-- end-to-end, but nothing since migration 006 ever wrote to bot_companies.
--
-- This surfaced for real when a trial signup (services/db-mysql.js's
-- createTrialSignup, which only inserts into bot_tenants, matching every
-- other create* function written since migration 006) tried to check in:
-- setConvState's INSERT into bot_conversation_state hit this FK and
-- failed (no bot_companies row for the new tenant_id), silently fell
-- back to the lowdb store, and the subsequent location-share read never
-- found that lowdb-stored state (a SEPARATE bug in routes/webhook.js's
-- getConvState/setConvState fallback asymmetry — flagged with its own
-- TODO/FIXME comment there, fixed in its own turn, not here) — so the
-- check-in silently never completed.
--
-- ── What this migration does ─────────────────────────────────────────────
-- Repoints bot_conversation_state's FK from bot_companies(tenant_id) to
-- bot_tenants(tenant_id) — the actually-authoritative, actively-written
-- tenant table going forward. bot_companies remains the correct FK target
-- for bot_attendance/bot_leads/bot_errors/bot_subscription_events
-- (UNCHANGED here, deliberately) — those four are vestigial/not live in
-- the current WhatsApp conversation flow (bot_attendance in particular is
-- superseded by bot_employee_attendance; routes/attendance.js's own
-- header comment claiming it's "called by the webhook handler" is stale
-- documentation, not current behavior), so there's no case for touching
-- their FK today. bot_conversation_state is the one table in the
-- bot_companies group that IS still genuinely live (every multi-step
-- webhook conversation depends on it), which is exactly why it's the one
-- that needs to move.
--
-- Verified safe against current data before writing this: the only
-- distinct tenant_id in bot_conversation_state today is 'kapa', and
-- 'kapa' already has a row in bot_tenants (seeded by migration 006) — so
-- dropping and re-adding this FK produces zero orphaned rows.
--
-- NOT executed yet — review before running against Railway.

ALTER TABLE bot_conversation_state
  DROP FOREIGN KEY fk_bot_convstate_tenant;

ALTER TABLE bot_conversation_state
  ADD CONSTRAINT fk_bot_convstate_tenant FOREIGN KEY (tenant_id) REFERENCES bot_tenants(tenant_id);
