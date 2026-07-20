-- Seeds the 'kapa' tenant row into bot_companies before any other bot_*
-- table can accept an insert (they all FK to bot_companies.tenant_id).
--
-- 'kapa' is Kapa Technologies' own business number (config/tenants.js
-- TENANTS[0].officeNumber), not a trial customer — plan is set to 'paid'
-- with no trial_ends_at.
--
-- NOT executed yet — review together with 001 before running against the
-- live database.

INSERT INTO bot_companies (tenant_id, name, whatsapp_number, plan, trial_ends_at)
VALUES ('kapa', 'Kapa Technologies', '917550008031', 'paid', NULL);
