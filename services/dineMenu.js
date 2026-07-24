// Dine-specific main menu — a WhatsApp LIST message (not buttons; 5
// rows and buttons cap at 3).
//
// Same 5 rows for every employee regardless of role — a deliberate
// simplification over the earlier owner-vs-staff split (owner saw
// dashboard/inventory/staff/leave/foreign_worker_docs; non-owners saw
// only checkin/leave/my_records, specifically BECAUSE
// inventory/staff/foreign_worker_docs surface tenant-wide data, not
// just the requester's own). That role check no longer happens here.
// routes/webhook.js's list_reply handler doesn't gate those ids by
// role either — it only checks that the sender resolves to SOME
// employee — so a non-owner staff member tapping Inventory/Foreign
// Worker Docs/Staff now sees the same tenant-wide data an owner would.
// Flagging this plainly since it's a real behavior change, not
// something to silently reconcile here.
//
// Row ids are unchanged from before (checkin/leave/inventory/
// foreign_worker_docs/staff) so routes/webhook.js's existing
// DINE_MENU_IDS list_reply handling needs no changes — 'dashboard' and
// 'my_records' simply stop being sent.

const whatsapp = require('./whatsapp');
const { getEmployeeWithTenantName } = require('./db-mysql');

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Same Asia/Kuala_Lumpur wall-clock-time-of-day pattern already used
// elsewhere in this codebase (e.g. kapa-attendance-bot's sendMainMenu
// greeting) — constructing a real Date via toLocaleString's timeZone
// option rather than reading the server process's own local time,
// which may not be Malaysia's.
function getGreetingWord() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }));
  const hour = now.getHours();
  return hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';
}

/**
 * tenant.name (from the merged tenant object resolveTenantForMessage
 * builds) is sourced from bot_trial_signups.company_name — correct,
 * but a second, independent source of the same fact from a different
 * table (bot_tenants.tenant_name, via getEmployeeWithTenantName, the
 * same join built for the Hub's GET /me) is used here instead, per
 * this turn's explicit ask, so the WhatsApp greeting and the Hub
 * dashboard display the identical business name from the identical
 * query — not two independently-maintained copies of it.
 */
async function sendDineMenu(tenant, to, employee) {
  const me = await getEmployeeWithTenantName(tenant.id, employee.id);
  const fullName = me?.full_name || employee.full_name || 'there';
  const role = me?.role || employee.role || '';
  const tenantName = me?.tenant_name || tenant.name;

  const bodyText = `👋 Good ${getGreetingWord()}, ${fullName}!\nWelcome to KAPA ONE Dine.\n\n🏪 Restaurant: ${tenantName}\n👤 Role: ${capitalize(role)}\n\nTap an option below to continue:`;

  const rows = [
    { id: 'checkin', title: '✅ Attendance', description: 'Check in / check out' },
    { id: 'leave', title: '🌴 Leave', description: 'Apply or view leave requests' },
    { id: 'inventory', title: '📦 Inventory', description: 'Check stock levels & low-stock alerts' },
    { id: 'foreign_worker_docs', title: '📄 Foreign Worker Docs', description: 'Passport/visa/permit expiry status' },
    { id: 'staff', title: '👥 Staff', description: 'View your team' },
  ];

  const sections = [{ title: 'Menu', rows }];

  return whatsapp.sendList(tenant, to, bodyText, 'Choose Option', sections);
}

module.exports = { sendDineMenu };
