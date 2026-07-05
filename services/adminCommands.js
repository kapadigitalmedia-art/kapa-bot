const { tenantDb } = require('./db');

/**
 * The "brain" of the Admin Dashboard-via-WhatsApp feature, scoped per
 * tenant so each customer's admins only ever see their own company's data.
 *
 * To pull real live figures from a tenant's own backend (e.g. KAPA HUB),
 * wire it into the marked TODO sections below, keyed by tenant.id.
 */

function todayStr() {
  return new Date().toISOString().substring(0, 10);
}

async function handleAdminCommand(tenant, rawText) {
  const text = (rawText || '').trim().toLowerCase();
  const db = tenantDb(tenant.id);

  if (text === 'help' || text === 'menu' || text === '?') {
    return (
      `🤖 *${tenant.name} — Admin Commands*\n\n` +
      '• today sales\n' +
      '• pending approvals\n' +
      '• today attendance\n' +
      '• new leads\n' +
      '• system status\n' +
      '• help'
    );
  }

  if (text.includes('attendance')) {
    const records = db.get('attendance').filter((r) => r.timestamp.startsWith(todayStr())).value();
    const checkIns = records.filter((r) => r.type === 'in').length;
    const checkOuts = records.filter((r) => r.type === 'out').length;
    return `📋 *Today's Attendance*\n\nCheck-ins: ${checkIns}\nCheck-outs: ${checkOuts}\nTotal events: ${records.length}`;
  }

  if (text.includes('lead')) {
    const leads = db.get('leads').takeRight(5).reverse().value();
    if (leads.length === 0) return '📋 No leads recorded yet.';
    const lines = leads.map(
      (l) => `• ${l.company_name || 'Unknown'} — ${l.plan || 'N/A'} plan (${new Date(l.submittedAt).toLocaleDateString()})`
    );
    return `📋 *Last ${leads.length} Leads*\n\n` + lines.join('\n');
  }

  if (text.includes('error') || text.includes('status')) {
    const errors = db.get('errors').takeRight(5).reverse().value();
    if (errors.length === 0) return '✅ *System Status*\n\nNo errors reported recently. All clear!';
    const lines = errors.map((e) => `• [${e.severity}] ${e.source}: ${e.message}`);
    return `⚠️ *Recent System Alerts*\n\n` + lines.join('\n');
  }

  if (text.includes('sales') || text.includes('revenue')) {
    // TODO: connect to this tenant's real backend, e.g.:
    //   const res = await axios.get(`${tenant.hubApiBaseUrl}/reports/today-sales`, {
    //     headers: { Authorization: `Bearer ${tenant.hubApiKey}` }
    //   });
    return `💰 *Today's Sales*\n\n⚠️ Not connected to ${tenant.name}'s backend yet — placeholder data.`;
  }

  if (text.includes('approval')) {
    // TODO: same idea — connect to this tenant's real approvals queue
    return `📝 *Pending Approvals*\n\n⚠️ Not connected to ${tenant.name}'s backend yet — placeholder data.`;
  }

  return `🤖 I didn't understand that. Type *help* to see available commands.`;
}

module.exports = { handleAdminCommand };
