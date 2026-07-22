-- Seeds Asia Avid's real 12-person org chart into bot_employees, plus
-- the 'leave' and 'late_reason' bot_approval_chains rows that reproduce
-- kapa-attendance-bot's actual verified behavior for both.
--
-- SOURCES: LATE_REASON_MANAGER (index.js:140-150), MANAGER_NUMBERS
-- (:127), DIRECTOR_NUMBER (:128), NO_GEOFENCE_NUMBERS/NO_GEOFENCE_STAFF
-- (:213-218, full names taken from here), the 9:30 AM attendance-alert
-- cron (~:3569-3600, confirms Turai+Devandran get the full absentee
-- list while Hafizh/Ahmad Faisal each get only their own team's —
-- corroborates a manager tier below a director tier), and the traced
-- handleLeaveApproval/handleDuraiLeaveApproval control flow from
-- earlier in this session.
--
-- HAFIZH'S REPORTING LINE IS INFERRED, NOT EXPLICIT: no source map
-- entry states "Hafizh reports to Turai" the way Ahmad Faisal's entry
-- explicitly does ("601128618935": "60132075856"). This is inferred
-- from: (1) MANAGER_NUMBERS groups Hafizh with Ahmad Faisal as peers,
-- and Ahmad Faisal explicitly reports to Turai; (2) the attendance cron
-- gives Hafizh a team-scoped report (just Selvan) while Turai/Devandran
-- get the full-company view — placing Hafizh at the same organizational
-- tier as Ahmad Faisal, below the two directors. Flagging this as
-- inference per explicit instruction to verify rather than assume.
--
-- geofence_exempt is set from NO_GEOFENCE_NUMBERS (verified source data,
-- not a guess) — Turai, Devandran, Hafizh, Ahmad Faisal, and Lob Mahadir
-- (his number appears in NO_GEOFENCE_NUMBERS even though his name isn't
-- in the separate NO_GEOFENCE_STAFF name list — the source code checks
-- both lists with OR, so either is sufficient).
--
-- Explicit ids 1-12 assigned in dependency order (managers/directors
-- before their reports) since reports_to_employee_id is a self-FK.
-- bot_employees is empty as of this migration — no collision risk.

INSERT INTO bot_employees
  (id, tenant_id, full_name, whatsapp_number, role, reports_to_employee_id, geofence_exempt) VALUES
(1,  'kapa', 'Turai Raja @ Durai Raj Pulakrishnan', '60132075856',  'director',    NULL, TRUE),
(2,  'kapa', 'Devandran Kamela Kumaran',            '60122879403',  'director',    NULL, TRUE),
(3,  'kapa', 'Hafizh Mateen Bin Azizan',            '60164944240',  'manager',     1,    TRUE),
(4,  'kapa', 'Ahmad Faisal Bin Mohd Taha',          '601128618935', 'manager',     1,    TRUE),
(5,  'kapa', 'Lob Mahadir',                         '60166299272',  'office_staff',1,    TRUE),
(6,  'kapa', 'Sharifah',                            '60108090831',  'office_staff',1,    FALSE),
(7,  'kapa', 'Sivaranjani',                         '601165098787', 'office_staff',1,    FALSE),
(8,  'kapa', 'Selvan',                              '60162359365',  'technician',  3,    FALSE),
(9,  'kapa', 'Thinesshvaran',                       '601133379567', 'technician',  4,    FALSE),
(10, 'kapa', 'Thaneshwaran',                        '601166190711', 'technician',  4,    FALSE),
(11, 'kapa', 'Kumar',                               '601163982116', 'technician',  4,    FALSE),
(12, 'kapa', 'Tinaakaran',                          '601121250577', 'technician',  4,    FALSE);

-- ── LEAVE APPROVAL CHAINS ────────────────────────────────────────────────
-- REQUIRED RESOLUTION-ORDER CONVENTION (for whoever builds the runtime
-- resolver — not automatically implied by the schema, must be
-- implemented): most-specific match wins, falling back in this order:
--   1. (applies_to_role = requester's role, applies_to_subtype = request's subtype)
--   2. (applies_to_role = requester's role, applies_to_subtype = '*')
--   3. (applies_to_role = '*',            applies_to_subtype = request's subtype)
--   4. (applies_to_role = '*',            applies_to_subtype = '*')
--
-- Generic default (technicians, and anyone else without a role-specific
-- override): 2-step — requester's own manager first, then Turai (id=1)
-- for final approval. Matches Selvan (Hafizh->Turai) and the 4
-- Ahmad-Faisal reports (Ahmad Faisal->Turai) identically.
INSERT INTO bot_approval_chains
  (tenant_id, request_type, applies_to_subtype, applies_to_role, step_order, approver_type, approver_employee_id, cc_only) VALUES
('kapa', 'leave', '*', '*', 1, 'requester_manager', NULL, FALSE),
('kapa', 'leave', '*', '*', 2, 'employee', 1, FALSE);

-- Emergency Leave subtype override (generic role scope only): the
-- manager's approval is final, no escalation to Turai. Source: inside
-- handleLeaveApproval's isFA && !isDurai && Approved branch, leaveType
-- === "Emergency Leave" short-circuits straight to Approved.
--
-- CRITICAL FOR WHOEVER BUILDS THE RESOLVER: this must match against the
-- ORIGINAL requested leave type ("Emergency Leave"), not
-- bot_leave_requests.leave_type — the port's createLeaveRequest (like
-- the source) remaps Emergency Leave to "Unpaid Leave" before storing,
-- so the persisted column never actually contains the string
-- "Emergency Leave". The subtype match has to happen against whatever
-- the request flow holds before that remap, not the stored row.
INSERT INTO bot_approval_chains
  (tenant_id, request_type, applies_to_subtype, applies_to_role, step_order, approver_type, cc_only) VALUES
('kapa', 'leave', 'Emergency Leave', '*', 1, 'requester_manager', FALSE);

-- office_staff override (Lob/Sharifah/Sivaranjani): single-step,
-- regardless of subtype — their requester_manager already resolves to
-- Turai directly (reports_to_employee_id=1), so there is no distinct
-- "final approver" to escalate to. No Emergency Leave override needed
-- here since the single step already applies uniformly.
INSERT INTO bot_approval_chains
  (tenant_id, request_type, applies_to_subtype, applies_to_role, step_order, approver_type, cc_only) VALUES
('kapa', 'leave', '*', 'office_staff', 1, 'requester_manager', FALSE);

-- ── LATE_REASON CHAINS (notify-only, no approval concept) ───────────────
-- Generic default: notify the requester's own manager. Covers all 4
-- Ahmad-Faisal technicians and Selvan (single-string LATE_REASON_MANAGER
-- values in source) identically via reports_to_employee_id.
INSERT INTO bot_approval_chains
  (tenant_id, request_type, applies_to_subtype, applies_to_role, step_order, approver_type, cc_only) VALUES
('kapa', 'late_reason', '*', '*', 1, 'requester_manager', FALSE);

-- office_staff override (Lob/Sharifah/Sivaranjani): BOTH rows share
-- step_order=1 — this is the exact case migration 014's key change was
-- built for. Turai (via requester_manager) and Devandran (id=2, cc_only)
-- fire together, reproducing the source's 2-element
-- LATE_REASON_MANAGER array for these 3 employees with full fidelity
-- (unlike getLeaveFirstApprover's mgr[0]-only truncation, which is why
-- this dual-notification belongs to late_reason, not leave).
INSERT INTO bot_approval_chains
  (tenant_id, request_type, applies_to_subtype, applies_to_role, step_order, approver_type, cc_only) VALUES
('kapa', 'late_reason', '*', 'office_staff', 1, 'requester_manager', FALSE);
INSERT INTO bot_approval_chains
  (tenant_id, request_type, applies_to_subtype, applies_to_role, step_order, approver_type, approver_employee_id, cc_only) VALUES
('kapa', 'late_reason', '*', 'office_staff', 1, 'employee', 2, TRUE);
