// Tenant resolution for incoming WhatsApp messages — layers a second,
// per-SENDER resolution path on top of getTenantByPhoneNumberId's
// per-NUMBER one. Needed because kapa's single WhatsApp number is
// shared by two completely different audiences on the exact same
// phone_number_id: kapa's own real employees (bot_employees rows under
// tenant_id='kapa') and every trial-signup prospect (each with their OWN
// tenant_id, isolated via bot_trial_signups + bot_tenants — see
// migration 022's header comment for the full two-role tenant object
// reasoning this resolves).
//
// Lives in services/, not config/tenants.js, because it needs DB
// lookups (getEmployeeByPhone, getTrialSignupByPhone) — config/tenants.js
// is deliberately DB-free, pure static/env-var config, consistent with
// every other config/*.js file in this repo.
//
// Wired into routes/webhook.js's top-level resolution call site.
// configTenant is returned alongside tenant in every branch — even when
// tenant is null (not_signed_up/trial_expired), the caller still needs
// valid WhatsApp-sending credentials to reply (kapa's shared demo
// number's own config), which only configTenant carries; tenant itself
// is deliberately null in those cases since there's no real *business*
// tenant to scope data to yet.
//
// Reconciliation with webhook.js's existing prospect/industry-picker
// fork (the getEmployeeByPhone check at the top of the text handler):
// not_signed_up does NOT short-circuit at the webhook.js call site —
// the caller falls through to `tenant = resolvedTenant || configTenant`
// and lets that existing fork run unchanged. Short-circuiting immediately
// (e.g. always calling sendIndustryPicker for not_signed_up) would
// resend the picker even to a prospect mid-demo_exploring, and would
// make the list_reply handler unreachable for genuine prospects (they're
// always not_signed_up, so they'd never get past an early return to
// reach it). Falling through works because a genuine prospect has no
// bot_employees row under 'kapa' either way, so the existing fork
// naturally lands them in the same demo/picker flow with no special
// casing needed here.

const { getTenantByPhoneNumberId, SHARED_DEMO_PHONE_NUMBER_ID } = require('../config/tenants');
const { getEmployeeByPhone, getTrialSignupByPhone } = require('./db-mysql');

/**
 * Returns { tenant, reason?, trialInfo?, configTenant }. tenant is null
 * whenever there's no resolved business tenant to scope data to —
 * callers should check for that and use `reason` (plus configTenant, for
 * sending) to decide what to reply with.
 */
async function resolveTenantForMessage(phoneNumberId, senderWhatsappNumber) {
  const configTenant = getTenantByPhoneNumberId(phoneNumberId);
  if (!configTenant) return { tenant: null, reason: 'unknown_phone_number_id', configTenant: null };

  if (configTenant.id === 'kapa' && phoneNumberId === SHARED_DEMO_PHONE_NUMBER_ID) {
    // Real kapa/Asia-Avid employees share this exact number with every
    // trial prospect — check bot_employees FIRST. Skipping this check
    // would route every real employee's message into the trial-signup
    // lookup below and reject them as 'not_signed_up', breaking
    // check-in/leave/expense/approvals for everyone already using the
    // bot today. Same employee-vs-prospect gate already built into
    // routes/webhook.js's text handler — this just has to happen a step
    // earlier, since resolution runs before that handler does.
    const employee = await getEmployeeByPhone('kapa', senderWhatsappNumber);
    if (employee) {
      return { tenant: configTenant, configTenant };
    }

    const trialSignup = await getTrialSignupByPhone(senderWhatsappNumber);
    if (!trialSignup) return { tenant: null, reason: 'not_signed_up', configTenant };
    if (trialSignup.status === 'expired') return { tenant: null, reason: 'trial_expired', configTenant };

    // Merge: WhatsApp-sending config stays kapa's (shared number/token);
    // .id is overridden to the trial's OWN tenant_id so every downstream
    // db-mysql.js call scopes to their isolated data, not kapa's.
    const realTenant = { ...configTenant, id: trialSignup.tenant_id, name: trialSignup.company_name };
    return { tenant: realTenant, trialInfo: trialSignup, configTenant };
  }

  return { tenant: configTenant, configTenant };
}

module.exports = { resolveTenantForMessage };
