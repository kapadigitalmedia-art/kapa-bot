const express = require('express');
const router = express.Router();
const db = require('../services/db');
const logger = require('../utils/logger');

/**
 * Records a check-in or check-out event. Called internally by the webhook
 * handler when an employee sends "check in" / "check out" on WhatsApp
 * (see routes/webhook.js), but also exposed as a plain API for testing
 * or for other systems (e.g. a web dashboard button) to trigger the same
 * flow programmatically.
 */
function recordAttendance({ phone, name, type, lat, lng }) {
  const record = {
    phone,
    name: name || null,
    type, // 'in' | 'out'
    timestamp: new Date().toISOString(),
    lat: lat ?? null,
    lng: lng ?? null,
  };
  db.get('attendance').push(record).write();
  return record;
}

/**
 * GET /api/attendance/today
 * Quick summary of who has checked in/out today — used by the Admin
 * Dashboard module and available directly as an API too.
 */
router.get('/today', (req, res) => {
  const todayStr = new Date().toISOString().substring(0, 10);
  const todaysRecords = db
    .get('attendance')
    .filter((r) => r.timestamp.startsWith(todayStr))
    .value();

  const byEmployee = {};
  todaysRecords.forEach((r) => {
    byEmployee[r.phone] = byEmployee[r.phone] || { phone: r.phone, name: r.name, events: [] };
    byEmployee[r.phone].events.push({ type: r.type, timestamp: r.timestamp });
  });

  res.json({ ok: true, date: todayStr, employees: Object.values(byEmployee) });
});

/**
 * POST /api/attendance/manual
 * Manually log an attendance event (e.g. from an admin panel), protected
 * the same way as other internal routes via the x-api-key middleware
 * applied in server.js.
 */
router.post('/manual', async (req, res) => {
  const { phone, name, type } = req.body;
  if (!phone || !['in', 'out'].includes(type)) {
    return res.status(400).json({ ok: false, error: 'phone and type ("in"|"out") are required' });
  }
  const record = recordAttendance({ phone, name, type });
  logger.info(`Manual attendance recorded: ${phone} -> ${type}`);
  res.json({ ok: true, record });
});

module.exports = { router, recordAttendance };
