// Leave-specific wiring on top of the generic approvalEngine —
// concrete implementations of the 4 injected functions
// startApprovalFlow/handleApprovalReply expect, plus the entry point
// that creates a leave request and kicks off its approval chain.
//
// sendButtonsFn/sendInfoFn per approvalEngine.js's contract are called
// as (contact, text, ...) — no tenant parameter — but the underlying
// services/whatsapp.js functions all require a tenant object (for
// accessToken/phoneNumberId). createLeaveApprovalSenders(tenant) closes
// over the tenant once so the returned functions match approvalEngine's
// expected shape.

const whatsapp = require('./whatsapp');
const { createLeaveRequest, getLeaveRequestSummary, updateLeaveStatus } = require('./db-mysql');
const { startApprovalFlow, handleApprovalReply } = require('./approvalEngine');

function createLeaveApprovalSenders(tenant) {
  return {
    async sendLeaveButtons(contact, summaryText, approveId, rejectId) {
      return whatsapp.sendButtons(tenant, contact, summaryText, [
        { id: approveId, title: '✅ Approve' },
        { id: rejectId, title: '❌ Reject' },
      ]);
    },
    async sendLeaveInfo(contact, summaryText) {
      return whatsapp.sendText(tenant, contact, summaryText);
    },
  };
}

// getLeaveRequestSummary already matches getRequestSummaryFn(tenantId,
// requestType, recordId) exactly (services/db-mysql.js) — re-exported
// here rather than wrapped, nothing to adapt.
//
// updateLeaveStatus already matches updateStatusFn(tenantId, recordId,
// status, approvedBy) exactly too — same reasoning, passed straight
// through wherever handleApprovalReply is invoked for 'leave'.

/**
 * Creates a leave request, then immediately starts its approval flow.
 * `tenant` is the full tenant object (config/tenants.js shape) — needed
 * for the WhatsApp senders; tenant.id is used everywhere a bare tenantId
 * string is needed, so callers don't have to pass both separately.
 *
 * subtype passed to startApprovalFlow is the ORIGINAL requested
 * leaveType (e.g. "Emergency Leave"), not the value actually stored in
 * bot_leave_requests.leave_type — createLeaveRequest remaps "Emergency
 * Leave" to "Unpaid Leave" before persisting (matching the source), so
 * matching subtype against the stored column would never find the
 * Emergency Leave chain override. This is the exact caveat documented
 * in migration 015's header comment.
 */
async function createLeaveRequestWithApproval(tenant, requesterEmployee, leaveType, startDate, endDate, totalDays, reason) {
  const tenantId = tenant.id;

  const result = await createLeaveRequest(tenantId, requesterEmployee, leaveType, startDate, endDate, totalDays, reason);
  if (!result) return null;

  const { sendLeaveButtons, sendLeaveInfo } = createLeaveApprovalSenders(tenant);

  await startApprovalFlow(
    tenantId,
    'leave',
    result.id,
    requesterEmployee,
    leaveType, // original, pre-remap subtype — see comment above
    sendLeaveButtons,
    sendLeaveInfo,
    getLeaveRequestSummary
  );

  return result;
}

/**
 * Handles an approve/reject button reply for a 'leave' request. Thin
 * wrapper so call sites (routes/webhook.js) don't need to know
 * updateLeaveStatus/getLeaveRequestSummary are the right functions to
 * inject — that mapping lives here, once, alongside the tenant-bound
 * senders.
 */
async function handleLeaveApprovalReply(tenant, buttonId, fromNumber) {
  const { sendLeaveButtons, sendLeaveInfo } = createLeaveApprovalSenders(tenant);
  return handleApprovalReply(tenant.id, buttonId, fromNumber, sendLeaveButtons, sendLeaveInfo, updateLeaveStatus, getLeaveRequestSummary);
}

module.exports = { createLeaveApprovalSenders, createLeaveRequestWithApproval, handleLeaveApprovalReply };
