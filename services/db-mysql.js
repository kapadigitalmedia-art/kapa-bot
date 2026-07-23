// KAPA Bot — MySQL data layer (parallel to services/db.js / lowdb).
//
// Mirrors the tenantDb(tenantId).get(collection)... chain shape the 8
// existing lowdb call sites use, so migrating a call site later is a
// matter of adding `await` — not restructuring. Every query is scoped by
// tenant_id, replacing the per-tenant JSON file scoping lowdb did.
//
// NOT required by any route yet. services/db.js (lowdb) remains the live
// data layer until call sites are migrated deliberately, one at a time.
// See migrations/001_create_bot_tables.sql for the table definitions this
// module assumes exist.

const mysql = require('mysql2/promise');
const crypto = require('crypto');

// Same env var names as kapa-attendance-bot's db.js, since this is the same
// Railway database. Unlike that file, there's no hardcoded fallback
// password here — this repo shouldn't carry a copy of that secret, so
// MYSQL_PASSWORD must be set in .env for this module to connect.
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'hayabusa.proxy.rlwy.net',
  port: process.env.MYSQL_PORT || 42047,
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE || 'railway',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 10000,
  timezone: '+08:00',
});

pool
  .getConnection()
  .then((conn) => {
    console.log('✅ MySQL connected (Railway) — kapa-bot');
    conn.release();
  })
  .catch((err) => {
    console.error('❌ MySQL connection error:', err.message);
  });

// Maps the lowdb collection name used at call sites to its bot_* table and
// the DATETIME column that collection's ISO "timestamp" field maps to.
const COLLECTIONS = {
  attendance: { table: 'bot_attendance', timeCol: 'recorded_at' },
  leads: { table: 'bot_leads', timeCol: 'submitted_at' },
  errors: { table: 'bot_errors', timeCol: 'reported_at' },
  subscriptions: { table: 'bot_subscription_events', timeCol: 'occurred_at' },
};

// Renames lowdb-style record keys to SQL columns and stamps tenant_id,
// ahead of an INSERT.
function toRow(collection, tenantId, record) {
  switch (collection) {
    case 'attendance':
      return {
        tenant_id: tenantId,
        phone: record.phone,
        name: record.name ?? null,
        type: record.type,
        lat: record.lat ?? null,
        lng: record.lng ?? null,
        recorded_at: new Date(record.timestamp),
      };
    case 'leads':
      return {
        tenant_id: tenantId,
        full_name: record.full_name ?? null,
        company_name: record.company_name ?? null,
        email: record.email ?? null,
        phone: record.phone ?? null,
        plan: record.plan ?? null,
        plan_price: record.plan_price ?? null,
        whatsapp_sent: !!record.whatsappSent,
        submitted_at: new Date(record.submittedAt),
      };
    case 'errors':
      return {
        tenant_id: tenantId,
        source: record.source,
        message: record.message,
        severity: record.severity,
        reported_at: new Date(record.timestamp),
      };
    case 'subscriptions':
      return {
        tenant_id: tenantId,
        company: record.company ?? null,
        event: record.event,
        plan: record.plan ?? null,
        amount: record.amount ?? null,
        occurred_at: new Date(record.timestamp),
      };
    default:
      throw new Error(`toRow: unknown collection "${collection}"`);
  }
}

// Converts a SQL row back into the same shape the original lowdb record
// had, so downstream code (e.g. `r.timestamp.startsWith(...)` in
// attendance.js) keeps working unchanged.
function rowToRecord(collection, row) {
  const { timeCol } = COLLECTIONS[collection];
  const raw = row[timeCol];
  const timestamp = raw instanceof Date ? raw.toISOString() : raw;
  switch (collection) {
    case 'attendance':
      return { phone: row.phone, name: row.name, type: row.type, timestamp, lat: row.lat, lng: row.lng };
    case 'leads':
      return {
        full_name: row.full_name,
        company_name: row.company_name,
        email: row.email,
        phone: row.phone,
        plan: row.plan,
        plan_price: row.plan_price,
        submittedAt: timestamp,
        whatsappSent: !!row.whatsapp_sent,
      };
    case 'errors':
      return { source: row.source, message: row.message, severity: row.severity, timestamp };
    case 'subscriptions':
      // bot_subscription_events.amount is DECIMAL, which mysql2 returns as
      // a string by default — cast back to a number (preserving null) so
      // this matches the original lowdb record's type exactly.
      return {
        company: row.company,
        event: row.event,
        plan: row.plan,
        amount: row.amount === null ? null : Number(row.amount),
        timestamp,
      };
    default:
      return row;
  }
}

async function insertRow(collection, tenantId, record) {
  const { table } = COLLECTIONS[collection];
  const row = toRow(collection, tenantId, record);
  const cols = Object.keys(row);
  const placeholders = cols.map(() => '?').join(', ');
  const [result] = await pool.execute(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`,
    cols.map((c) => row[c])
  );
  return { id: result.insertId, ...record };
}

async function allRows(collection, tenantId) {
  const { table } = COLLECTIONS[collection];
  const [rows] = await pool.query(`SELECT * FROM ${table} WHERE tenant_id = ? ORDER BY id ASC`, [tenantId]);
  return rows;
}

async function recentRows(collection, tenantId, n) {
  const { table } = COLLECTIONS[collection];
  const [rows] = await pool.query(`SELECT * FROM ${table} WHERE tenant_id = ? ORDER BY id DESC LIMIT ?`, [
    tenantId,
    n,
  ]);
  return rows; // already most-recent-first, matching .takeRight(n).reverse()
}

/**
 * conversationState isn't an append-only log like the other four
 * collections — it's ephemeral, request-scoped state (set on "check in",
 * read + deleted the instant the location arrives), so it gets a plain
 * get/set/delete API instead of being forced into the push/filter/
 * takeRight chain shape below. See migrations/001_create_bot_tables.sql
 * for bot_conversation_state's schema (composite PK: tenant_id, phone).
 */
async function getConversationState(tenantId, phone) {
  const [rows] = await pool.query('SELECT step, data FROM bot_conversation_state WHERE tenant_id = ? AND phone = ?', [
    tenantId,
    phone,
  ]);
  if (!rows.length) return undefined;
  return { step: rows[0].step, data: rows[0].data };
}

async function setConversationState(tenantId, phone, value) {
  await pool.execute(
    `INSERT INTO bot_conversation_state (tenant_id, phone, step, data)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE step = VALUES(step), data = VALUES(data)`,
    [tenantId, phone, value.step, JSON.stringify(value.data ?? null)]
  );
}

async function deleteConversationState(tenantId, phone) {
  await pool.execute('DELETE FROM bot_conversation_state WHERE tenant_id = ? AND phone = ?', [tenantId, phone]);
}

/**
 * Employee lookup by WhatsApp number — the missing link between an
 * incoming message ("this text is from +60...") and the employeeId/
 * employee object every other function in this file (createCheckIn,
 * createLeaveRequest, createTask, calculatePayroll, ...) expects.
 * Cleans BOTH the input and the stored column via the same
 * REPLACE(REPLACE(REPLACE(...))) pattern isEmployeeOnLeave uses below,
 * not just the input — stored numbers aren't guaranteed to be in the
 * same clean format an incoming message's `from` field arrives in.
 */
async function getEmployeeByPhone(tenantId, whatsappNumber) {
  const clean = String(whatsappNumber || '').replace(/[\s\+\-]/g, '');
  const [rows] = await pool.query(
    `SELECT * FROM bot_employees
     WHERE tenant_id = ? AND is_active = TRUE
       AND REPLACE(REPLACE(REPLACE(whatsapp_number,'+',''),'-',''),' ','') = ?`,
    [tenantId, clean]
  );
  return rows[0] || null;
}

/**
 * Cross-tenant employee lookup by phone number — used to resolve a
 * shared-number sender who is a real employee of some trial tenant
 * OTHER than the one they originally signed up under (or an employee
 * added to a trial tenant after the fact, who never appears in
 * bot_trial_signups at all — that table only ever has the original
 * signer's number). Returns EVERY match, not just one, so the caller
 * can detect and refuse an ambiguous cross-tenant collision
 * (whatsapp_number is only unique per-tenant, per uq_tenant_whatsapp —
 * not globally) rather than silently picking a winner.
 */
async function getEmployeeByPhoneAnyTenant(whatsappNumber) {
  const clean = String(whatsappNumber || '').replace(/[\s\+\-]/g, '');
  const [rows] = await pool.query(
    `SELECT * FROM bot_employees
     WHERE is_active = TRUE
       AND REPLACE(REPLACE(REPLACE(whatsapp_number,'+',''),'-',''),' ','') = ?`,
    [clean]
  );
  return rows;
}

/**
 * bot_tenants.tenant_name for a resolved tenant_id — needed specifically
 * for the cross-tenant employee match above, since a bot_employees row
 * carries no company-name field of its own (unlike the trial-signup
 * path, which gets it from bot_trial_signups.company_name). Without
 * this, tenant.name would fall back to the raw tenant_id UUID in the
 * generic greeting.
 */
async function getTenantNameById(tenantId) {
  const [rows] = await pool.query(
    'SELECT tenant_name FROM bot_tenants WHERE tenant_id = ?',
    [tenantId]
  );
  return rows.length ? rows[0].tenant_name : null;
}

/**
 * Attendance (bot_employee_attendance) — like conversationState above,
 * this doesn't fit the push/filter/takeRight log-collection shape either:
 * it needs upsert-by-(tenant, employee, date), a targeted UPDATE, and a
 * date-range lookup, none of which the tenantDb() chain below supports.
 * Plain async functions instead, following the same precedent.
 *
 * All three TIME columns (check_in_time/check_out_time/
 * checkin_attempt_time) come back from mysql2 as "HH:MM:SS" strings —
 * formatAttendanceRow() trims them to "HH:MM" to match the shape the
 * rest of the system (ported from kapa-attendance-bot's VARCHAR(10)
 * columns) expects.
 */
function nowInKualaLumpur() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }));
}

function toDateStr(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

function toHoursMinutes(date) {
  return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
}

function formatAttendanceRow(row) {
  if (!row) return null;
  return {
    ...row,
    check_in_time: row.check_in_time ? row.check_in_time.slice(0, 5) : null,
    check_out_time: row.check_out_time ? row.check_out_time.slice(0, 5) : null,
    checkin_attempt_time: row.checkin_attempt_time ? row.checkin_attempt_time.slice(0, 5) : null,
  };
}

/**
 * Looks up the employee's shift_start, computes lateMinutes/status the
 * same way kapa-attendance-bot's createCheckIn does (Asia/Kuala_Lumpur
 * wall-clock time vs. shift_start), then upserts today's row. Returns
 * null if employeeId doesn't belong to tenantId.
 */
async function createCheckIn(tenantId, employeeId, lat, lng) {
  const [empRows] = await pool.query(
    'SELECT full_name, whatsapp_number, shift_start FROM bot_employees WHERE id = ? AND tenant_id = ?',
    [employeeId, tenantId]
  );
  if (!empRows.length) return null;
  const employee = empRows[0];

  const now = nowInKualaLumpur();
  const dateStr = toDateStr(now);
  const timeStr = toHoursMinutes(now);

  const shiftParts = String(employee.shift_start || '08:30:00').split(':');
  const shiftMins = parseInt(shiftParts[0] || 8, 10) * 60 + parseInt(shiftParts[1] || 30, 10);
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const lateMinutes = nowMins > shiftMins ? nowMins - shiftMins : 0;
  const status = lateMinutes > 0 ? 'Late' : 'Present';

  await pool.execute(
    `INSERT INTO bot_employee_attendance
       (tenant_id, employee_id, employee_name, whatsapp_number, attendance_date,
        check_in_time, check_in_latitude, check_in_longitude, attendance_status, late_minutes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       check_in_time = VALUES(check_in_time),
       check_in_latitude = VALUES(check_in_latitude),
       check_in_longitude = VALUES(check_in_longitude),
       attendance_status = VALUES(attendance_status),
       late_minutes = VALUES(late_minutes)`,
    [tenantId, employeeId, employee.full_name, employee.whatsapp_number, dateStr, timeStr, lat ?? null, lng ?? null, status, lateMinutes]
  );

  return getTodayAttendance(tenantId, employeeId);
}

/**
 * Returns null (rather than throwing) if there's no check-in row for
 * today to check out against — mirrors createCheckIn's "not found"
 * signal shape.
 */
async function updateCheckOut(tenantId, employeeId, lat, lng) {
  const now = nowInKualaLumpur();
  const dateStr = toDateStr(now);
  const timeStr = toHoursMinutes(now);

  const [result] = await pool.execute(
    `UPDATE bot_employee_attendance
     SET check_out_time = ?, check_out_latitude = ?, check_out_longitude = ?
     WHERE tenant_id = ? AND employee_id = ? AND attendance_date = ?`,
    [timeStr, lat ?? null, lng ?? null, tenantId, employeeId, dateStr]
  );
  if (result.affectedRows === 0) return null;
  return getTodayAttendance(tenantId, employeeId);
}

async function getTodayAttendance(tenantId, employeeId) {
  const dateStr = toDateStr(nowInKualaLumpur());
  const [rows] = await pool.query(
    'SELECT * FROM bot_employee_attendance WHERE tenant_id = ? AND employee_id = ? AND attendance_date = ?',
    [tenantId, employeeId, dateStr]
  );
  return formatAttendanceRow(rows[0]);
}

/**
 * month is 1-12 (not the source's 3-letter-name format). End-of-month day
 * is computed via `new Date(year, month, 0)` rather than the source's
 * hardcoded "-31", since that's an existing latent imprecision in
 * kapa-attendance-bot (months with fewer than 31 days get an invalid
 * date-string upper bound) not worth reproducing here.
 */
async function getMonthAttendance(tenantId, employeeId, year, month) {
  const monthStr = String(month).padStart(2, '0');
  const dateFrom = `${year}-${monthStr}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const dateTo = `${year}-${monthStr}-${String(lastDay).padStart(2, '0')}`;

  const [rows] = await pool.query(
    `SELECT * FROM bot_employee_attendance
     WHERE tenant_id = ? AND employee_id = ? AND attendance_date BETWEEN ? AND ?
     ORDER BY attendance_date`,
    [tenantId, employeeId, dateFrom, dateTo]
  );
  return rows.map(formatAttendanceRow);
}

/**
 * Rolls up one employee's attendance for a single month into summary
 * stats. Reuses getMonthAttendance for the raw rows and
 * getWorkingDaysInMonth (defined further below in this file — safe to
 * call here regardless of declaration order, since `function`
 * declarations are hoisted module-wide) for the denominator, rather than
 * recomputing either.
 *
 * "Present" is judged the same way calculatePayroll already does
 * (attendance_status is 'Present' or 'Late' — both mean the employee
 * showed up, just not always on time), not merely "row exists for this
 * date", so the definition stays consistent with the one other place in
 * this file that already answers "was this employee present" from this
 * table.
 *
 * attendance_rate is present_days / working_days_in_month, rounded to 1
 * decimal and expressed as a 0-100 percentage (e.g. 83.3), since this is
 * a human-facing summary, not a raw fraction. average_late_minutes is 0
 * (not NaN) when the employee was never late, rather than dividing by a
 * zero total_days_late.
 */
async function getEmployeePerformanceSummary(tenantId, employeeId, month, year) {
  const attendances = await getMonthAttendance(tenantId, employeeId, year, month);

  let totalDaysPresent = 0;
  let totalDaysLate = 0;
  let totalLateMinutes = 0;

  for (const att of attendances) {
    const status = String(att.attendance_status || '').toLowerCase();
    if (['present', 'late'].includes(status)) totalDaysPresent++;

    const lateMin = parseFloat(att.late_minutes || 0);
    if (lateMin > 0) {
      totalDaysLate++;
      totalLateMinutes += lateMin;
    }
  }

  const workingDays = getWorkingDaysInMonth(month, year);
  const averageLateMinutes = totalDaysLate > 0
    ? Math.round((totalLateMinutes / totalDaysLate) * 10) / 10
    : 0;
  const attendanceRate = workingDays > 0
    ? Math.round((totalDaysPresent / workingDays) * 1000) / 10
    : 0;

  return {
    tenant_id: tenantId,
    employee_id: employeeId,
    month,
    year,
    total_days_present: totalDaysPresent,
    total_days_late: totalDaysLate,
    total_late_minutes: totalLateMinutes,
    average_late_minutes: averageLateMinutes,
    working_days: workingDays,
    attendance_rate: attendanceRate,
  };
}

/**
 * Leave requests (bot_leave_requests) — plain async functions, same
 * precedent as attendance above. Deliberately does NOT compute
 * first_approver here (the source's getLeaveFirstApprover per-employee
 * hardcoded routing) — that's Tier 3 approval-chain work deferred per
 * migration 010's header comment, left null until bot_approval_chains
 * integration happens.
 */

/**
 * "Emergency Leave" is remapped to "Unpaid Leave" before it's stored —
 * same as the source — but only for the DB write; the caller's original
 * leaveType is never touched, only what lands in the database changes.
 */
async function createLeaveRequest(tenantId, employee, leaveType, startDate, endDate, totalDays, reason) {
  try {
    const dbLeaveType = leaveType === 'Emergency Leave' ? 'Unpaid Leave' : leaveType;

    const [result] = await pool.execute(
      `INSERT INTO bot_leave_requests
         (tenant_id, employee_id, employee_name, whatsapp_number, leave_type,
          start_date, end_date, total_days, reason, first_approver)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, employee.id, employee.full_name, employee.whatsapp_number, dbLeaveType,
       startDate, endDate, totalDays || 1, reason, null]
    );
    const insertId = result.insertId;

    // must check === null/undefined explicitly — String(null) is truthy, which
    // caused a real production incident where a leave request never reached
    // the DB but the bot reported success anyway
    if (insertId === null || insertId === undefined) {
      return null;
    }

    return { id: insertId };
  } catch (err) {
    return null;
  }
}

async function updateLeaveStatus(tenantId, recordId, status, approvedBy) {
  const [result] = await pool.execute(
    `UPDATE bot_leave_requests SET approval_status = ?, approved_by = ?, approved_at = NOW()
     WHERE id = ? AND tenant_id = ?`,
    [status, approvedBy || null, recordId, tenantId]
  );
  return result.affectedRows > 0;
}

/**
 * whatsappNumber is stripped of spaces/+/- before comparing, matching
 * the source's REPLACE(REPLACE(REPLACE(...))) chain — done on both
 * sides so inconsistently-formatted stored numbers still match.
 */
async function isEmployeeOnLeave(tenantId, whatsappNumber) {
  const clean = String(whatsappNumber || '').replace(/[\s\+\-]/g, '');
  const dateStr = toDateStr(nowInKualaLumpur());
  const [rows] = await pool.query(
    `SELECT * FROM bot_leave_requests
     WHERE REPLACE(REPLACE(REPLACE(whatsapp_number,'+',''),'-',''),' ','') = ?
       AND approval_status = 'Approved' AND start_date <= ? AND end_date >= ? AND tenant_id = ?`,
    [clean, dateStr, dateStr, tenantId]
  );
  return rows.length > 0;
}

async function isEmployeeOnLeaveOnDate(tenantId, whatsappNumber, dateStr) {
  const clean = String(whatsappNumber || '').replace(/[\s\+\-]/g, '');
  if (!dateStr) return false;
  const [rows] = await pool.query(
    `SELECT * FROM bot_leave_requests
     WHERE REPLACE(REPLACE(REPLACE(whatsapp_number,'+',''),'-',''),' ','') = ?
       AND approval_status = 'Approved' AND start_date <= ? AND end_date >= ? AND tenant_id = ?`,
    [clean, dateStr, dateStr, tenantId]
  );
  return rows.length > 0;
}

/**
 * Matches the getRequestSummaryFn(tenantId, requestType, recordId)
 * contract services/approvalEngine.js expects. Uses DATE_FORMAT in SQL
 * rather than formatting start_date/end_date on the JS side — mysql2
 * returns DATE columns as JS Date objects by default, and converting
 * those to strings client-side (e.g. toISOString()) re-introduces the
 * exact UTC-offset date-shifting artifact seen earlier this session
 * (a stored "2026-08-01" displaying as "2026-07-31T18:30:00.000Z").
 * DATE_FORMAT sidesteps it entirely by never producing a JS Date at all.
 */
async function getLeaveRequestSummary(tenantId, requestType, recordId) {
  const [rows] = await pool.query(
    `SELECT employee_name, leave_type, reason, total_days,
            DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date_fmt,
            DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date_fmt
     FROM bot_leave_requests WHERE id = ? AND tenant_id = ?`,
    [recordId, tenantId]
  );
  if (!rows.length) return 'Leave request details unavailable.';
  const leave = rows[0];
  return `📋 Leave Request\n\n👤 ${leave.employee_name || 'Employee'}\n📅 ${leave.start_date_fmt} to ${leave.end_date_fmt} (${leave.total_days} day(s))\n🏷️ ${leave.leave_type}\n📝 ${leave.reason || '-'}`;
}

/**
 * Expense claims (bot_expense_claims) — plain async functions, same
 * precedent as leave above.
 */

/**
 * applying the same defensive check discovered necessary for leave requests -
 * this class of bug (truthy-but-invalid insertId) could affect any INSERT.
 * The source's expense_claims INSERT never had this check at all — unlike
 * leave requests, which got it after the documented Sharifah incident —
 * db.js's createExpenseClaim wraps result.insertId into { id: ... }
 * unconditionally, and index.js's wrapper only checks the returned object
 * itself is truthy, never that .id is a real value. Fixing it here even
 * though the source never caught it for expenses.
 */
async function createExpenseClaim(tenantId, employee, expenseType, amount, expenseDate, description, receiptUrl) {
  try {
    const [result] = await pool.execute(
      `INSERT INTO bot_expense_claims
         (tenant_id, employee_id, employee_name, whatsapp_number, expense_type, amount, expense_date, description, receipt_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, employee.id, employee.full_name, employee.whatsapp_number, expenseType, amount || 0, expenseDate || null, description || null, receiptUrl || null]
    );
    const insertId = result.insertId;

    if (insertId === null || insertId === undefined) {
      return null;
    }

    return { id: insertId };
  } catch (err) {
    return null;
  }
}

// Unlike updateLeaveStatus, this also sets approved_at — the source's
// updateExpenseStatus never had that column to set (see migration 018's
// header: approved_at was added to bot_expense_claims for consistency
// with the other approval-tracked tables even though the source lacks it).
async function updateExpenseStatus(tenantId, recordId, status, approvedBy) {
  const [result] = await pool.execute(
    `UPDATE bot_expense_claims SET status = ?, approved_by = ?, approved_at = NOW()
     WHERE id = ? AND tenant_id = ?`,
    [status, approvedBy || null, recordId, tenantId]
  );
  return result.affectedRows > 0;
}

async function getExpenseRequestSummary(tenantId, requestType, recordId) {
  const [rows] = await pool.query(
    `SELECT employee_name, expense_type, amount, description,
            DATE_FORMAT(expense_date, '%Y-%m-%d') AS expense_date_fmt
     FROM bot_expense_claims WHERE id = ? AND tenant_id = ?`,
    [recordId, tenantId]
  );
  if (!rows.length) return 'Expense claim details unavailable.';
  const exp = rows[0];
  return `💸 Expense Claim\n\n👤 ${exp.employee_name || 'Employee'}\n🏷️ ${exp.expense_type}\n💰 RM ${Number(exp.amount).toFixed(2)}\n📅 ${exp.expense_date_fmt}\n📝 ${exp.description || '-'}`;
}

/**
 * Tasks (bot_tasks + bot_task_assignments) — plain async functions, same
 * precedent as attendance/leave above. Assignment is a join table now
 * (unbounded, not the source's fixed staff/staff2 slots), so every read
 * that returns a task also resolves its assignees via a second query —
 * factored into getTaskAssignees() so getTaskById and getTodayTasks
 * don't duplicate that join.
 */
async function getTaskAssignees(taskId) {
  const [rows] = await pool.query(
    `SELECT e.id, e.full_name, e.whatsapp_number
     FROM bot_task_assignments ta
     JOIN bot_employees e ON e.id = ta.employee_id
     WHERE ta.task_id = ?`,
    [taskId]
  );
  return rows;
}

/**
 * Note: the task INSERT and the per-assignee bot_task_assignments
 * INSERTs are not wrapped in a single transaction — if an assignment
 * insert fails partway through assigneeEmployeeIds, the task row and
 * any earlier-succeeded assignments remain, even though this function
 * returns null (matching the source's plain try/catch style rather than
 * adding transaction handling not present anywhere else in this file).
 */
async function createTask(tenantId, taskData, assigneeEmployeeIds) {
  try {
    const [result] = await pool.execute(
      `INSERT INTO bot_tasks
         (tenant_id, task_name, customer_name, customer_whatsapp, customer_address,
          customer_lat, customer_lng, date_field, appointment_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, taskData.task_name, taskData.customer_name, taskData.customer_whatsapp ?? null,
       taskData.customer_address ?? null, taskData.customer_lat ?? null, taskData.customer_lng ?? null,
       taskData.date_field, taskData.appointment_time ?? null]
    );
    const taskId = result.insertId;

    // applying the same defensive check discovered necessary for leave requests -
    // this class of bug (truthy-but-invalid insertId) could affect any INSERT
    if (taskId === null || taskId === undefined) {
      return null;
    }

    if (Array.isArray(assigneeEmployeeIds) && assigneeEmployeeIds.length) {
      for (const employeeId of assigneeEmployeeIds) {
        await pool.execute('INSERT INTO bot_task_assignments (task_id, employee_id) VALUES (?, ?)', [taskId, employeeId]);
      }
    }

    return { id: taskId };
  } catch (err) {
    return null;
  }
}

async function getTaskById(tenantId, taskId) {
  const [rows] = await pool.query('SELECT * FROM bot_tasks WHERE id = ? AND tenant_id = ?', [taskId, tenantId]);
  if (!rows.length) return null;

  const assignees = await getTaskAssignees(taskId);
  return { ...rows[0], assignees };
}

/**
 * Same conditional-field whitelist pattern as the source's
 * DB.updateTaskStatus, plus the 4 new completion-capture columns
 * (end_time/completion_notes/completion_time/manager_approved_by) that
 * migration 011 added — each only included in the UPDATE if present in
 * extraData, same as the source's if(data.x) checks.
 */
async function updateTaskStatus(tenantId, taskId, status, extraData) {
  const fields = ['status = ?'];
  const values = [status];

  if (extraData) {
    if (extraData.work_photo_url) { fields.push('work_photo_url = ?'); values.push(extraData.work_photo_url); }
    if (extraData.work_summary) { fields.push('work_summary = ?'); values.push(extraData.work_summary); }
    if (extraData.rework_reason) { fields.push('rework_reason = ?'); values.push(extraData.rework_reason); }
    if (extraData.customer_notified) { fields.push('customer_notified = ?'); values.push(extraData.customer_notified); }
    if (extraData.ai_summary) { fields.push('ai_summary = ?'); values.push(extraData.ai_summary); }
    if (extraData.end_time) { fields.push('end_time = ?'); values.push(extraData.end_time); }
    if (extraData.completion_notes) { fields.push('completion_notes = ?'); values.push(extraData.completion_notes); }
    if (extraData.completion_time) { fields.push('completion_time = ?'); values.push(extraData.completion_time); }
    if (extraData.manager_approved_by) { fields.push('manager_approved_by = ?'); values.push(extraData.manager_approved_by); }
  }

  values.push(taskId, tenantId);
  const [result] = await pool.execute(`UPDATE bot_tasks SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`, values);
  return result.affectedRows > 0;
}

async function getTodayTasks(tenantId) {
  const dateStr = toDateStr(nowInKualaLumpur());
  const [rows] = await pool.query(
    `SELECT * FROM bot_tasks
     WHERE tenant_id = ? AND date_field = ? AND status NOT IN ('Completed','Cancelled')
     ORDER BY appointment_time`,
    [tenantId, dateStr]
  );

  const tasks = [];
  for (const row of rows) {
    const assignees = await getTaskAssignees(row.id);
    tasks.push({ ...row, assignees });
  }
  return tasks;
}

/**
 * Payroll (bot_payroll_records) — plain async functions, same precedent
 * as attendance/leave/tasks above.
 *
 * MONTHS/MALAYSIA_PUBLIC_HOLIDAYS/isPublicHoliday/isSunday/
 * formatZohoDate/getWorkingDaysInMonth are all carried over from
 * kapa-attendance-bot's index.js essentially unchanged — this logic
 * isn't statutory-rate-dependent, so it isn't part of the
 * country-configurable design below.
 *
 * FLAGGING, NOT FIXING: MALAYSIA_PUBLIC_HOLIDAYS is a hardcoded,
 * single-country, single-year (2026 only) date list carried over
 * verbatim from source. This is calendar data just as
 * tenant/country-specific as the statutory rates bot_statutory_components
 * was built to make configurable, but it isn't a DB table yet — same
 * "correct for today, revisit later" tradeoff already made for
 * bot_payroll_records' MY-specific columns.
 *
 * INTERFACE ADAPTATION: the source's getWorkingDaysInMonth takes month
 * as a 3-letter name ("Jul") via MONTHS.indexOf(month) — adapted here to
 * the same 1-12 number convention getMonthAttendance already uses
 * elsewhere in this file, rather than mixing two month conventions
 * across the new codebase. The day-counting/public-holiday/
 * alternate-Saturday (2nd & 4th only) logic itself is untouched.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const MALAYSIA_PUBLIC_HOLIDAYS = [
  '01-Jan-2026', '29-Jan-2026', '30-Jan-2026', '01-Feb-2026', '20-Mar-2026',
  '19-Apr-2026', '20-Apr-2026', '01-May-2026', '26-May-2026', '05-Jun-2026',
  '26-Jun-2026', '17-Jul-2026', '31-Aug-2026', '16-Sep-2026', '25-Sep-2026',
  '20-Oct-2026', '25-Dec-2026',
];

function formatZohoDate(date) {
  const d = new Date(new Date(date).toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }));
  return String(d.getDate()).padStart(2, '0') + '-' + MONTHS[d.getMonth()] + '-' + d.getFullYear();
}

function isPublicHoliday(date) {
  const d = new Date(new Date(date).toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }));
  return MALAYSIA_PUBLIC_HOLIDAYS.includes(formatZohoDate(d));
}

function isSunday(date) {
  const d = new Date(new Date(date).toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }));
  return d.getDay() === 0;
}

function getWorkingDaysInMonth(month, year) {
  const monthIndex = month - 1;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  let workingDays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, monthIndex, d);
    const day = date.getDay();
    if (day === 0) continue;
    if (isPublicHoliday(formatZohoDate(date))) continue;
    if (day === 6) { const w = Math.ceil(d / 7); if (w !== 2 && w !== 4) continue; }
    workingDays++;
  }
  return workingDays;
}

/**
 * month/year here are the payroll period. The statutory lookup below is
 * keyed to that period's date (first of the month), not today's real
 * date — so recalculating a past period after a rate change correctly
 * applies the rate that was in effect during that period, not whatever
 * is active today.
 *
 * Returns a generic `contributions` map keyed by component_code (e.g.
 * EPF/SOCSO/EIS for Malaysia today), not named epfEmployee/socsoEmployee
 * fields — adding a new country's components to bot_statutory_components
 * requires no changes here, only to whatever maps `contributions` onto
 * bot_payroll_records' MY-specific columns (createPayrollRecord, below).
 */
async function calculatePayroll(tenantId, employee, month, year, allowance) {
  const basicSalary = parseFloat(employee.salary || 0);
  const fixedAllowance = parseFloat(employee.fixed_allowance || allowance || 0);
  const hourlyRate = basicSalary / 26 / 8;
  let otAmount = 0;
  let totalLateMinutes = 0;
  let presentDays = 0;

  const attendances = await getMonthAttendance(tenantId, employee.id, year, month);
  const workingDays = getWorkingDaysInMonth(month, year);

  for (const att of attendances) {
    const status = String(att.attendance_status || '').toLowerCase();
    if (['present', 'late', 'completed', 'wfh', 'checked in'].includes(status)) presentDays++;
    const lateMin = parseFloat(att.late_minutes || 0);
    if (lateMin > 0) totalLateMinutes += lateMin;
    const otMin = parseFloat(att.ot_minutes || 0);
    if (otMin > 0) {
      const otHours = otMin / 60;
      const otType = String(att.ot_type || 'Normal');
      const otDate = att.attendance_date;
      if (otType === 'Public Holiday' || isPublicHoliday(otDate)) otAmount += hourlyRate * 3.0 * otHours;
      else if (otType === 'Sunday' || isSunday(otDate)) otAmount += hourlyRate * 2.0 * otHours;
      else otAmount += hourlyRate * 1.5 * otHours;
    }
  }

  const absentDays = Math.max(0, workingDays - presentDays);

  const [tenantRows] = await pool.query('SELECT country_code FROM bot_tenants WHERE tenant_id = ?', [tenantId]);
  const countryCode = tenantRows.length ? tenantRows[0].country_code : null;

  const periodDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const [components] = await pool.query(
    `SELECT * FROM bot_statutory_components
     WHERE country_code = ? AND is_active = TRUE
       AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)`,
    [countryCode, periodDate, periodDate]
  );

  const contributions = {};
  for (const component of components) {
    let employeeAmt = 0;
    let employerAmt = 0;

    if (component.calculation_type === 'percentage') {
      employeeAmt = basicSalary * Number(component.employee_rate);
      if (component.employee_cap !== null) employeeAmt = Math.min(employeeAmt, Number(component.employee_cap));
      employerAmt = basicSalary * Number(component.employer_rate);
      if (component.employer_cap !== null) employerAmt = Math.min(employerAmt, Number(component.employer_cap));
    } else if (component.calculation_type === 'bracket') {
      // wage_from < salary <= wage_to — same boundary convention documented in migration 006
      const [brackets] = await pool.query(
        `SELECT * FROM bot_statutory_brackets
         WHERE component_id = ? AND wage_from < ? AND (wage_to IS NULL OR wage_to >= ?)
         ORDER BY wage_from LIMIT 1`,
        [component.id, basicSalary, basicSalary]
      );
      if (brackets.length) {
        employeeAmt = Number(brackets[0].employee_amount);
        employerAmt = Number(brackets[0].employer_amount);
      }
    }

    contributions[component.component_code] = { employee: employeeAmt, employer: employerAmt };
  }

  const totalDeduction = Object.values(contributions).reduce((sum, c) => sum + c.employee, 0);
  const grossSalary = basicSalary + fixedAllowance + otAmount;
  const netSalary = Math.max(0, grossSalary - totalDeduction);

  return {
    basicSalary,
    allowance: fixedAllowance,
    otAmount,
    contributions,
    deduction: totalDeduction,
    grossSalary,
    finalSalary: netSalary,
    lateMinutes: totalLateMinutes,
    absentDays,
    presentDays,
    workingDays,
  };
}

/**
 * THIS is where the MY-specific mapping happens — from the generic
 * `contributions` object (keyed by component_code) to
 * bot_payroll_records' named columns (epf_employee, socso, eis, etc.).
 * This is exactly the tension flagged when bot_payroll_records was
 * designed: adding a new country's components to
 * bot_statutory_components does NOT automatically get a place to land
 * here — this mapping would need extending too, or the table redesigned.
 *
 * month is converted from calculatePayroll's numeric (1-12) convention
 * to the 3-letter name bot_payroll_records.month (VARCHAR(10)) actually
 * stores, matching what the rest of the system displays/looks up by.
 */
async function createPayrollRecord(tenantId, employeeId, month, year, payrollResult) {
  try {
    const [empRows] = await pool.query(
      'SELECT full_name, whatsapp_number FROM bot_employees WHERE id = ? AND tenant_id = ?',
      [employeeId, tenantId]
    );
    if (!empRows.length) return null;
    const employee = empRows[0];

    const c = payrollResult.contributions || {};
    const epf = c.EPF || { employee: 0, employer: 0 };
    const socso = c.SOCSO || { employee: 0, employer: 0 };
    const eis = c.EIS || { employee: 0, employer: 0 };
    const monthName = MONTHS[month - 1] || month;

    const [result] = await pool.execute(
      `INSERT INTO bot_payroll_records
         (tenant_id, employee_id, employee_name, whatsapp_number, month, year,
          basic_salary, allowance, overtime, deductions,
          epf_employee, epf_employer, socso, socso_employer, eis, eis_employer,
          net_salary, gross_salary, late_minutes, working_days, present_days, absent_days)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId, employeeId, employee.full_name, employee.whatsapp_number, monthName, year,
        payrollResult.basicSalary, payrollResult.allowance, payrollResult.otAmount, payrollResult.deduction,
        epf.employee, epf.employer, socso.employee, socso.employer, eis.employee, eis.employer,
        payrollResult.finalSalary, payrollResult.grossSalary, payrollResult.lateMinutes,
        payrollResult.workingDays, payrollResult.presentDays, payrollResult.absentDays,
      ]
    );
    const insertId = result.insertId;

    // same defensive check discovered necessary for leave requests -
    // this class of bug (truthy-but-invalid insertId) could affect any INSERT
    if (insertId === null || insertId === undefined) {
      return null;
    }

    return { id: insertId };
  } catch (err) {
    return null;
  }
}

/**
 * Approval chain resolution (bot_approval_chains) — the most-specific-
 * first tier lookup verified by hand against 3 real scenarios earlier
 * this session (Thinesshvaran/Emergency Leave, Lob/late_reason,
 * Selvan/normal leave), now as a reusable function instead of ad-hoc
 * queries. subtype/role being null/undefined means "no preference" —
 * callers should never pass the literal string '*' themselves, that's
 * the internal DB sentinel this function matches against, not a caller
 * input.
 *
 * Returns ALL rows at the single winning tier (every step_order, both
 * cc_only true/false) — not just the first step — since callers need
 * the full tier to know about later steps and any cc rows sharing a
 * step_order with the real approver.
 *
 * is_active = TRUE is applied on every tier query — a soft-disabled
 * chain row shouldn't be considered a match, matching what that column
 * is evidently for even though this wasn't explicitly requested.
 */
async function resolveTier(tenantId, requestType, subtype, role) {
  const tiers = [];
  if (subtype && role) tiers.push([subtype, role]);
  if (subtype) tiers.push([subtype, '*']);
  if (role) tiers.push(['*', role]);
  tiers.push(['*', '*']);

  for (const [subtypeVal, roleVal] of tiers) {
    const [rows] = await pool.query(
      `SELECT * FROM bot_approval_chains
       WHERE tenant_id = ? AND request_type = ? AND applies_to_subtype = ? AND applies_to_role = ? AND is_active = TRUE
       ORDER BY step_order`,
      [tenantId, requestType, subtypeVal, roleVal]
    );
    if (rows.length) return rows;
  }
  return [];
}

/**
 * Resolves a single bot_approval_chains row down to an actual WhatsApp
 * number, given the employee who made the request (needed for
 * requester_manager resolution). Returns null if unresolvable (e.g. the
 * requester has no manager set, or a referenced employee no longer
 * exists/is inactive).
 *
 * OPEN QUESTION, NOT DECIDED — approver_type='role': if multiple active
 * employees share a role, which one should receive it? All of them
 * (fan-out)? A deterministic single pick, and by what criterion (there's
 * no seniority/priority field on bot_employees today)? Or should
 * multiple people sharing a role used as an approver_type='role' target
 * be treated as a data-integrity problem to prevent elsewhere, not a
 * runtime resolution question? This is genuinely unexercised — no
 * seeded chain row uses approver_type='role' at all (verified via a
 * live query before writing this). The implementation below picks the
 * lowest-id active employee with that role as a PLACEHOLDER so the
 * function has defined behavior rather than silently returning null or
 * throwing — it is an arbitrary tie-break, not a considered answer, and
 * should be revisited before any real chain uses approver_type='role'.
 */
async function resolveApprover(chainRow, requesterEmployee) {
  if (chainRow.approver_type === 'requester_manager') {
    if (!requesterEmployee.reports_to_employee_id) return null;
    const [rows] = await pool.query(
      'SELECT whatsapp_number FROM bot_employees WHERE id = ? AND tenant_id = ?',
      [requesterEmployee.reports_to_employee_id, requesterEmployee.tenant_id]
    );
    return rows.length ? rows[0].whatsapp_number : null;
  }

  if (chainRow.approver_type === 'employee') {
    const [rows] = await pool.query(
      'SELECT whatsapp_number FROM bot_employees WHERE id = ? AND tenant_id = ?',
      [chainRow.approver_employee_id, requesterEmployee.tenant_id]
    );
    return rows.length ? rows[0].whatsapp_number : null;
  }

  if (chainRow.approver_type === 'role') {
    // PLACEHOLDER tie-break — see the open question above.
    const [rows] = await pool.query(
      'SELECT whatsapp_number FROM bot_employees WHERE tenant_id = ? AND role = ? AND is_active = TRUE ORDER BY id LIMIT 1',
      [requesterEmployee.tenant_id, chainRow.approver_role]
    );
    return rows.length ? rows[0].whatsapp_number : null;
  }

  return null;
}

/**
 * Small data-access helpers approvalEngine.js needs and nothing else in
 * this file previously exposed: a chain row by its own id (the button
 * ID carries chain_id, not the tier's discriminators), a full employee
 * row by id (resolveApprover's internal lookups only ever needed
 * whatsapp_number, but the engine needs the whole row as
 * requesterEmployee), and "is there a step after this one in the same
 * resolved tier" (advancing needs the SAME applies_to_subtype/
 * applies_to_role as the current row, not a fresh most-specific-first
 * resolution — the tier was already decided once, at creation time).
 */
async function getChainRowById(chainId) {
  const [rows] = await pool.query('SELECT * FROM bot_approval_chains WHERE id = ?', [chainId]);
  return rows[0] || null;
}

async function getEmployeeById(tenantId, employeeId) {
  const [rows] = await pool.query('SELECT * FROM bot_employees WHERE id = ? AND tenant_id = ?', [employeeId, tenantId]);
  return rows[0] || null;
}

async function getNextStepRows(tenantId, requestType, subtype, role, afterStepOrder) {
  const [rows] = await pool.query(
    `SELECT * FROM bot_approval_chains
     WHERE tenant_id = ? AND request_type = ? AND applies_to_subtype = ? AND applies_to_role = ?
       AND step_order > ? AND is_active = TRUE
     ORDER BY step_order`,
    [tenantId, requestType, subtype, role, afterStepOrder]
  );
  return rows;
}

/**
 * bot_approval_progress — plain CRUD helpers only. The orchestration
 * (when to create/advance/complete a progress row, resolving the next
 * approver, sending buttons) lives in services/approvalEngine.js, not
 * here, consistent with everything else in this file being data access
 * rather than business logic.
 */
async function createApprovalProgress(tenantId, requestType, recordId, requesterEmployeeId, stepOrder, chainId) {
  const [result] = await pool.execute(
    `INSERT INTO bot_approval_progress
       (tenant_id, request_type, record_id, requester_employee_id, current_step_order, current_chain_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [tenantId, requestType, recordId, requesterEmployeeId, stepOrder, chainId]
  );
  return result.insertId;
}

async function getApprovalProgress(tenantId, requestType, recordId) {
  const [rows] = await pool.query(
    'SELECT * FROM bot_approval_progress WHERE tenant_id = ? AND request_type = ? AND record_id = ?',
    [tenantId, requestType, recordId]
  );
  return rows[0] || null;
}

/**
 * expectedStepOrder is a compare-and-swap guard, not just an extra
 * filter: first-responder-wins tiers (multiple approver rows at one
 * step_order — e.g. task_completion's two managers) mean two replies
 * can both read the same 'in_progress' row before either write lands.
 * Requiring current_step_order to still match what the caller's earlier
 * read saw makes only ONE of the two concurrent UPDATEs actually affect
 * a row; the loser's affectedRows === 0 tells approvalEngine.js it lost
 * the race, instead of trusting the earlier read alone (which both
 * replies would have seen as "still in progress").
 */
async function advanceApprovalProgress(tenantId, requestType, recordId, expectedStepOrder, stepOrder, chainId) {
  const [result] = await pool.execute(
    `UPDATE bot_approval_progress SET current_step_order = ?, current_chain_id = ?
     WHERE tenant_id = ? AND request_type = ? AND record_id = ? AND status = 'in_progress' AND current_step_order = ?`,
    [stepOrder, chainId, tenantId, requestType, recordId, expectedStepOrder]
  );
  return result.affectedRows > 0;
}

async function completeApprovalProgress(tenantId, requestType, recordId, expectedStepOrder) {
  const [result] = await pool.execute(
    `UPDATE bot_approval_progress SET status = 'completed'
     WHERE tenant_id = ? AND request_type = ? AND record_id = ? AND status = 'in_progress' AND current_step_order = ?`,
    [tenantId, requestType, recordId, expectedStepOrder]
  );
  return result.affectedRows > 0;
}

/**
 * Mirrors tenantDb(tenantId) from services/db.js for the four append-only
 * log collections (attendance, leads, errors, subscriptions). Every
 * terminal method (.write() / .value()) returns a Promise where the
 * lowdb original was synchronous — that's the one change needed at each
 * call site: add `await`. See services/db.js for the shape being
 * mirrored. conversationState is NOT handled here — use
 * getConversationState/setConversationState/deleteConversationState
 * above instead.
 *
 * Usage:  await tenantDb('kapa').get('leads').push({...}).write()
 */
function tenantDb(tenantId) {
  return {
    get(collection) {
      if (!COLLECTIONS[collection]) {
        throw new Error(`tenantDb: unknown collection "${collection}"`);
      }

      return {
        // .get('leads').push(record).write()
        push(record) {
          return { write: () => insertRow(collection, tenantId, record) };
        },
        // .get('attendance').filter(fn).value() — arbitrary JS predicate
        // (e.g. today's-date-prefix check), kept as an in-memory filter
        // after fetch to preserve exact call-site semantics.
        filter(predicate) {
          return {
            async value() {
              const rows = await allRows(collection, tenantId);
              return rows.map((r) => rowToRecord(collection, r)).filter(predicate);
            },
          };
        },
        // .get('leads').takeRight(50).reverse().value()
        takeRight(n) {
          return {
            reverse() {
              return {
                async value() {
                  const rows = await recentRows(collection, tenantId, n);
                  return rows.map((r) => rowToRecord(collection, r));
                },
              };
            },
          };
        },
      };
    },
  };
}

/**
 * whatsapp_number is looked up with the input stripped of +/-/space, same
 * defensive pattern as getEmployeeByPhone above. Returns the row as-is
 * (including tenant_id — the trial's own bot_tenants FK) or null.
 */
async function getTrialSignupByPhone(whatsappNumber) {
  const clean = String(whatsappNumber || '').replace(/[\s\+\-]/g, '');
  const [rows] = await pool.query(
    'SELECT * FROM bot_trial_signups WHERE whatsapp_number = ?',
    [clean]
  );
  return rows[0] || null;
}

/**
 * Looks up a trial signup's industry_slug by tenant_id — null for any
 * tenant_id with no matching bot_trial_signups row, which includes
 * 'kapa' itself (a real business, not a trial signup) and any future
 * tenant type that never went through this signup path.
 */
async function getIndustryForTenant(tenantId) {
  const [rows] = await pool.query(
    'SELECT industry_slug FROM bot_trial_signups WHERE tenant_id = ?',
    [tenantId]
  );
  return rows.length ? rows[0].industry_slug : null;
}

/**
 * Creates a trial signup's bot_tenants row FIRST, then its
 * bot_trial_signups row referencing it, then a bot_employees row for the
 * signer themselves (role='owner') so they can immediately check in/
 * apply leave/etc. in their own tenant, then a default bot_approval_chains
 * row routing 'leave' requests straight to that same owner — four
 * inserts, not wrapped in a real transaction (no transaction wrapper
 * exists anywhere else in this codebase either, e.g. createTask's
 * task+assignments inserts have the exact same gap). KNOWN GAP: if a
 * later insert fails after an earlier one succeeds, the earlier row(s)
 * are left committed with nothing referencing them yet — inert, not
 * actively harmful (nothing resolves to an orphaned tenant_id/signup
 * without its dependent row), but would need manual cleanup/retry if it
 * ever happens. Not over-engineering a rollback for one function when
 * the rest of the codebase doesn't have one either.
 */
async function createTrialSignup(data) {
  const tenantId = `trial_${crypto.randomUUID()}`;

  const [tenantResult] = await pool.execute(
    'INSERT INTO bot_tenants (tenant_id, tenant_name, country_code) VALUES (?, ?, ?)',
    [tenantId, data.company_name || tenantId, data.country_code]
  );
  // bot_tenants.tenant_id is a manually-supplied VARCHAR PRIMARY KEY, not
  // AUTO_INCREMENT — insertId is always 0 here and tells us nothing (the
  // id we care about, tenantId, was generated by US above, not by
  // MySQL), so affectedRows is the right success signal for this INSERT
  // specifically, unlike every other create* function in this file.
  if (tenantResult.affectedRows !== 1) {
    return null;
  }

  // Stripped the same way getTrialSignupByPhone strips its lookup input —
  // storing an unstripped value here would silently defeat the UNIQUE
  // constraint's intent (two differently-formatted variants of the same
  // number could both get inserted, and a later clean lookup would only
  // ever find one of them).
  const cleanNumber = String(data.whatsapp_number || '').replace(/[\s\+\-]/g, '');

  const [signupResult] = await pool.execute(
    `INSERT INTO bot_trial_signups
       (whatsapp_number, tenant_id, industry_slug, company_name, contact_name, email, country_code, trial_ends_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [cleanNumber, tenantId, data.industry_slug, data.company_name ?? null, data.contact_name ?? null,
     data.email ?? null, data.country_code, data.trial_ends_at ?? null]
  );
  const signupId = signupResult.insertId;

  // Same defensive check applied to leave/expense/task inserts earlier —
  // a truthy-but-invalid insertId could affect any INSERT. See this
  // function's header comment for what happens to the bot_tenants row
  // already created above if this check trips.
  if (signupId === null || signupId === undefined) {
    return null;
  }

  // Makes the trial signer themselves a real, usable employee in their
  // own tenant immediately — able to check in/apply leave/etc. without
  // any separate onboarding step. full_name is NOT NULL on bot_employees,
  // so it falls back to company_name/tenantId the same way tenant_name
  // did above if contact_name wasn't given. password_hash (migration
  // 024) is nullable — callers that don't need dashboard/Hub login for
  // this employee can omit data.password_hash entirely and get NULL,
  // same as every pre-existing employee row that was never given one.
  // Hashing itself (bcrypt, one-way) happens at the caller, not here —
  // this function only ever stores whatever hash it's given.
  const [employeeResult] = await pool.execute(
    'INSERT INTO bot_employees (tenant_id, full_name, whatsapp_number, role, is_active, password_hash) VALUES (?, ?, ?, ?, ?, ?)',
    [tenantId, data.contact_name || data.company_name || tenantId, cleanNumber, 'owner', true, data.password_hash ?? null]
  );
  const employeeId = employeeResult.insertId;

  // Same defensive check as the two inserts above. KNOWN GAP (same
  // class as before, still not solved here): a failure on this third
  // insert leaves the bot_tenants row AND the bot_trial_signups row
  // already committed, with no matching bot_employees row — the signup
  // "succeeded" but the signer can't actually use the bot yet. No real
  // transaction wrapper exists anywhere in this codebase to roll all
  // three back together.
  if (employeeId === null || employeeId === undefined) {
    return null;
  }

  // Default approval chain for 'leave' requests, routing straight to the
  // owner employee just created above — without this, a brand-new trial
  // tenant has zero bot_approval_chains rows at all, and resolveTier
  // (services/db-mysql.js) returns [] for every leave request, meaning
  // startApprovalFlow (services/approvalEngine.js) silently does nothing:
  // the leave request row gets created fine but nobody is ever notified
  // to approve it. applies_to_subtype/applies_to_role are both '*'
  // (matches any subtype/role) so this one row covers every employee's
  // leave requests in this tenant until they configure something more
  // specific themselves.
  const [chainResult] = await pool.execute(
    `INSERT INTO bot_approval_chains
       (tenant_id, request_type, applies_to_subtype, applies_to_role, step_order, approver_type, approver_employee_id, cc_only)
     VALUES (?, 'leave', '*', '*', 1, 'employee', ?, FALSE)`,
    [tenantId, employeeId]
  );
  const chainId = chainResult.insertId;

  // Same defensive check as the three inserts above. KNOWN GAP (same
  // class as before, still not solved here): a failure on this fourth
  // insert leaves the tenant/signup/owner rows already committed and
  // fully functional for everything EXCEPT leave approvals — check-in,
  // expenses, tasks etc. are unaffected, only leave requests would go
  // unrouted (same silent-no-op behavior as any tenant that never got a
  // chain seeded at all, not a regression from having tried).
  if (chainId === null || chainId === undefined) {
    return null;
  }

  return { id: signupId, tenant_id: tenantId, employee_id: employeeId };
}

module.exports = {
  pool,
  tenantDb,
  getConversationState,
  setConversationState,
  deleteConversationState,
  getEmployeeByPhone,
  createCheckIn,
  updateCheckOut,
  getTodayAttendance,
  getMonthAttendance,
  getEmployeePerformanceSummary,
  createLeaveRequest,
  updateLeaveStatus,
  isEmployeeOnLeave,
  isEmployeeOnLeaveOnDate,
  getLeaveRequestSummary,
  createExpenseClaim,
  updateExpenseStatus,
  getExpenseRequestSummary,
  createTask,
  getTaskById,
  updateTaskStatus,
  getTodayTasks,
  calculatePayroll,
  createPayrollRecord,
  resolveTier,
  resolveApprover,
  getChainRowById,
  getEmployeeById,
  getNextStepRows,
  createApprovalProgress,
  getApprovalProgress,
  advanceApprovalProgress,
  completeApprovalProgress,
  getTrialSignupByPhone,
  createTrialSignup,
  getIndustryForTenant,
  getEmployeeByPhoneAnyTenant,
  getTenantNameById,
};
