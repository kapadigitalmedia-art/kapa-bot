const express = require('express');
const router = express.Router();
const { tenantDb } = require('../services/db');
const { tenantDb: tenantDbMysql, pool } = require('../services/db-mysql');
const logger = require('../utils/logger');

/**
 * Records a check-in/out event for a specific tenant. Called by the
 * webhook handler (routes/webhook.js) when an employee texts "check in" /
 * "check out", and also usable directly via the API below.
 *
 * Writes to MySQL (bot_attendance), then reads the just-inserted row back
 * to confirm it actually persisted — check-in/out is higher stakes than
 * the errors/leads logs, so we don't want to report success on a write
 * that silently didn't take. If either the write or the verification
 * fails, falls back to the old lowdb store (same safety-net pattern as
 * routes/errors.js and routes/leads.js).
 */
async function recordAttendance(tenantId, { phone, name, type, lat, lng }) {
  const record = {
    phone,
    name: name || null,
    type, // 'in' | 'out'
    timestamp: new Date().toISOString(),
    lat: lat ?? null,
    lng: lng ?? null,
  };

  try {
    const inserted = await tenantDbMysql(tenantId).get('attendance').push(record).write();
    const [rows] = await pool.query('SELECT id FROM bot_attendance WHERE id = ?', [inserted.id]);
    if (!rows.length) {
      throw new Error(`read-back verification found no row for id=${inserted.id}`);
    }
  } catch (err) {
    logger.warn(`[${tenantId}] MySQL write/verify failed for attendance, falling back to lowdb: ${err.message}`);
    tenantDb(tenantId).get('attendance').push(record).write();
  }

  return record;
}

/**
 * GET /api/attendance/today
 */
router.get('/today', async (req, res) => {
  const todayStr = new Date().toISOString().substring(0, 10);
  try {
    const records = await tenantDbMysql(req.tenant.id)
      .get('attendance')
      .filter((r) => r.timestamp.startsWith(todayStr))
      .value();

    const byEmployee = {};
    records.forEach((r) => {
      byEmployee[r.phone] = byEmployee[r.phone] || { phone: r.phone, name: r.name, events: [] };
      byEmployee[r.phone].events.push({ type: r.type, timestamp: r.timestamp });
    });

    res.json({ ok: true, date: todayStr, employees: Object.values(byEmployee) });
  } catch (err) {
    logger.warn(`[${req.tenant.id}] MySQL read failed for attendance: ${err.message}`);
    res.status(500).json({ ok: false, error: 'Failed to read attendance' });
  }
});

/**
 * POST /api/attendance/manual
 */
router.post('/manual', async (req, res) => {
  const { phone, name, type } = req.body;
  if (!phone || !['in', 'out'].includes(type)) {
    return res.status(400).json({ ok: false, error: 'phone and type ("in"|"out") are required' });
  }
  try {
    const record = await recordAttendance(req.tenant.id, { phone, name, type });
    logger.info(`[${req.tenant.id}] Manual attendance recorded: ${phone} -> ${type}`);
    res.json({ ok: true, record });
  } catch (err) {
    logger.warn(`[${req.tenant.id}] Failed to record manual attendance: ${err.message}`);
    res.status(500).json({ ok: false, error: 'Failed to record attendance' });
  }
});

module.exports = { router, recordAttendance };
