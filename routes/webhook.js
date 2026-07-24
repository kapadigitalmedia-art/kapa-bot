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
  getLowStockItems,
  getExpiringDocuments,
  getLeaveHistoryForEmployee,
} = require('../services/db-mysql');
const logger = require('../utils/logger');
const { formatDateLocal } = require('../utils/dateFormat');
const { handleAdminCommand } = require('../services/adminCommands');
const { handleLeaveApprovalReply, createLeaveRequestWithApproval } = require('../services/leaveApproval');
const { handleExpenseApprovalReply } = require('../services/expenseApproval');
const { handleTaskCompletionApprovalReply } = require('../services/taskCompletion');
const { broadcastNotifyOnly } = require('../services/approvalEngine');
const { getLateReasonSummary } = require('../services/lateReason');
const { sendIndustryPicker, handleIndustrySelection, simulateDemoCheckIn, simulateDemoCheckOut } = require('../services/prospectDemo');
const { sendDineMenu } = require('../services/dineMenu');
const { getPlaceName } = require('../services/geocoding');

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
 * Shared by both trigger paths for starting a check-in/check-out —
 * typing "check in"/"check out" (text handler) and tapping the
 * ✅ Check In/🚪 Check Out buttons (button_reply handler). What
 * triggered it differs; the actual flow (set awaiting_location state,
 * ask for a location share) must not — duplicating this between the
 * two call sites would let them silently drift apart over time.
 */
async function startAttendanceFlow(tenant, from, type) {
  await setConvState(tenant.id, from, { step: 'awaiting_location', data: { type } });
  const label = type === 'in' ? 'check-in' : 'check-out';
  await whatsapp.requestLocation(tenant, from, `📍 Please share your location to confirm ${label}.`);
}

/**
 * record.check_in_time/check_out_time arrive as "HH:MM" (24-hour) —
 * db-mysql.js's formatAttendanceRow slices the raw TIME column's
 * "HH:MM:SS" down to "HH:MM", nothing more. Used in both the check-in
 * and check-out confirmation messages so the same moment is never
 * shown in two different formats across the two messages.
 */
function formatTime12h(time24) {
  if (!time24) return time24;
  const [hStr, mStr] = time24.split(':');
  const h = parseInt(hStr, 10);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mStr} ${period}`;
}

/**
 * "45m" under an hour; "10h 33m" at or past an hour, with the minutes
 * part dropped entirely (not "2h 0m") when there's nothing left over.
 */
function formatMinutesReadable(totalMinutes) {
  const minutes = Math.round(totalMinutes);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`;
}

/**
 * Accepts 'YYYY-MM-DD' or 'DD/MM/YYYY' (also 'DD-MM-YYYY', same
 * separator-agnostic regex) for the leave-application flow's date
 * prompts — real users type dates in either shape depending on habit,
 * and silently accepting one but not the other would just look broken.
 * Rejects impossible calendar dates (e.g. 31 Feb) via a round-trip
 * check against Date.UTC — UTC specifically so this validation can
 * never be affected by the server process's own timezone, the same
 * class of bug already found and fixed elsewhere in this file
 * (utils/dateFormat.js). Returns null on anything invalid, never
 * throws — callers re-prompt rather than crash on bad input.
 */
function parseDateFlexible(input) {
  const str = String(input || '').trim();
  let y, m, d;
  let match = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    [, y, m, d] = match;
  } else {
    match = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (match) {
      [, d, m, y] = match;
    }
  }
  if (!match) return null;

  y = parseInt(y, 10);
  m = parseInt(m, 10);
  d = parseInt(d, 10);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;

  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }

  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Inclusive day count between two 'YYYY-MM-DD' strings (a 1-day leave
 * has startDate === endDate and should count as 1 day, not 0) — built
 * from Date.UTC for the same server-timezone-independence reason as
 * parseDateFlexible.
 */
function daysBetweenInclusive(startDateStr, endDateStr) {
  const [sy, sm, sd] = startDateStr.split('-').map(Number);
  const [ey, em, ed] = endDateStr.split('-').map(Number);
  const start = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  return Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
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
            ? `⚠️ You're ${formatMinutesReadable(record.late_minutes)} late`
            : record.attendance_status;
          // Reverse-geocoded place name is a nice-to-have enrichment,
          // never a requirement — getPlaceName already swallows its own
          // failures and returns null, so a down/unreachable geocoding
          // API just means no location line, not a broken confirmation.
          const checkInPlaceName = await getPlaceName(lat, lng);
          const checkInLocationLine = checkInPlaceName ? `\n📍 Location: ${checkInPlaceName}` : '';
          await whatsapp.sendText(
            tenant,
            from,
            `✅ *Checked In*\n\nTime: ${formatTime12h(record.check_in_time)}\nStatus: ${statusLabel}${checkInLocationLine}`
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
          const checkOutPlaceName = await getPlaceName(lat, lng);
          const checkOutLocationLine = checkOutPlaceName ? `\n📍 Location: ${checkOutPlaceName}` : '';
          await whatsapp.sendText(
            tenant,
            from,
            `✅ *Checked Out*\n\nCheck-In: ${formatTime12h(record.check_in_time)}\nCheck-Out: ${formatTime12h(record.check_out_time)}${checkOutLocationLine}`
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
        // Fetched once, checked against every stateful multi-turn flow
        // below (late-reason report, leave application) — was named
        // lateReasonState back when that was the only such flow; kept
        // generic now that leave application needs the same fetch.
        const convState = await getConvState(tenant.id, from);
        if (convState && convState.step === 'awaiting_late_reason') {
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
              checkinTime: convState.data.checkinTime,
              lateMinutes: formatMinutesReadable(convState.data.lateMinutes),
              reason,
            })
          );
          await whatsapp.sendText(tenant, from, '✅ Reason recorded. Thank you for reporting.');
          return;
        }

        // ── Leave application state machine ──────────────────────────
        // apply_leave (button_reply, below) sets awaiting_leave_type to
        // start this off. Each step re-prompts on invalid input rather
        // than silently accepting garbage or falling through to the
        // menu/check-in keyword checks further down.
        if (convState && convState.step === 'awaiting_leave_type') {
          const LEAVE_TYPE_MAP = {
            '1': 'Annual Leave', 'annual': 'Annual Leave', 'annual leave': 'Annual Leave',
            '2': 'Medical Leave', 'medical': 'Medical Leave', 'medical leave': 'Medical Leave',
            '3': 'Emergency Leave', 'emergency': 'Emergency Leave', 'emergency leave': 'Emergency Leave',
          };
          const leaveType = LEAVE_TYPE_MAP[text];
          if (!leaveType) {
            await whatsapp.sendText(tenant, from, "Sorry, I didn't understand that. Please reply with 1, 2, or 3:\n\n1. Annual Leave\n2. Medical Leave\n3. Emergency Leave");
            return;
          }
          await setConvState(tenant.id, from, { step: 'awaiting_leave_start', data: { leaveType } });
          await whatsapp.sendText(tenant, from, '📅 What is your start date?\n\nFormat: YYYY-MM-DD or DD/MM/YYYY (e.g. 2026-08-01)');
          return;
        }

        if (convState && convState.step === 'awaiting_leave_start') {
          const startDate = parseDateFlexible(message.text.body);
          if (!startDate) {
            await whatsapp.sendText(tenant, from, "That doesn't look like a valid date. Please reply with your start date in YYYY-MM-DD or DD/MM/YYYY format.");
            return;
          }
          await setConvState(tenant.id, from, { step: 'awaiting_leave_end', data: { ...convState.data, startDate } });
          await whatsapp.sendText(tenant, from, '📅 What is your end date?\n\nFormat: YYYY-MM-DD or DD/MM/YYYY');
          return;
        }

        if (convState && convState.step === 'awaiting_leave_end') {
          const endDate = parseDateFlexible(message.text.body);
          if (!endDate) {
            await whatsapp.sendText(tenant, from, "That doesn't look like a valid date. Please reply with your end date in YYYY-MM-DD or DD/MM/YYYY format.");
            return;
          }
          // Plain string comparison is safe here — both sides are
          // zero-padded 'YYYY-MM-DD', so lexicographic order matches
          // chronological order exactly.
          if (endDate < convState.data.startDate) {
            await whatsapp.sendText(tenant, from, `Your end date can't be before your start date (${convState.data.startDate}). Please reply with a valid end date.`);
            return;
          }
          const totalDays = daysBetweenInclusive(convState.data.startDate, endDate);
          await setConvState(tenant.id, from, { step: 'awaiting_leave_reason', data: { ...convState.data, endDate, totalDays } });
          await whatsapp.sendText(tenant, from, '📝 Please provide a reason for your leave:');
          return;
        }

        if (convState && convState.step === 'awaiting_leave_reason') {
          const reason = message.text.body.trim();
          if (!reason) {
            await whatsapp.sendText(tenant, from, 'Please provide a reason for your leave.');
            return;
          }
          await deleteConvState(tenant.id, from);
          const { leaveType, startDate, endDate, totalDays } = convState.data;
          const result = await createLeaveRequestWithApproval(tenant, employee, leaveType, startDate, endDate, totalDays, reason);
          if (!result) {
            await whatsapp.sendText(tenant, from, '❌ Failed to submit your leave request. Please try again or contact your admin.');
            return;
          }
          await whatsapp.sendText(
            tenant,
            from,
            `✅ *Leave Request Submitted*\n\n🏷️ Type: ${leaveType}\n📅 ${startDate} to ${endDate} (${totalDays} day${totalDays === 1 ? '' : 's'})\n📝 Reason: ${reason}\n\nYour request has been sent for approval.`
          );
          return;
        }

        // Looked up once here and reused below by both the 'menu'
        // keyword check and the industry-specific greeting fallback —
        // only 'dine' has either today; every other industry (including
        // 'kapa' itself, which has no bot_trial_signups row at all)
        // leaves industrySlug null and both branches below are simply
        // never reached, same as before this was added.
        const industrySlug = await getIndustryForTenant(tenant.id);

        if (industrySlug === 'dine' && ['menu', 'hi', 'hello', 'hey', 'start'].includes(text)) {
          await sendDineMenu(tenant, from, employee);
          return;
        }

        if (tenant.features.attendance && ['check in', 'checkin', 'check-in'].includes(text)) {
          await startAttendanceFlow(tenant, from, 'in');
          return;
        }
        if (tenant.features.attendance && ['check out', 'checkout', 'check-out'].includes(text)) {
          await startAttendanceFlow(tenant, from, 'out');
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

    // ── 3. List replies — Dine menu selections, or prospect industry picker ──
    if (message.type === 'interactive' && message.interactive?.type === 'list_reply') {
      const listId = message.interactive.list_reply.id;

      // Only a resolved employee (real bot_employees row) could ever have
      // been sent sendDineMenu's list in the first place — a prospect
      // only ever sees the industry picker's 9 rows, which never collide
      // with these ids. Checked here (not gated on industrySlug === 'dine'
      // again) because by this point all that matters is "did this ID
      // come from our own Dine menu", not which industry the tenant is.
      const DINE_MENU_IDS = ['dashboard', 'inventory', 'staff', 'leave', 'foreign_worker_docs', 'checkin', 'my_records'];
      // inventory/foreign_worker_docs/staff all surface tenant-wide data
      // (every employee's low stock, every employee's expiring
      // documents, the full staff directory) — gated to management
      // roles, not just "any resolved employee" like the rest of this
      // menu. checkin (Attendance) and leave stay open to everyone:
      // both are the requester's own personal data/action, not
      // business-wide information. manager is included alongside owner
      // deliberately — a shift manager legitimately needs to see stock
      // levels and the team roster without being the tenant's owner,
      // same 'manager' role already used elsewhere in this codebase
      // (kapa/Asia Avid's own seeded employees).
      const MANAGEMENT_ONLY_IDS = ['inventory', 'foreign_worker_docs', 'staff'];
      const MANAGEMENT_ROLES = ['owner', 'manager'];
      if (DINE_MENU_IDS.includes(listId)) {
        const employee = await getEmployeeByPhone(tenant.id, from);
        if (employee) {
          let reply;
          if (MANAGEMENT_ONLY_IDS.includes(listId) && !MANAGEMENT_ROLES.includes(employee.role)) {
            reply = '🔒 This section is only available to managers/owners. Contact your manager for details.';
          } else if (listId === 'inventory') {
            const lowStock = await getLowStockItems(tenant.id);
            reply = lowStock.length
              ? '📦 *Low Stock Alert*\n\n' + lowStock.map((item) =>
                  `• ${item.item_name}: ${item.current_stock}${item.unit ? ' ' + item.unit : ''} (min: ${item.minimum_stock}${item.unit ? ' ' + item.unit : ''})`
                ).join('\n')
              : '✅ All stock levels are healthy!';
          } else if (listId === 'foreign_worker_docs') {
            const expiring = await getExpiringDocuments(tenant.id, 30);
            reply = expiring.length
              ? '📄 *Expiring Documents*\n\n' + expiring.map((doc) => {
                  const expiryStr = formatDateLocal(doc.expiry_date);
                  const label = doc.status === 'expired' ? 'EXPIRED' : 'expiring soon';
                  return `• ${doc.employee_name} — ${doc.document_type} expires ${expiryStr} (${label})`;
                }).join('\n')
              : '✅ No documents expiring in the next 30 days!';
          } else if (listId === 'checkin') {
            // A real interactive prompt, not a plain-text reply — can't
            // join the shared `reply` var below, which only ever sends
            // whatsapp.sendText.
            await whatsapp.sendButtons(tenant, from, '📋 Attendance\n\nWhat would you like to do?', [
              { id: 'checkin', title: '✅ Check In' },
              { id: 'checkout', title: '🚪 Check Out' },
            ]);
            return;
          } else if (listId === 'leave') {
            // Same reasoning as checkin above — a real interactive
            // prompt, handled outside the shared `reply` var.
            await whatsapp.sendButtons(tenant, from, '📅 Leave Management\n\nWhat would you like to do?', [
              { id: 'apply_leave', title: '📝 Apply for Leave' },
              { id: 'leave_history', title: '📋 My Leave History' },
            ]);
            return;
          } else {
            // dashboard/staff/my_records — none of these have a real
            // WhatsApp-native flow yet, so this is an honest
            // placeholder, not a fake success reply.
            reply = '📊 View this in your Kapa Hub dashboard: [link]';
          }
          await whatsapp.sendText(tenant, from, reply);
          return;
        }
      }

      const result = handleIndustrySelection(listId);
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
      // checkin/checkout tap — identical flow to typing 'check in'/
      // 'check out' in the text handler (both call startAttendanceFlow),
      // just a different trigger. Checked ahead of the approve_/reject_
      // regexes since these ids never collide with that naming pattern.
      if (buttonId === 'checkin') {
        await startAttendanceFlow(tenant, from, 'in');
        return;
      }
      if (buttonId === 'checkout') {
        await startAttendanceFlow(tenant, from, 'out');
        return;
      }

      // apply_leave/leave_history — same reasoning as checkin/checkout:
      // checked ahead of the approve_/reject_ regexes, no collision
      // risk with that naming pattern.
      if (buttonId === 'apply_leave') {
        await setConvState(tenant.id, from, { step: 'awaiting_leave_type', data: {} });
        await whatsapp.sendText(tenant, from, 'What type of leave would you like to apply for?\n\n1. Annual Leave\n2. Medical Leave\n3. Emergency Leave\n\nReply with the type.');
        return;
      }
      if (buttonId === 'leave_history') {
        const employee = await getEmployeeByPhone(tenant.id, from);
        if (!employee) {
          await whatsapp.sendText(tenant, from, "We couldn't find your employee record. Please contact your admin.");
          return;
        }
        const history = await getLeaveHistoryForEmployee(tenant.id, employee.id);
        const reply = history.length
          ? '📋 *Your Leave History*\n\n' + history.map((h) =>
              `• ${h.leave_type}: ${h.start_date} to ${h.end_date} (${h.total_days} day${h.total_days === 1 ? '' : 's'}) — ${h.approval_status}`
            ).join('\n')
          : "You haven't submitted any leave requests yet.";
        await whatsapp.sendText(tenant, from, reply);
        return;
      }

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
