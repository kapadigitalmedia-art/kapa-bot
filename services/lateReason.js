// Summary formatter for the late_reason notify-only broadcast — no DB
// lookup, matches services/taskLateArrival.js's pattern (data passed
// directly, since there's no persisted request record for a notify-only
// type — see that file's header comment for why).

function getLateReasonSummary(tenantId, requestType, data) {
  return `⏰ Late Check-in Report\n\n👤 Employee: ${data.employeeName}\n🕐 Check-in Time: ${data.checkinTime}\n⏱️ Late by: ${data.lateMinutes} min\n📝 Reason: ${data.reason}`;
}

module.exports = { getLateReasonSummary };
