// Expense-specific wiring on top of the generic approvalEngine — mirrors
// services/leaveApproval.js's structure exactly. See that file's header
// comment for the reasoning behind the tenant-bound-closure pattern
// (sendButtonsFn/sendInfoFn have no tenant parameter in approvalEngine's
// contract, but whatsapp.js's functions all require one).

const whatsapp = require('./whatsapp');
const { createExpenseClaim, getExpenseRequestSummary, updateExpenseStatus } = require('./db-mysql');
const { startApprovalFlow, handleApprovalReply } = require('./approvalEngine');

function createExpenseApprovalSenders(tenant) {
  return {
    async sendExpenseButtons(contact, summaryText, approveId, rejectId) {
      return whatsapp.sendButtons(tenant, contact, summaryText, [
        { id: approveId, title: '✅ Approve' },
        { id: rejectId, title: '❌ Reject' },
      ]);
    },
    async sendExpenseInfo(contact, summaryText) {
      return whatsapp.sendText(tenant, contact, summaryText);
    },
  };
}

// getExpenseRequestSummary/updateExpenseStatus already match
// getRequestSummaryFn/updateStatusFn exactly (services/db-mysql.js) —
// re-exported via direct use below, nothing to adapt. Same reasoning as
// leaveApproval.js.

/**
 * Creates an expense claim, then immediately starts its approval flow.
 * Unlike leave, expense has no subtype dimension at all (no equivalent
 * of Emergency Leave) — subtype is passed as null, which resolveTier
 * treats as "no preference," matching on role alone. This is expected
 * to resolve to a single-step chain (no "Manager Approved" escalation
 * exists in the source for expenses — see handleExpenseApproval, which
 * has no intermediate state, straight to ACCOUNTS_NUMBER/Sivaranjani).
 *
 * NOTE: no 'expense' rows exist yet in bot_approval_chains (only
 * 'leave' and 'late_reason' were seeded in migration 015) — until an
 * expense chain is seeded, startApprovalFlow's resolveTier call will
 * return an empty array and this will silently send nothing. That's
 * expected/correct behavior for an unconfigured chain, not a bug in
 * this file, but it means this can't actually notify anyone until a
 * chain row is added (e.g. request_type='expense', role='*',
 * approver_type='employee' pointing at Sivaranjani's id).
 */
async function createExpenseClaimWithApproval(tenant, employee, expenseType, amount, expenseDate, description, receiptUrl) {
  const tenantId = tenant.id;

  const result = await createExpenseClaim(tenantId, employee, expenseType, amount, expenseDate, description, receiptUrl);
  if (!result) return null;

  const { sendExpenseButtons, sendExpenseInfo } = createExpenseApprovalSenders(tenant);

  await startApprovalFlow(
    tenantId,
    'expense',
    result.id,
    employee,
    null, // no subtype concept for expense
    sendExpenseButtons,
    sendExpenseInfo,
    getExpenseRequestSummary
  );

  return result;
}

/**
 * Handles an approve/reject button reply for an 'expense' request. Thin
 * wrapper so call sites don't need to know updateExpenseStatus/
 * getExpenseRequestSummary are the right functions to inject.
 */
async function handleExpenseApprovalReply(tenant, buttonId, fromNumber) {
  const { sendExpenseButtons, sendExpenseInfo } = createExpenseApprovalSenders(tenant);
  return handleApprovalReply(tenant.id, buttonId, fromNumber, sendExpenseButtons, sendExpenseInfo, updateExpenseStatus, getExpenseRequestSummary);
}

module.exports = { createExpenseApprovalSenders, createExpenseClaimWithApproval, handleExpenseApprovalReply };
