// Verified against kapa-attendance-bot/index.js's actual approval flows
// (sendHRApproval/handleLeaveApproval/handleDuraiLeaveApproval,
// sendAccountsApproval/handleExpenseApproval, sendAdjustmentApprovalRequest,
// sendOTApprovalRequest, quotation approval around QUOTATION_APPROVER,
// handleManagerApprove) — not a guessed list.
//
// NOTE: quotation's approval flow has a third action (quote_feedback_ —
// "give feedback"/request changes) beyond approve/reject. bot_approval_chains'
// current schema (approver_type / cc_only) doesn't yet model a "request
// changes" outcome distinct from reject — this will need a schema addition
// when quotation routing is actually implemented against this table.
// late_reason is a notify-only broadcast — there is no approval/rejection
// concept at all (nobody approves or rejects a late-checkin reason, it's
// pure FYI fan-out to the requester's manager). This is distinct from
// every other type in this list, which all gate on an approve/reject
// decision.
const REQUEST_TYPES = {
  leave:              { gated: true },
  expense:            { gated: true },
  payroll_adjustment: { gated: true },
  overtime:           { gated: true },
  quotation:          { gated: true },
  task_completion:    { gated: true },
  late_reason:        { gated: false },
  // notify-only, technician arrives late to a task - broadcasts to ALL
  // employees with role='manager', distinct from late_reason (which
  // routes per-employee via requester_manager)
  task_late_arrival:  { gated: false },
};
const VALID_REQUEST_TYPES = Object.keys(REQUEST_TYPES);

function isValidRequestType(type) {
  return VALID_REQUEST_TYPES.includes(type);
}

function isGatedRequestType(type) {
  return !!(REQUEST_TYPES[type] && REQUEST_TYPES[type].gated);
}

module.exports = { VALID_REQUEST_TYPES, isValidRequestType, isGatedRequestType, REQUEST_TYPES };
