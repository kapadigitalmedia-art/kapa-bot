// Orchestration for the generic approval-chain system — calls multiple
// services/db-mysql.js functions to decide what to do, but isn't a data
// access module itself, so it lives separately from db-mysql.js.
//
// sendButtonsFn/sendInfoFn/updateStatusFn are all injected rather than
// imported directly (e.g. from services/whatsapp.js) so this file has no
// hard dependency on a real WhatsApp client and can be tested with plain
// stub functions.

const {
  resolveTier,
  resolveApprover,
  getChainRowById,
  getEmployeeById,
  getNextStepRows,
  createApprovalProgress,
  getApprovalProgress,
  advanceApprovalProgress,
  completeApprovalProgress,
} = require('./db-mysql');
const { isGatedRequestType } = require('../config/requestTypes');

const BUTTON_ID_PATTERN = /^(approve|reject)_(.+)_(\d+)_(\d+)$/;

function cleanNumber(n) {
  return String(n || '').replace(/[\s+-]/g, '');
}

function buttonIds(requestType, recordId, chainRowId) {
  return {
    approve: `approve_${requestType}_${recordId}_${chainRowId}`,
    reject: `reject_${requestType}_${recordId}_${chainRowId}`,
  };
}

/**
 * Notify-only broadcast for non-gated request types (e.g. late_reason,
 * task_late_arrival) — no approval/rejection concept, no
 * bot_approval_progress row, resolves and completes synchronously in
 * one pass. Every row at the winning tier's first step_order is a
 * notification target; cc_only is meaningless here (there's no "real
 * approver" for a cc to be distinct from), so true/false rows are
 * treated identically.
 *
 * getSummaryFn is called as (tenantId, requestType) — NOT the 3-arg
 * (tenantId, requestType, recordId) shape gated types' summary
 * functions use. Notify-only types have no persisted record (confirmed
 * for late_reason: the source's late-checkin-reason flow is purely
 * session-based, never written to any table), so there's no recordId
 * to look up — the caller's getSummaryFn must already have whatever
 * context it needs (employee name, reason text, etc.) closed over.
 */
async function broadcastNotifyOnly(tenantId, requestType, requester, role, sendInfoFn, getSummaryFn) {
  const rows = await resolveTier(tenantId, requestType, null, role);
  if (!rows.length) return;

  const firstStepOrder = Math.min(...rows.map((r) => r.step_order));
  const targetRows = rows.filter((r) => r.step_order === firstStepOrder);

  const summaryText = await getSummaryFn(tenantId, requestType);

  for (const row of targetRows) {
    const contact = await resolveApprover(row, requester);
    if (contact) await sendInfoFn(contact, summaryText);
  }
}

/**
 * Kicks off (or, for notify-only types, delegates to
 * broadcastNotifyOnly for) an approval workflow for a freshly-created
 * request record.
 *
 * subtype should be null/undefined for request types with no subtype
 * concept (e.g. late_reason) — resolveTier treats that as "no
 * preference" and matches on role alone.
 *
 * getRequestSummaryFn(tenantId, requestType, recordId) replaces the
 * earlier static contextText parameter for GATED types — it's called
 * once here and again in handleApprovalReply when escalating to a next
 * step, so both messages are generated from the same source instead of
 * the initial message being static text and the escalation message
 * being a different, independently-built string that could drift out
 * of sync. For non-gated types, the same parameter is passed straight
 * through to broadcastNotifyOnly, which calls it with a different
 * (2-arg) shape — see that function's own comment.
 *
 * For GATED types with no configured chain at all (resolveTier returns
 * empty, or the winning tier has no non-cc approver row — a
 * misconfigured chain), this silently does nothing rather than
 * throwing. That's a real gap worth surfacing operationally (nobody
 * gets asked to approve anything), not something papered over here.
 */
async function startApprovalFlow(
  tenantId,
  requestType,
  recordId,
  requesterEmployee,
  subtype,
  sendButtonsFn,
  sendInfoFn,
  getRequestSummaryFn
) {
  if (!isGatedRequestType(requestType)) {
    return broadcastNotifyOnly(tenantId, requestType, requesterEmployee, requesterEmployee.role, sendInfoFn, getRequestSummaryFn);
  }

  const summaryText = await getRequestSummaryFn(tenantId, requestType, recordId);

  const rows = await resolveTier(tenantId, requestType, subtype, requesterEmployee.role);
  if (!rows.length) return;

  const firstStepOrder = Math.min(...rows.map((r) => r.step_order));
  const firstStepRows = rows.filter((r) => r.step_order === firstStepOrder);
  const approverRows = firstStepRows.filter((r) => !r.cc_only);
  const ccRows = firstStepRows.filter((r) => r.cc_only);

  if (!approverRows.length) return; // misconfigured chain — no gating approver at the first step

  // current_chain_id stores one representative approver row (the first
  // one) purely to satisfy the NOT NULL FK — handleApprovalReply never
  // trusts it as "the" valid row for staleness checks (see its own
  // comment), specifically so multiple approver rows at this same step
  // (first-responder-wins, e.g. task_completion's two managers) are all
  // treated as equally live regardless of which one got stored here.
  await createApprovalProgress(tenantId, requestType, recordId, requesterEmployee.id, firstStepOrder, approverRows[0].id);

  // Every non-cc row at the winning step gets its OWN button, each
  // embedding that row's own id — not one arbitrary approver picked out
  // of the tier. This is what lets handleApprovalReply's authorization
  // check stay a simple "does resolveApprover(chainRow) match the
  // replying number" with no widening: whichever manager actually
  // replies, their button always names their own chain row.
  for (const approverRow of approverRows) {
    const approverContact = await resolveApprover(approverRow, requesterEmployee);
    if (approverContact) {
      const ids = buttonIds(requestType, recordId, approverRow.id);
      await sendButtonsFn(approverContact, summaryText, ids.approve, ids.reject);
    }
  }

  for (const ccRow of ccRows) {
    const ccContact = await resolveApprover(ccRow, requesterEmployee);
    if (ccContact) await sendInfoFn(ccContact, summaryText);
  }
}

/**
 * Handles an incoming approve/reject button reply for a gated request.
 * updateStatusFn(tenantId, recordId, status, approvedBy) is injected so
 * this file never hardcodes which request-specific table (e.g.
 * bot_leave_requests) the status actually lives on.
 *
 * getRequestSummaryFn(tenantId, requestType, recordId) — same function
 * passed to startApprovalFlow — is called again here when escalating to
 * a next step, replacing the earlier generic placeholder text. Since
 * it's the identical function called fresh each time (not a cached/
 * passed-through string), the escalation message reflects the record's
 * actual current state rather than whatever it looked like at creation.
 */
async function handleApprovalReply(tenantId, buttonId, fromNumber, sendButtonsFn, sendInfoFn, updateStatusFn, getRequestSummaryFn) {
  const match = buttonId.match(BUTTON_ID_PATTERN);
  if (!match) return { ok: false, message: 'Unrecognized button.' };

  const [, action, requestType, recordIdStr, chainIdStr] = match;
  const recordId = Number(recordIdStr);
  const chainId = Number(chainIdStr);

  const progress = await getApprovalProgress(tenantId, requestType, recordId);
  if (!progress || progress.status === 'completed') {
    return { ok: false, message: 'This request has already been resolved.' };
  }

  const chainRow = await getChainRowById(chainId);
  const requesterEmployee = await getEmployeeById(tenantId, progress.requester_employee_id);
  if (!chainRow || !requesterEmployee) {
    return { ok: false, message: 'This request could not be resolved. Please contact your administrator.' };
  }

  // Staleness is checked via step_order, not chainId === current_chain_id:
  // a step can have multiple valid approver rows (first-responder-wins),
  // and current_chain_id only ever stores ONE of them (see
  // startApprovalFlow's comment) — a DIFFERENT valid row at the same
  // still-live step must not be rejected just because it isn't the one
  // that happened to get stored there.
  if (chainRow.step_order !== progress.current_step_order) {
    return { ok: false, message: 'This approval step is no longer active.' };
  }

  const expectedContact = await resolveApprover(chainRow, requesterEmployee);
  if (!expectedContact || cleanNumber(fromNumber) !== cleanNumber(expectedContact)) {
    return { ok: false, message: '⚠️ You are not authorized to act on this request.' };
  }

  // completeApprovalProgress/advanceApprovalProgress are conditional
  // writes (WHERE status='in_progress' AND current_step_order = ?), not
  // plain updates: two replies from different valid approvers at this
  // same first-responder-wins step can both reach this point having both
  // read progress as 'in_progress' moments apart. Only the first write
  // actually lands; the loser's affectedRows is 0, which is treated
  // exactly like "already resolved" rather than proceeding to also
  // update the underlying record (double-approval, duplicate customer
  // notification, etc.).
  if (action === 'reject') {
    const won = await completeApprovalProgress(tenantId, requestType, recordId, progress.current_step_order);
    if (!won) return { ok: false, message: 'This request has already been resolved.' };
    await updateStatusFn(tenantId, recordId, 'Rejected', fromNumber);
    return { ok: true, final: true, decision: 'Rejected', message: '❌ Rejected.' };
  }

  const nextRows = await getNextStepRows(
    tenantId,
    requestType,
    chainRow.applies_to_subtype,
    chainRow.applies_to_role,
    chainRow.step_order
  );

  if (!nextRows.length) {
    const won = await completeApprovalProgress(tenantId, requestType, recordId, progress.current_step_order);
    if (!won) return { ok: false, message: 'This request has already been resolved.' };
    await updateStatusFn(tenantId, recordId, 'Approved', fromNumber);
    return { ok: true, final: true, decision: 'Approved', message: '✅ Approved (final step).' };
  }

  const nextStepOrder = Math.min(...nextRows.map((r) => r.step_order));
  const nextStepRows = nextRows.filter((r) => r.step_order === nextStepOrder);
  const nextApproverRows = nextStepRows.filter((r) => !r.cc_only);
  const nextCcRows = nextStepRows.filter((r) => r.cc_only);

  if (!nextApproverRows.length) {
    // misconfigured chain — a next step exists but has no gating approver row
    const won = await completeApprovalProgress(tenantId, requestType, recordId, progress.current_step_order);
    if (!won) return { ok: false, message: 'This request has already been resolved.' };
    await updateStatusFn(tenantId, recordId, 'Approved', fromNumber);
    return { ok: true, final: true, decision: 'Approved', message: '✅ Approved (final step).' };
  }

  const won = await advanceApprovalProgress(tenantId, requestType, recordId, progress.current_step_order, nextStepOrder, nextApproverRows[0].id);
  if (!won) return { ok: false, message: 'This request has already been resolved.' };
  await updateStatusFn(tenantId, recordId, 'Manager Approved', fromNumber);

  const escalationText = await getRequestSummaryFn(tenantId, requestType, recordId);

  // Same per-row button treatment as startApprovalFlow's first step —
  // every non-cc row at the next step gets its own button naming its
  // own chain row id, so a first-responder-wins step later in the chain
  // works identically to one at the start.
  for (const nextApproverRow of nextApproverRows) {
    const nextContact = await resolveApprover(nextApproverRow, requesterEmployee);
    if (nextContact) {
      const ids = buttonIds(requestType, recordId, nextApproverRow.id);
      await sendButtonsFn(nextContact, escalationText, ids.approve, ids.reject);
    }
  }
  for (const ccRow of nextCcRows) {
    const ccContact = await resolveApprover(ccRow, requesterEmployee);
    if (ccContact) await sendInfoFn(ccContact, escalationText);
  }

  return { ok: true, final: false, decision: 'Manager Approved', message: '✅ Approved. Forwarded to the next approver.' };
}

module.exports = { startApprovalFlow, handleApprovalReply, broadcastNotifyOnly };
