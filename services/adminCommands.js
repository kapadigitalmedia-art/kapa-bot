const db = require('./db');
const config = require('../config/config');
const logger = require('../utils/logger');

/**
 * This is the "brain" of the Admin Dashboard-via-WhatsApp feature.
 * An admin sends a plain-text command on WhatsApp; this function figures
 * out what they're asking for and returns the reply text.
 *
 * Everything here currently reads from the bot's own local data (leads,
 * attendance, errors, subscriptions it has recorded itself). To pull real
 * live figures from KAPA HUB / KAPA ONE, wire them into the marked
 * TODO sections below using config.kapaHub.baseUrl + config.kapaHub.apiKey.
 */

function todayStr() {
  return new Date().toISOString().substring(0, 10);
}

async function handleAdminCommand(rawText) {
  const text = (rawText || '').trim().toLowerCase();

  if (text === 'help' || text === 'menu' || text === '?') {
    return (
      '🤖 *KAPA Admin Commands*\n\n' +
      '• today sales\n' +
      '• pending approvals\n' +
      '• today attendance\n' +
      '• new leads\n' +
      '• system status\n' +
      '• help'
    );
  }

  if (text.includes('attendance')) {
    const records = db
      .get('attendance')
      .filter((r) => r.timestamp.startsWith(todayStr()))
      .value();
    const checkIns = records.filter((r) => r.type === 'in').length;
    const checkOuts = records.filter((r) => r.type === 'out').length;
    return (
      `📋 *Today's Attendance*\n\n` +
      `Check-ins: ${checkIns}\n` +
      `Check-outs: ${checkOuts}\n` +
      `Total events: ${records.length}`
    );
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
    // TODO: replace this block with a real call to your KAPA HUB API, e.g.:
    //   const res = await axios.get(`${config.kapaHub.baseUrl}/reports/today-sales`, {
    //     headers: { Authorization: `Bearer ${config.kapaHub.apiKey}` }
    //   });
    //   return `💰 Today's Sales: RM ${res.data.total}`;
    return '💰 *Today\'s Sales*\n\n⚠️ Not connected to KAPA HUB yet — this is placeholder data.\nWire this up in services/adminCommands.js';
  }

  if (text.includes('approval')) {
    // TODO: same idea — connect to your real approvals queue
    return '📝 *Pending Approvals*\n\n⚠️ Not connected to KAPA HUB yet — this is placeholder data.\nWire this up in services/adminCommands.js';
  }

  return `🤖 I didn't understand that. Type *help* to see available commands.`;
}

module.exports = { handleAdminCommand };
