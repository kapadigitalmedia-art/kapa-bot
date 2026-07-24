// Summary formatter for the late_reason notify-only broadcast — no DB
// lookup, matches services/taskLateArrival.js's pattern (data passed
// directly, since there's no persisted request record for a notify-only
// type — see that file's header comment for why).

// data.lateMinutes arrives already formatted (e.g. "45m"/"2h 15m") via
// routes/webhook.js's formatMinutesReadable — not a raw number, so no
// trailing unit here.
function getLateReasonSummary(tenantId, requestType, data) {
  return `⏰ Late Check-in Report\n\n👤 Employee: ${data.employeeName}\n🕐 Check-in Time: ${data.checkinTime}\n⏱️ Late by: ${data.lateMinutes}\n📝 Reason: ${data.reason}`;
}

module.exports = { getLateReasonSummary };
