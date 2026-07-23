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
const { formatDateLocal } = require('../utils/dateFormat');

const REMINDER_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Same +08:00 correction as formatDateLocal (utils/dateFormat.js) —
 * services/db-mysql.js's pool declares timezone: '+08:00', so
 * expiryDate must be shifted back into real calendar-day terms before
 * any math runs on it, not read via system-local getters (those read
 * components in whatever timezone THIS process happens to run in,
 * which was the exact bug already found and fixed in formatDateLocal).
 * "today" is computed the same way (shifted, then re-based to UTC
 * day-boundaries) so both sides of the subtraction are expressed in
 * the same +08:00 business-day frame — comparing one side corrected
 * for +08:00 against the other read in the process's own arbitrary
 * system timezone would just reintroduce the identical class of bug
 * from a different angle.
 */
function daysRemaining(expiryDate) {
  const d = expiryDate instanceof Date ? expiryDate : new Date(expiryDate);
  const msPerDay = 1000 * 60 * 60 * 24;

  const expiryShifted = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  const expiryDayUTC = Date.UTC(expiryShifted.getUTCFullYear(), expiryShifted.getUTCMonth(), expiryShifted.getUTCDate());

  const nowShifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const todayDayUTC = Date.UTC(nowShifted.getUTCFullYear(), nowShifted.getUTCMonth(), nowShifted.getUTCDate());

  return Math.round((expiryDayUTC - todayDayUTC) / msPerDay);
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

    const message = `⚠️ Document Expiry Alert\n\n${doc.employee_name}'s ${doc.document_type} expires on ${formatDateLocal(doc.expiry_date)} (${daysRemaining(doc.expiry_date)} days remaining).\nPlease renew soon.`;

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
