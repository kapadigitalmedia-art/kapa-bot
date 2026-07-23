// Dine-specific main menu — a WhatsApp LIST message (not buttons; the
// owner variant has 5 rows and buttons cap at 3, so list is used for
// both variants rather than switching message type by role).
//
// Row set depends on employee.role: an owner gets management-facing
// rows (dashboard/inventory/staff/leave/foreign_worker_docs) a regular
// staff member has no business seeing, since those surface tenant-wide
// data (every employee's low stock, every employee's expiring
// documents) rather than the requester's own. Non-owners get a smaller,
// self-service set (checkin/leave/my_records) — same names where they
// overlap conceptually (leave), but scoped differently by
// routes/webhook.js's list_reply handler, not by this function.

const whatsapp = require('./whatsapp');

async function sendDineMenu(tenant, to, employee) {
  const isOwner = employee?.role === 'owner';

  const rows = isOwner
    ? [
        { id: 'dashboard', title: '📊 Dashboard', description: 'View your Kapa Hub dashboard' },
        { id: 'inventory', title: '📦 Inventory', description: 'Check stock levels & low-stock alerts' },
        { id: 'staff', title: '👥 Staff', description: 'Manage your team' },
        { id: 'leave', title: '🌴 Leave', description: 'View & manage leave requests' },
        { id: 'foreign_worker_docs', title: '📄 Worker Documents', description: 'Passport/visa/permit expiry status' },
      ]
    : [
        { id: 'checkin', title: '✅ Check In/Out', description: 'Track your attendance' },
        { id: 'leave', title: '🌴 Apply Leave', description: 'Request time off' },
        { id: 'my_records', title: '📋 My Records', description: 'View your attendance history' },
      ];

  const sections = [{ title: 'Menu', rows }];

  return whatsapp.sendList(
    tenant,
    to,
    `👋 KAPA ONE Dine — ${tenant.name}\n\nWhat would you like to do?`,
    'Choose Option',
    sections
  );
}

module.exports = { sendDineMenu };
