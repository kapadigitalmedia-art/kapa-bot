-- Adds applies_to_subtype to bot_approval_chains (created in migration
-- 006). ALREADY APPLIED against Railway — this file documents what ran,
-- it is not pending.
--
-- WHY: reviewing kapa-attendance-bot's real leave-approval logic
-- (handleLeaveApproval) surfaced a case bot_approval_chains couldn't yet
-- express — Emergency Leave skips the second approval step (Durai/HR)
-- entirely once the first approver (manager) approves it, while every
-- other leave type requires both steps ("Manager Approved" -> Durai
-- final approval). request_type='leave' alone can't distinguish this;
-- the chain needs to vary by the REQUEST'S SUBTYPE (leave_type =
-- "Emergency Leave" vs anything else), not just its type or the
-- requester's role. applies_to_subtype is that dimension — NULL/generic
-- default ('*') applies to all subtypes of a request_type; a specific
-- value (e.g. 'Emergency Leave') overrides it for that subtype only.
--
-- WHY '*' AND NOT NULL: the existing UNIQUE KEY uq_chain_step already
-- used applies_to_role='*' as its "matches everything" sentinel rather
-- than NULL, for a specific reason — MySQL unique indexes treat every
-- NULL as distinct from every other NULL, so a NULL-default column
-- provides NO protection against duplicate generic chains (two rows
-- with tenant_id='kapa', request_type='leave', applies_to_subtype=NULL,
-- applies_to_role='*', step_order=1 could both be inserted, and the
-- unique key would silently allow it). Reusing '*' as the sentinel for
-- applies_to_subtype avoids that landmine the same way applies_to_role
-- already does, and keeps one consistent "wildcard means no
-- restriction on this dimension" convention across both columns instead
-- of introducing a second, different-looking sentinel style.
--
-- Verified against the live table via DESCRIBE bot_approval_chains after
-- running — this file's DDL matches the actual applied schema exactly.

ALTER TABLE bot_approval_chains
  ADD COLUMN applies_to_subtype VARCHAR(50) NOT NULL DEFAULT '*' AFTER applies_to_role,
  DROP INDEX uq_chain_step,
  ADD UNIQUE KEY uq_chain_step (tenant_id, request_type, applies_to_subtype, applies_to_role, step_order);
