// Notify-only trigger for a technician arriving late to a task — no
// bot_approval_progress row, no persisted request record at all. The
// lateness event itself IS the notification; unlike leave/expense there
// is nothing else to look up later (no button reply will ever reference
// this "request"), so getTaskLateArrivalSummary takes taskData directly
// rather than a recordId.

const { broadcastNotifyOnly } = require('./approvalEngine');

function getTaskLateArrivalSummary(tenantId, requestType, taskData) {
  return `⏰ Late Arrival Report\n\n👨‍🔧 Technician: ${taskData.technicianName}\n📋 Task: ${taskData.taskName}\n👤 Customer: ${taskData.customerName}\n❓ Reason: ${taskData.reason}`;
}

/**
 * NOTE: 'manager' is passed as broadcastNotifyOnly's `role` argument
 * here — a literal string, not technicianEmployee.role. Every other
 * broadcastNotifyOnly caller (e.g. late_reason) passes the REQUESTER's
 * own role there, since that argument feeds resolveTier's check for
 * "does a role-specific chain override exist for the requester's
 * role." This only works correctly today because task_late_arrival's
 * seeded chain rows (migration 020) both use applies_to_role='*' — no
 * role-specific override exists to match against, so it doesn't matter
 * what's passed. If a role-specific override is ever added for this
 * request type, revisit whether 'role' should follow the established
 * "requester's own role" convention or something else here.
 */
async function reportTaskLateArrival(tenant, technicianEmployee, taskName, customerName, reason, sendInfoFn) {
  await broadcastNotifyOnly(
    tenant.id,
    'task_late_arrival',
    technicianEmployee,
    'manager',
    sendInfoFn,
    () => getTaskLateArrivalSummary(tenant.id, 'task_late_arrival', {
      technicianName: technicianEmployee.full_name,
      taskName,
      customerName,
      reason,
    })
  );
}

module.exports = { getTaskLateArrivalSummary, reportTaskLateArrival };
