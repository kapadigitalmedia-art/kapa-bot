// GET /api/admin/trial-signups[, /:id] — admin-only list/detail view of
// trial signups. Mounted with requireAdmin at the server.js level: every
// route in this file is admin-only, unlike routes/products.js (which
// mixes public GET with admin-protected PUT/POST and applies requireAdmin
// per-route for that reason) — nothing here needs that per-route split.

const express = require('express');
const router = express.Router();
const { pool } = require('../services/db-mysql');

const VALID_STATUSES = ['trial', 'upgraded', 'expired'];

// employee_count comes from a LEFT JOIN against bot_employees on
// tenant_id. Every other requested field already lives directly on
// bot_trial_signups — including country_code, captured at signup time
// and kept in sync with bot_tenants.country_code by createTrialSignup —
// so no join against bot_tenants is needed at all here.
const LIST_FIELDS = `
  s.id, s.contact_name, s.company_name, s.whatsapp_number, s.email,
  s.industry_slug, s.country_code, s.status, s.trial_started_at,
  s.trial_ends_at, s.created_at, COUNT(e.id) AS employee_count
`;

/**
 * GET /api/admin/trial-signups
 * ?status=trial|upgraded|expired (optional)
 */
router.get('/', async (req, res) => {
  const { status } = req.query;

  if (status && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ success: false, error: `Invalid status filter. Must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  const params = [];
  let where = '';
  if (status) {
    where = 'WHERE s.status = ?';
    params.push(status);
  }

  const [rows] = await pool.query(
    `SELECT ${LIST_FIELDS}
     FROM bot_trial_signups s
     LEFT JOIN bot_employees e ON e.tenant_id = s.tenant_id
     ${where}
     GROUP BY s.id
     ORDER BY s.created_at DESC`,
    params
  );

  res.json({ success: true, count: rows.length, signups: rows });
});

/**
 * GET /api/admin/trial-signups/:id
 * Same fields as the list view (plus tenant_id, useful here for direct
 * DB cross-reference — not part of the list shape), plus this signup's
 * 5 most recent attendance events: the simplest available "are they
 * actually using this" signal, not a full activity feed across every
 * table (leave/tasks/expenses aren't included — easily added later if
 * actually needed).
 */
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  const [rows] = await pool.query(
    `SELECT ${LIST_FIELDS}, s.tenant_id
     FROM bot_trial_signups s
     LEFT JOIN bot_employees e ON e.tenant_id = s.tenant_id
     WHERE s.id = ?
     GROUP BY s.id`,
    [id]
  );

  if (!rows.length) {
    return res.status(404).json({ success: false, error: 'Trial signup not found.' });
  }

  const signup = rows[0];

  const [recentActivity] = await pool.query(
    `SELECT a.employee_id, a.attendance_date, a.check_in_time, a.check_out_time, a.attendance_status
     FROM bot_employee_attendance a
     WHERE a.tenant_id = ?
     ORDER BY a.id DESC
     LIMIT 5`,
    [signup.tenant_id]
  );

  res.json({ success: true, signup, recentActivity });
});

module.exports = router;
