const express = require('express');
const router = express.Router();
const { tenantDb } = require('../services/db');
const logger = require('../utils/logger');

/**
 * Records a check-in/out event for a specific tenant. Called by the
 * webhook handler (routes/webhook.js) when an employee texts "check in" /
 * "check out", and also usable directly via the API below.
 */
function recordAttendance(tenantId, { phone, name, type, lat, lng }) {
  const record = {
    phone,
    name: name || null,
    type, // 'in' | 'out'
    timestamp: new Date().toISOString(),
    lat: lat ?? null,
    lng: lng ?? null,
  };
  tenantDb(tenantId).get('attendance').push(record).write();
  return record;
}

/**
 * GET /api/attendance/today
 */
router.get('/today', (req, res) => {
  const todayStr = new Date().toISOString().substring(0, 10);
  const records = tenantDb(req.tenant.id)
    .get('attendance')
    .filter((r) => r.timestamp.startsWith(todayStr))
    .value();

  const byEmployee = {};
  records.forEach((r) => {
    byEmployee[r.phone] = byEmployee[r.phone] || { phone: r.phone, name: r.name, events: [] };
    byEmployee[r.phone].events.push({ type: r.type, timestamp: r.timestamp });
  });

  res.json({ ok: true, date: todayStr, employees: Object.values(byEmployee) });
});

/**
 * POST /api/attendance/manual
 */
router.post('/manual', async (req, res) => {
  const { phone, name, type } = req.body;
  if (!phone || !['in', 'out'].includes(type)) {
    return res.status(400).json({ ok: false, error: 'phone and type ("in"|"out") are required' });
  }
  const record = recordAttendance(req.tenant.id, { phone, name, type });
  logger.info(`[${req.tenant.id}] Manual attendance recorded: ${phone} -> ${type}`);
  res.json({ ok: true, record });
});

module.exports = { router, recordAttendance };
