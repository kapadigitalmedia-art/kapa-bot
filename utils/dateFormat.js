// formatDateLocal — formats a DATE-column value (as returned through
// services/db-mysql.js's pool) as YYYY-MM-DD.
//
// This is NOT the same as "use local getters instead of toISOString()"
// — that first fix looked right in isolation but was still wrong for
// values that actually come from this codebase's real pool. The pool
// (services/db-mysql.js) is created with `timezone: '+08:00'`, which
// tells mysql2 to construct DATE/DATETIME values AS IF interpreted in
// that offset — e.g. a stored 2026-08-07 becomes a JS Date representing
// 2026-08-07T00:00:00+08:00 (= 2026-08-06T16:00:00.000Z). Reading that
// back with getFullYear()/getMonth()/getDate() returns components in
// THIS PROCESS's actual system timezone, not +08:00 — so on any server
// whose system timezone isn't exactly +08:00 (confirmed: Asia/Calcutta,
// +05:30, rolled 2026-08-07 back to 2026-08-06), local getters
// reintroduce the same off-by-one-day bug from a different angle.
//
// The only environment-independent fix is to explicitly reverse the
// pool's known, fixed +08:00 offset via pure UTC math (getUTC*), never
// touching the running process's own system timezone at all.
function formatDateLocal(d) {
  const date = d instanceof Date ? d : new Date(d);
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

module.exports = { formatDateLocal };
