-- Adds password_hash to bot_employees, for dashboard/Hub login access.
--
-- Nullable, not NOT NULL: most bot_employees rows (technicians/staff
-- who only ever interact via WhatsApp check-in/leave/etc., and every
-- trial signup's auto-created 'owner' row from createTrialSignup) never
-- need a password at all — only accounts that actually need dashboard/
-- Hub login get one set explicitly, on their own timeline, not at
-- employee-creation time. A NOT NULL column would force a password onto
-- every existing seeded employee (Asia Avid's 12, every trial signup's
-- owner row) immediately, none of which currently have or need one.
--
-- Existing rows: bcrypt is one-way — there is no valid hash to backfill
-- with, so NULL is the only correct value for every row that exists
-- today. This is a genuine "no password set yet" state, not a data gap
-- to fix later.
--
-- NOT executed yet — review before running against Railway.

ALTER TABLE bot_employees ADD COLUMN password_hash VARCHAR(255) NULL;
