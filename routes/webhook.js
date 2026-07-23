const express = require('express');
const router = express.Router();
const config = require('../config/config');
const { resolveTenantForMessage } = require('../services/tenantResolution');
const whatsapp = require('../services/whatsapp');
const { tenantDb } = require('../services/db');
const {
  getConversationState: getConversationStateMysql,
  setConversationState: setConversationStateMysql,
  deleteConversationState: deleteConversationStateMysql,
  getEmployeeByPhone,
  createCheckIn,
  updateCheckOut,
  resolveTier,
  getIndustryForTenant,
} = require('../services/db-mysql');
const logger = require('../utils/logger');
const { handleAdminCommand } = require('../services/adminCommands');
const { handleLeaveApprovalReply } = require('../services/leaveApproval');
const { handleExpenseApprovalReply } = require('../services/expenseApproval');
const { handleTaskCompletionApprovalReply } = require('../services/taskCompletion');
const { broadcastNotifyOnly } = require('../services/approvalEngine');
const { getLateReasonSummary } = require('../services/lateReason');
const { sendIndustryPicker, handleIndustrySelection, simulateDemoCheckIn, simulateDemoCheckOut } = require('../services/prospectDemo');

/**
 * conversationState is live, mid-conversation state for a real person
 * waiting on a bot reply — a failed lookup here means a broken
 * conversation, not just a missing log entry. Each helper tries MySQL
 * first and falls back to the old lowdb store on failure, same
 * safety-net pattern as the other four migrated routes, just colocated
 * here since there are 4 call sites below sharing 3 operations.
 *
 * TODO/FIXME — known asymmetry bug, confirmed via a real end-to-end test
 * (trial signup whose tenant_id had no matching bot_companies row):
 * setConvState falls back to lowdb only when its MySQL INSERT/UPDATE
 * throws. getConvState's MySQL SELECT for that same tenant_id succeeds
 * trivially (finds zero rows, no exception) — so it never falls back to
 * lowdb, and silently returns undefined instead of the state that
 * actually got written there. Net effect: once a single write for a
 * given tenant_id/phone falls back to lowdb, every subsequent read via
 * this MySQL-first path sees nothing, breaking multi-step conversations
 * (e.g. check-in text -> location share) for that tenant, with no error
 * surfaced anywhere. Needs a real fix in its own turn — e.g. getConvState
 * merging/preferring lowdb whenever a lowdb entry exists at all, not only
 * when its own MySQL call throws — not bundled with today's trial-signup
 * work.
 */
async function getConvState(tenantId, phone) {
  try {
    return await getConversationStateMysql(tenantId, phone);
  } catch (err) {
    logger.warn(`[${tenantId}] MySQL read failed for conversationState, falling back to lowdb: ${err.message}`);
    return tenantDb(tenantId).get('conversationState').get(phone).value();
  }
}

async function setConvState(tenantId, phone, value) {
  try {
    await setConversationStateMysql(tenantId, phone, value);
  } catch (err) {
    logger.warn(`[${tenantId}] MySQL write failed for conversationState, falling back to lowdb: ${err.message}`);
    tenantDb(tenantId).get('conversationState').set(phone, value).write();
  }
}

async function deleteConvState(tenantId, phone) {
  try {
    await deleteConversationStateMysql(tenantId, phone);
  } catch (err) {
    logger.warn(`[${tenantId}] MySQL delete failed for conversationState, falling back to lowdb: ${err.message}`);
    tenantDb(tenantId).get('conversationState').unset(phone).write();
  }
}

/**
 * GET /webhook
 * One shared verify token works across every tenant's phone number, since
 * they can all live under the same Meta App (or you can add per-App
 * verify token support later if a tenant needs their own App).
 */
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.meta.verifyToken) {
    logger.info('Webhook verified successfully by Meta.');
    return res.status(200).send(challenge);
  }
  logger.warn('Webhook verification FAILED — token mismatch.');
  return res.sendStatus(403);
});

/**
 * POST /webhook
 * Every tenant's incoming messages arrive here. The tenant is resolved
 * from `value.metadata.phone_number_id` — the WhatsApp number the message
 * was sent TO — so one shared endpoint safely serves every customer.
 */
router.post('/', async (req, res) => {
  res.sendStatus(200); // ack immediately, Meta retries on slow/failed acks

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) return; // status update / non-message event — ignore

    const incomingPhoneNumberId = value?.metadata?.phone_number_id;
    const from = message.from;
    const { tenant: resolvedTenant, reason, configTenant, matchedTenantIds } = await resolveTenantForMessage(incomingPhoneNumberId, from);

    if (!resolvedTenant && reason === 'unknown_phone_number_id') {
      logger.warn(`Incoming message for UNKNOWN phone_number_id=${incomingPhoneNumberId} — no matching tenant in config/tenants.js. Ignoring.`);
      return;
    }

    if (!resolvedTenant && reason === 'access_blocked') {
      // Asia Avid's real employee numbers, explicitly refused now that
      // this phone_number_id is the shared demo number — must NOT fall
      // through to the picker/any other flow, unlike not_signed_up.
      await whatsapp.sendText(configTenant, from, 'This number no longer has access to this system. Please contact KAPA Technologies if you have questions.');
      return;
    }

    if (!resolvedTenant && reason === 'trial_expired') {
      await whatsapp.sendText(configTenant, from, "⏰ Your trial has ended. Contact us to continue using KAPA ONE!\n\n👉 wa.me/917305737508");
      return;
    }

    if (!resolvedTenant && reason === 'ambiguous_employee') {
      // whatsapp_number collided across 2+ tenants' bot_employees (only
      // unique per-tenant, not globally) — a real data-integrity
      // situation, not a normal user-facing case. Silently drop rather
      // than guess a winner or reply, since replying risks leaking one
      // tenant's context to another tenant's employee.
      logger.error(`Ambiguous employee match for sender=${from} on phone_number_id=${incomingPhoneNumberId} — matched multiple tenants: ${JSON.stringify(matchedTenantIds)}. Dropping message silently.`);
      return;
    }

    // Either a genuinely resolved tenant (a real kapa/Asia-Avid employee,
    // or an active trial customer's own isolated tenant), or
    // reason === 'not_signed_up' (a prospect with no trial yet) — the
    // latter falls through to configTenant rather than short-circuiting
    // here, so the existing employee-vs-prospect fork below
    // (getEmployeeByPhone) keeps working completely unchanged: a genuine
    // prospect has no bot_employees row under 'kapa' either way, so they
    // transparently land in the same demo/industry-picker flow as
    // before this wiring. See tenantResolution.js's header comment for
    // why not_signed_up specifically must NOT short-circuit here.
    const tenant = resolvedTenant || configTenant;

    const contactName = value?.contacts?.[0]?.profile?.name || null;
    const isAdmin = (tenant.adminNumbers || []).includes(from);

    logger.info(`[${tenant.id}] Incoming WhatsApp from ${from} (${contactName || 'unknown'}): type=${message.type}`);

    // ── 1. Location messages — completes a check-in/out ──────────────────
    if (message.type === 'location') {
      const state = await getConvState(tenant.id, from);
      if (state && state.step === 'awaiting_location') {
        const employee = await getEmployeeByPhone(tenant.id, from);
        if (!employee) {
          await deleteConvState(tenant.id, from);
          await whatsapp.sendText(tenant, from, "We couldn't find your employee record. Please contact your admin.");
          return;
        }

        const lat = message.location.latitude;
        const lng = message.location.longitude;

        if (state.data.type === 'in') {
          const record = await createCheckIn(tenant.id, employee.id, lat, lng);
          await deleteConvState(tenant.id, from);
          if (!record) {
            await whatsapp.sendText(tenant, from, '❌ Check-in failed. Please try again or contact your admin.');
            return;
          }
          const statusLabel = record.attendance_status === 'Late'
            ? `Late (${record.late_minutes} min)`
            : record.attendance_status;
          await whatsapp.sendText(
            tenant,
            from,
            `✅ *Checked In*\n\nTime: ${record.check_in_time}\nStatus: ${statusLabel}`
          );

          // Late-reason prompt — triggers on record.attendance_status === 'Late'
          // rather than the source's hardcoded totalMin > 510 (8:30am) check.
          // createCheckIn already computes attendance_status correctly against
          // this specific employee's own configurable shift_start, so this is
          // a deliberate fix over the source (which ignores shift_start
          // entirely for this particular gate), not a faithful port.
          if (record.attendance_status === 'Late') {
            const resolvedRows = await resolveTier(tenant.id, 'late_reason', null, employee.role);
            if (resolvedRows.length > 0) {
              await setConvState(tenant.id, from, {
                step: 'awaiting_late_reason',
                data: { checkinTime: record.check_in_time, lateMinutes: record.late_minutes },
              });
              await whatsapp.sendText(tenant, from, '📝 You checked in late. Please type the *reason* for your late check-in:');
              return;
            }
            // no configured late_reason chain for this employee's role — skip
            // silently, same as the source's behavior when getLateReasonManager
            // resolves nothing.
          }
        } else {
          const record = await updateCheckOut(tenant.id, employee.id, lat, lng);
          await deleteConvState(tenant.id, from);
          if (!record) {
            await whatsapp.sendText(tenant, from, '⚠️ No check-in found for today. Please check in first.');
            return;
          }
          await whatsapp.sendText(
            tenant,
            from,
            `✅ *Checked Out*\n\nCheck-In: ${record.check_in_time}\nCheck-Out: ${record.check_out_time}`
          );
        }
      } else {
        await whatsapp.sendText(tenant, from, "I wasn't expecting a location right now. Type 'check in' or 'check out' first.");
      }
      return;
    }

    // ── 2. Plain text messages ────────────────────────────────────────────
    if (message.type === 'text') {
      const text = message.text.body.trim().toLowerCase();
      // Looked up once here and reused below — the check-in/checkout
      // branches used to each re-fetch this independently. It also now
      // decides which of two entirely separate branches runs: a known
      // employee gets the existing attendance/admin/greeting logic
      // unchanged; anyone else gets the prospect/demo flow below, which
      // never touches bot_employees or any real attendance table.
      const employee = await getEmployeeByPhone(tenant.id, from);

      if (employee) {
        const lateReasonState = await getConvState(tenant.id, from);
        if (lateReasonState && lateReasonState.step === 'awaiting_late_reason') {
          const reason = message.text.body.trim();
          await deleteConvState(tenant.id, from);
          const sendInfoFn = (contact, msgText) => whatsapp.sendText(tenant, contact, msgText);
          await broadcastNotifyOnly(
            tenant.id,
            'late_reason',
            employee,
            employee.role,
            sendInfoFn,
            () => getLateReasonSummary(tenant.id, 'late_reason', {
              employeeName: employee.full_name,
              checkinTime: lateReasonState.data.checkinTime,
              lateMinutes: lateReasonState.data.lateMinutes,
              reason,
            })
          );
          await whatsapp.sendText(tenant, from, '✅ Reason recorded. Thank you for reporting.');
          return;
        }

        if (tenant.features.attendance && ['check in', 'checkin', 'check-in'].includes(text)) {
          await setConvState(tenant.id, from, { step: 'awaiting_location', data: { type: 'in' } });
          await whatsapp.requestLocation(tenant, from, '📍 Please share your location to confirm check-in.');
          return;
        }
        if (tenant.features.attendance && ['check out', 'checkout', 'check-out'].includes(text)) {
          await setConvState(tenant.id, from, { step: 'awaiting_location', data: { type: 'out' } });
          await whatsapp.requestLocation(tenant, from, '📍 Please share your location to confirm check-out.');
          return;
        }

        if (tenant.features.adminDashboard && isAdmin) {
          const reply = await handleAdminCommand(tenant, text);
          await whatsapp.sendText(tenant, from, reply);
          return;
        }

        // Industry-specific greeting variant — only 'dine' has one today;
        // every other industry (including 'kapa' itself, which has no
        // bot_trial_signups row at all) falls through to the existing
        // generic greeting completely unchanged.
        const industrySlug = await getIndustryForTenant(tenant.id);
        if (industrySlug === 'dine') {
          await whatsapp.sendText(
            tenant,
            from,
            `👋 Hi! I'm your KAPA ONE Dine assistant for ${tenant.name}.\n\nStaff: type 'check in' or 'check out' to track attendance.\nMore features (menu, orders, inventory) coming soon in your dashboard!\n\nFor anything else, contact your admin.`
          );
          return;
        }

        await whatsapp.sendText(
          tenant,
          from,
          `👋 Hi! I'm the ${tenant.name} Bot.\n\nEmployees: type 'check in' or 'check out'.\nFor anything else, please contact your administrator.`
        );
        return;
      }

      // ── Prospect (no bot_employees record) — demo/industry-picker flow ──
      const demoState = await getConvState(tenant.id, from);
      if (demoState && demoState.step === 'demo_exploring') {
        // Only 'field' ever sets this state (see prospectDemo.js), so
        // check-in/checkout here is always the cosmetic Field simulation
        // — no bot_employees/attendance access at all.
        if (['check in', 'checkin', 'check-in'].includes(text)) {
          await whatsapp.sendText(tenant, from, simulateDemoCheckIn());
          return;
        }
        if (['check out', 'checkout', 'check-out'].includes(text)) {
          await whatsapp.sendText(tenant, from, simulateDemoCheckOut());
          return;
        }
        await whatsapp.sendText(tenant, from, "Try typing 'check in' or 'check out' to see the demo in action! 👍");
        return;
      }

      // No demo in progress — any text at all (including a bare "hi")
      // sends the industry picker; there's no employee-record rejection
      // for prospects anymore.
      await sendIndustryPicker(tenant, from);
      return;
    }

    // ── 3. List replies — prospect industry picker ────────────────────────
    if (message.type === 'interactive' && message.interactive?.type === 'list_reply') {
      const industryId = message.interactive.list_reply.id;
      const result = handleIndustrySelection(industryId);
      if (result) {
        if (result.newConvState) {
          await setConvState(tenant.id, from, result.newConvState);
        }
        await whatsapp.sendText(tenant, from, result.message);
      }
      return;
    }

    // ── 4. Button/interactive replies — approve/reject on a pending request ──
    // Two real Meta payload shapes, matching kapa-attendance-bot's
    // handleButtonReply for consistency: the reply-buttons format we
    // actually send via whatsapp.sendButtons comes back as
    // type:"interactive" / interactive.type:"button_reply", with the id
    // at message.interactive.button_reply.id. type:"button" /
    // message.button.payload is the older template-button shape — kept
    // for parity with source even though nothing we send uses it today.
    let buttonId = null;
    if (message.type === 'interactive' && message.interactive?.type === 'button_reply') {
      buttonId = message.interactive.button_reply.id;
    } else if (message.type === 'button') {
      buttonId = message.button?.payload || null;
    }

    if (buttonId) {
      // leave/expense/task_completion wired so far — overtime/quotation/
      // payroll_adjustment fall through to the generic reply below until
      // their handlers exist.
      if (/^(approve|reject)_leave_/.test(buttonId)) {
        const result = await handleLeaveApprovalReply(tenant, buttonId, from);
        await whatsapp.sendText(tenant, from, result.message);
      } else if (/^(approve|reject)_expense_/.test(buttonId)) {
        const result = await handleExpenseApprovalReply(tenant, buttonId, from);
        await whatsapp.sendText(tenant, from, result.message);
      } else if (/^(approve|reject)_task_completion_/.test(buttonId)) {
        const result = await handleTaskCompletionApprovalReply(tenant, buttonId, from);
        await whatsapp.sendText(tenant, from, result.message);
      } else {
        await whatsapp.sendText(tenant, from, "This type of approval isn't supported yet. Please contact your administrator.");
      }
      return;
    }
  } catch (err) {
    logger.error('Error handling incoming webhook message:', err);
  }
});

module.exports = router;
