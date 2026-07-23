// Foreign worker document expiry reminders — a scheduled counterpart to
// the live-event notify-only flows (late_reason, task_late_arrival)
// that already go through approvalEngine.broadcastNotifyOnly. This one
// isn't routed through that engine or bot_approval_chains at all: the
// recipients here are fixed by definition (the tenant's owner, plus
// whichever specific employee the expiring document belongs to), not
// resolved from a configurable role-based chain — there's nothing for a
// chain lookup to add over just fetching those two people directly.
//
// sendInfoFn is injected (not services/whatsapp.js imported directly),
// matching every other module in this file's family (approvalEngine.js,
// leaveApproval.js) — called as (contact, messageText).

const { getExpiringDocuments, getOwnerEmployee, getEmployeeById, updateDocumentReminderSentAt } = require('./db-mysql');

const REMINDER_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function formatDate(expiryDate) {
  // mysql2 returns DATE columns as JS Date objects — normalize to
  // YYYY-MM-DD regardless of whether the driver ever hands back a plain
  // string instead (defensive, not because that's been observed here).
  const d = expiryDate instanceof Date ? expiryDate : new Date(expiryDate);
  return d.toISOString().split('T')[0];
}

function daysRemaining(expiryDate) {
  const d = expiryDate instanceof Date ? expiryDate : new Date(expiryDate);
  const msPerDay = 1000 * 60 * 60 * 24;
  // Both sides floored to midnight before differencing — otherwise the
  // current time-of-day (e.g. checking at 11pm vs 1am) shifts the result
  // by a day even though the calendar-day gap hasn't changed.
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const expiryMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((expiryMidnight - todayMidnight) / msPerDay);
}

/**
 * Checks one tenant's documents expiring within 30 days and sends a
 * reminder to the owner and the specific employee for each one that
 * hasn't been reminded about in the last 7 days (reminder_sent_at NULL
 * or older than the cooldown) — this is the per-document spam guard the
 * schema's reminder_sent_at column exists for. Skips silently (no
 * message sent) for a document with no owner resolvable or no
 * employee_id (e.g. after a SET NULL employee deletion) — there's no
 * one left to notify in either case.
 */
async function checkAndSendExpiryReminders(tenant, sendInfoFn) {
  const documents = await getExpiringDocuments(tenant.id, 30);

  let reminded = 0;

  for (const doc of documents) {
    if (doc.reminder_sent_at) {
      const lastSent = new Date(doc.reminder_sent_at).getTime();
      if (Date.now() - lastSent < REMINDER_COOLDOWN_MS) continue;
    }

    const message = `⚠️ Document Expiry Alert\n\n${doc.employee_name}'s ${doc.document_type} expires on ${formatDate(doc.expiry_date)} (${daysRemaining(doc.expiry_date)} days remaining).\nPlease renew soon.`;

    const owner = await getOwnerEmployee(tenant.id);
    if (owner && owner.whatsapp_number) {
      await sendInfoFn(owner.whatsapp_number, message);
    }

    if (doc.employee_id) {
      const employee = await getEmployeeById(tenant.id, doc.employee_id);
      // Owner and the expiring employee can be the same person (e.g. a
      // sole proprietor's own work permit) — sendInfoFn is called again
      // rather than deduped, matching how a real person would want two
      // separate pieces of context (owner-hat and employee-hat) even
      // though the practical outcome today is the same WhatsApp number
      // getting the identical text twice.
      if (employee && employee.whatsapp_number) {
        await sendInfoFn(employee.whatsapp_number, message);
      }
    }

    await updateDocumentReminderSentAt(tenant.id, doc.id);
    reminded++;
  }

  return { checked: documents.length, reminded };
}

module.exports = { checkAndSendExpiryReminders };
