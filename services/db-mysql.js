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

module.exports = { pool, tenantDb, getConversationState, setConversationState, deleteConversationState };
