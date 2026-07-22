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
// NOT YET WIRED into routes/webhook.js. The existing call site there
// (the getTenantByPhoneNumberId(incomingPhoneNumberId) call around line
// 95) still does per-NUMBER-only resolution today — this function is
// built and verified here in isolation first. Wiring it in is the next
// step, and it needs to be reconciled with the prospect/industry-picker
// fork already living in webhook.js's text handler (the getEmployeeByPhone
// check at the top of that handler): once this function's own
// employee-check-first logic is the thing deciding `tenant`, that
// handler's fork and this function's 'not_signed_up' reason describe
// the same real-vs-prospect distinction in two places, and it's not yet
// decided which one should own it going forward.

const { getTenantByPhoneNumberId, SHARED_DEMO_PHONE_NUMBER_ID } = require('../config/tenants');
const { getEmployeeByPhone, getTrialSignupByPhone } = require('./db-mysql');

/**
 * Returns { tenant, reason?, trialInfo? }. tenant is null whenever the
 * message shouldn't be processed further — callers should check for
 * that and use `reason` to decide what (if anything) to reply with.
 */
async function resolveTenantForMessage(phoneNumberId, senderWhatsappNumber) {
  const configTenant = getTenantByPhoneNumberId(phoneNumberId);
  if (!configTenant) return { tenant: null, reason: 'unknown_phone_number_id' };

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
      return { tenant: configTenant };
    }

    const trialSignup = await getTrialSignupByPhone(senderWhatsappNumber);
    if (!trialSignup) return { tenant: null, reason: 'not_signed_up' };
    if (trialSignup.status === 'expired') return { tenant: null, reason: 'trial_expired' };

    // Merge: WhatsApp-sending config stays kapa's (shared number/token);
    // .id is overridden to the trial's OWN tenant_id so every downstream
    // db-mysql.js call scopes to their isolated data, not kapa's.
    const realTenant = { ...configTenant, id: trialSignup.tenant_id, name: trialSignup.company_name };
    return { tenant: realTenant, trialInfo: trialSignup };
  }

  return { tenant: configTenant };
}

module.exports = { resolveTenantForMessage };
