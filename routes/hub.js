// Kapa Hub dashboard login — a lightweight session issuer separate from
// the WhatsApp bot's own tenant resolution. Public route (no
// requireTenant/requireAdmin), matching routes/trialSignup.js's
// precedent: logging in is exactly the thing that can't require prior
// authentication.

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const {
  getEmployeeByPhoneAnyTenant,
  getInventory,
  getExpiringDocuments,
  getRecentAttendanceForTenant,
  getRecentLeaveRequestsForTenant,
  getEmployeesForTenant,
} = require('../services/db-mysql');
const logger = require('../utils/logger');

const HUB_JWT_SECRET = process.env.HUB_JWT_SECRET;

/**
 * Verifies the Bearer token issued by POST /login and attaches its
 * payload to req.tenant_id/req.employee_id — every data endpoint below
 * scopes its query to req.tenant_id specifically because it came from
 * a verified token, never from req.body/req.query (which any caller
 * could set to any value, tenant isolation would mean nothing).
 */
function requireHubAuth(req, res, next) {
  if (!HUB_JWT_SECRET) {
    return res.status(500).json({ ok: false, error: 'HUB_JWT_SECRET not configured on server' });
  }

  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ ok: false, error: 'Missing or malformed Authorization header' });
  }

  try {
    const payload = jwt.verify(token, HUB_JWT_SECRET);
    req.tenant_id = payload.tenant_id;
    req.employee_id = payload.employee_id;
    next();
  } catch (err) {
    // Covers expired, invalid signature, and malformed tokens alike —
    // none of these are worth distinguishing to the caller, and
    // jwt.verify's own error message is exactly what tells them apart
    // if this ever needs debugging server-side.
    return res.status(401).json({ ok: false, error: 'Invalid or expired token' });
  }
}

/**
 * whatsapp_number, not email, is the login identifier — it's the column
 * password_hash actually lives alongside on bot_employees, and every
 * employee has one (a staff member added after signup has no email at
 * all; only the original trial signer's bot_trial_signups row does).
 * Looked up across ALL tenants via getEmployeeByPhoneAnyTenant, since a
 * login request has no tenant_id to scope by yet — that's exactly what
 * logging in is meant to establish.
 *
 * 2+ matches (the same cross-tenant whatsapp_number collision
 * tenantResolution.js already refuses to guess through, since
 * whatsapp_number is only unique per-tenant, not globally) can't safely
 * pick a tenant to log into either — treated the same as "no such
 * user" in the response (both return a generic 401) so a caller can't
 * distinguish "wrong password" from "this number is ambiguous" from
 * outside, but logged loudly server-side since it's a real
 * data-integrity situation worth investigating.
 */
router.post('/login', async (req, res) => {
  try {
    if (!HUB_JWT_SECRET) {
      return res.status(500).json({ ok: false, error: 'HUB_JWT_SECRET not configured on server' });
    }

    const { whatsappNumber, password } = req.body || {};
    if (!whatsappNumber || !password) {
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    const matches = await getEmployeeByPhoneAnyTenant(whatsappNumber);
    if (matches.length > 1) {
      logger.error(`Hub login: ambiguous employee match for whatsappNumber=${whatsappNumber} across tenants: ${JSON.stringify(matches.map((m) => m.tenant_id))}`);
    }
    if (matches.length !== 1) {
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    const employee = matches[0];
    // No password_hash set (e.g. a staff member who never got Hub
    // access provisioned, per migration 024's header comment) — same
    // generic 401 as a wrong password, not a distinct error that would
    // reveal the account exists but has no password.
    if (!employee.password_hash) {
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    const passwordMatches = await bcrypt.compare(String(password), employee.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { tenant_id: employee.tenant_id, employee_id: employee.id },
      HUB_JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({ ok: true, token });
  } catch (err) {
    logger.error('Hub login error:', err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

router.get('/inventory', requireHubAuth, async (req, res) => {
  try {
    const items = await getInventory(req.tenant_id);
    return res.json({ ok: true, items });
  } catch (err) {
    logger.error('Hub GET /inventory error:', err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

// 90-day window, wider than the 30-day threshold checkAndSendExpiryReminders
// (services/foreignWorkerReminders.js) uses to decide when to actually
// notify someone — a dashboard should show everything reasonably
// relevant to plan around, not just what's urgent enough to interrupt
// someone over WhatsApp today.
router.get('/foreign-worker-docs', requireHubAuth, async (req, res) => {
  try {
    const documents = await getExpiringDocuments(req.tenant_id, 90);
    return res.json({ ok: true, documents });
  } catch (err) {
    logger.error('Hub GET /foreign-worker-docs error:', err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

router.get('/attendance', requireHubAuth, async (req, res) => {
  try {
    const records = await getRecentAttendanceForTenant(req.tenant_id);
    return res.json({ ok: true, records });
  } catch (err) {
    logger.error('Hub GET /attendance error:', err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

router.get('/leave', requireHubAuth, async (req, res) => {
  try {
    const requests = await getRecentLeaveRequestsForTenant(req.tenant_id);
    return res.json({ ok: true, requests });
  } catch (err) {
    logger.error('Hub GET /leave error:', err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

router.get('/staff', requireHubAuth, async (req, res) => {
  try {
    const employees = await getEmployeesForTenant(req.tenant_id);
    return res.json({ ok: true, employees });
  } catch (err) {
    logger.error('Hub GET /staff error:', err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

module.exports = router;
