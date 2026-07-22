// POST /api/trial-signup — public route (no x-api-key, no requireTenant),
// same category as GET /api/products: called anonymously by the website
// signup form, before any tenant/api-key exists for whoever's filling it
// out. Wraps services/db-mysql.js's createTrialSignup, which does the
// actual bot_tenants + bot_trial_signups + bot_employees three-insert
// sequence (see that function's own header comment).

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { createTrialSignup, getTrialSignupByPhone } = require('../services/db-mysql');
const logger = require('../utils/logger');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TRIAL_LENGTH_MS = 7 * 24 * 60 * 60 * 1000;
const BCRYPT_ROUNDS = 10;

function cleanWhatsappNumber(n) {
  return String(n || '').trim().replace(/[\s+-]/g, '');
}

router.post('/', async (req, res) => {
  const { name, email, whatsappNumber, companyName, industrySlug, countryCode, password } = req.body || {};

  const cleanNumber = cleanWhatsappNumber(whatsappNumber);

  if (!name || !String(name).trim()) {
    return res.status(400).json({ success: false, error: 'Name is required.' });
  }
  if (!email || !EMAIL_PATTERN.test(String(email).trim())) {
    return res.status(400).json({ success: false, error: 'A valid email address is required.' });
  }
  if (!cleanNumber) {
    return res.status(400).json({ success: false, error: 'WhatsApp number is required.' });
  }
  if (!companyName || !String(companyName).trim()) {
    return res.status(400).json({ success: false, error: 'Company name is required.' });
  }
  if (!industrySlug || !String(industrySlug).trim()) {
    return res.status(400).json({ success: false, error: 'Please select an industry.' });
  }
  if (!password || String(password).length < 8) {
    return res.status(400).json({ success: false, error: 'Password must be at least 8 characters.' });
  }

  // Not one of the 9 real product slugs (e.g. 'kapa_ai', 'not_sure') is
  // NOT a validation failure — still accept the signup as a lead, same
  // as the WhatsApp industry picker's own "being finalized" branch for
  // unrecognized/unbuilt industries. hasWorkingDemo reflects the actual
  // current system state, not just "is this a real product slug": only
  // 'field' has a working conversational demo today (see
  // services/prospectDemo.js — the other 8 known slugs get a "being
  // finalized" message too, same as a completely unrecognized slug), so
  // it's checked directly against 'field', not against
  // VALID_INDUSTRY_SLUGS as a whole.
  const hasWorkingDemo = industrySlug === 'field';

  // Pre-check avoids the common case of leaving an orphaned bot_tenants
  // row behind (createTrialSignup's known, documented, deliberately
  // unsolved gap — see its own header comment) every time someone
  // resubmits with a number they already used. Does NOT fully close the
  // race (two concurrent submits could both pass this check before
  // either INSERT lands) — the try/catch around createTrialSignup below
  // is the real safety net for that rarer case.
  const existing = await getTrialSignupByPhone(cleanNumber);
  if (existing) {
    return res.status(409).json({
      success: false,
      error: "You've already signed up for a trial with this WhatsApp number.",
    });
  }

  const trialEndsAt = new Date(Date.now() + TRIAL_LENGTH_MS);

  try {
    const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);

    const result = await createTrialSignup({
      whatsapp_number: cleanNumber,
      industry_slug: industrySlug,
      company_name: String(companyName).trim(),
      contact_name: String(name).trim(),
      email: String(email).trim(),
      country_code: countryCode || 'MY',
      trial_ends_at: trialEndsAt,
      password_hash: passwordHash,
    });

    if (!result) {
      // createTrialSignup's own internal insertId/affectedRows checks
      // tripped — a real failure, not a validation issue. See its
      // header comment for what state that can leave behind.
      logger.error(`Trial signup failed for ${cleanNumber} (${companyName}) — createTrialSignup returned null.`);
      return res.status(500).json({ success: false, error: 'Something went wrong creating your trial. Please try again or contact support.' });
    }

    logger.info(`New trial signup: ${companyName} (${cleanNumber}) — industry=${industrySlug}, tenant_id=${result.tenant_id}`);

    return res.json({
      success: true,
      hasWorkingDemo,
      message: hasWorkingDemo
        ? "Your trial is ready! Message us on WhatsApp and type 'check in' to try it live."
        : `Thanks for signing up! The ${industrySlug} demo is still being finalized — our team will reach out shortly.`,
    });
  } catch (err) {
    // Defensive fallback for the pre-check's race window: a duplicate
    // whatsapp_number hitting bot_trial_signups' UNIQUE constraint
    // surfaces here as a real thrown exception (unlike createTrialSignup's
    // OWN insertId checks, which return null instead of throwing) —
    // caught and translated to the same 409 rather than a raw 500.
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        error: "You've already signed up for a trial with this WhatsApp number.",
      });
    }
    logger.error(`Trial signup error for ${cleanNumber} (${companyName}): ${err.message}`);
    return res.status(500).json({ success: false, error: 'Something went wrong. Please try again or contact support.' });
  }
});

module.exports = router;
