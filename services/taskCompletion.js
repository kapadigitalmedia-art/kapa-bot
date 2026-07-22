// Task-completion-specific wiring on top of the generic approvalEngine —
// mirrors services/leaveApproval.js/expenseApproval.js's structure, but
// with two differences forced by task_completion's actual shape:
//
// 1. approver_type is 'employee' with FIXED manager ids (see migration
//    021 — Hafizh id=3, Ahmad Faisal id=4, both step_order=1,
//    cc_only=FALSE), not 'requester_manager' — so unlike leave/expense,
//    the requesterEmployee passed into startApprovalFlow is never used
//    to LOOK UP an approver. It's still required, though, not optional:
//    resolveApprover's 'employee' branch reads requesterEmployee.tenant_id
//    just to scope its query, startApprovalFlow itself reads
//    requesterEmployee.role for resolveTier's tiering, and
//    createApprovalProgress stores requesterEmployee.id into
//    bot_approval_progress.requester_employee_id, a NOT NULL FK
//    (migration 017). Passing null throws before ever reaching the DB.
//    The correct value is the task's own assignee (the technician who
//    submitted the work) — fetched via getTaskById(...).assignees[0].
//
// 2. bot_tasks.status is a strict ENUM('Pending','Accepted','In
//    Progress','Completed','Cancelled','Rework') with no 'Approved'/
//    'Rejected' value, unlike bot_leave_requests.approval_status /
//    bot_expense_claims.status which accept those generic decision
//    strings directly. updateTaskCompletionStatus below is a mapping
//    adapter for exactly this reason — passing updateTaskStatus straight
//    through as updateStatusFn would both mis-shape the 4th argument
//    (an object, not the approvedBy string approvalEngine sends) and
//    violate the ENUM constraint outright.

const whatsapp = require('./whatsapp');
const { getTaskById, updateTaskStatus, getEmployeeById } = require('./db-mysql');
const { startApprovalFlow, handleApprovalReply } = require('./approvalEngine');

function createTaskCompletionSenders(tenant) {
  return {
    async sendTaskCompletionButtons(contact, summaryText, approveId, rejectId) {
      return whatsapp.sendButtons(tenant, contact, summaryText, [
        { id: approveId, title: '✅ Approve' },
        { id: rejectId, title: '❌ Reject' },
      ]);
    },
    async sendTaskCompletionInfo(contact, summaryText) {
      return whatsapp.sendText(tenant, contact, summaryText);
    },
  };
}

async function getTaskCompletionSummary(tenantId, requestType, recordId) {
  const task = await getTaskById(tenantId, recordId);
  if (!task) return 'Task details unavailable.';
  const technicianName = task.assignees && task.assignees.length ? task.assignees[0].full_name : 'Technician';
  const summaryText = task.work_summary || task.ai_summary || 'No summary provided.';
  return `📋 *Task Completion Review*\n\n👨‍🔧 Technician: ${technicianName}\n📋 Task: ${task.task_name || 'Task'}\n👤 Customer: ${task.customer_name || 'Customer'}\n📝 Summary: ${summaryText}`;
}

/**
 * 'Approved' -> 'Completed' matches the source's handleManagerApprove
 * exactly (index.js:1800 sets status "Completed"). 'Rejected' -> 'Rework'
 * per explicit confirmation: the ENUM value exists for exactly this, even
 * though there's no technician-facing resubmission flow built yet to act
 * on a 'Rework' task (same deferred-gap status as the "Give Feedback"
 * button, which this reject path is standing in for until that's built).
 * 'Manager Approved' is unreachable here — task_completion is a single
 * step-order=1 chain (migration 021), so handleApprovalReply's approve
 * path always takes the "no next step" branch and sends literal
 * 'Approved', never the mid-chain escalation string.
 */
const STATUS_MAP = {
  Approved: 'Completed',
  Rejected: 'Rework',
};

async function updateTaskCompletionStatus(tenantId, recordId, status, approvedBy) {
  const mappedStatus = STATUS_MAP[status] || status;
  return updateTaskStatus(tenantId, recordId, mappedStatus, {
    manager_approved_by: approvedBy || null,
  });
}

/**
 * Submits a technician's completed-work report for manager review.
 * Status stays 'Pending' (not yet 'Completed') until a manager actually
 * approves — handleTaskCompletionApprovalReply below is what eventually
 * flips it via updateTaskCompletionStatus.
 *
 * requesterEmployee is the task's own assignee (the technician), fetched
 * fresh here rather than passed in by the caller — see this file's
 * header comment for why null isn't viable. If the task has no assignee
 * on record at all (a data integrity gap, not expected in practice given
 * createTask requires assigneeEmployeeIds), this returns null rather
 * than calling startApprovalFlow with a broken requesterEmployee.
 */
async function submitTaskForApproval(tenant, taskId, workSummary, photoUrl) {
  const tenantId = tenant.id;

  const updated = await updateTaskStatus(tenantId, taskId, 'Pending', {
    work_summary: workSummary,
    work_photo_url: photoUrl,
  });
  if (!updated) return null;

  const task = await getTaskById(tenantId, taskId);
  if (!task || !task.assignees || !task.assignees.length) return null;

  const requesterEmployee = await getEmployeeById(tenantId, task.assignees[0].id);
  if (!requesterEmployee) return null;

  const { sendTaskCompletionButtons, sendTaskCompletionInfo } = createTaskCompletionSenders(tenant);

  await startApprovalFlow(
    tenantId,
    'task_completion',
    taskId,
    requesterEmployee,
    null, // no subtype concept for task_completion
    sendTaskCompletionButtons,
    sendTaskCompletionInfo,
    getTaskCompletionSummary
  );

  return task;
}

/**
 * Handles an approve/reject button reply for a 'task_completion'
 * request. Thin wrapper so call sites don't need to know
 * updateTaskCompletionStatus/getTaskCompletionSummary are the right
 * functions to inject — same shape as handleExpenseApprovalReply.
 */
async function handleTaskCompletionApprovalReply(tenant, buttonId, fromNumber) {
  const { sendTaskCompletionButtons, sendTaskCompletionInfo } = createTaskCompletionSenders(tenant);
  return handleApprovalReply(
    tenant.id,
    buttonId,
    fromNumber,
    sendTaskCompletionButtons,
    sendTaskCompletionInfo,
    updateTaskCompletionStatus,
    getTaskCompletionSummary
  );
}

module.exports = {
  createTaskCompletionSenders,
  getTaskCompletionSummary,
  submitTaskForApproval,
  handleTaskCompletionApprovalReply,
};
