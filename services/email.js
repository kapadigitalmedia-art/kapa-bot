// Transactional email via Resend — currently just the trial-signup
// welcome email. Sending failures must never block the caller (a signup
// succeeding shouldn't hinge on an email provider being up), so every
// path here either resolves normally or logs+swallows, never throws.

const logger = require('../utils/logger');

// kapa.my is a verified sending domain in Resend as of this change — a
// friendly "hello@" address rather than "noreply@", since a trial
// welcome email is a first-touch message where a reply is genuinely
// welcome, not a pure notification.
const FROM_ADDRESS = 'KAPA Technologies <hello@kapa.my>';
// Two distinct numbers, two distinct purposes — DEMO_WHATSAPP is the
// actual working bot (the main CTA: message it to start using the
// trial); SUPPORT_WHATSAPP is a human on the sales/support side, for
// questions rather than product use. Conflating these into one number
// (as the previous version did) would send trial users asking a
// question straight into the bot instead of a person.
const DEMO_WHATSAPP = '+60 12-207 0521';
const SUPPORT_WHATSAPP = '+91 75500 08031';

let resendClient = null;

function getResendClient() {
  if (resendClient) return resendClient;
  if (!process.env.RESEND_API_KEY) return null;
  const { Resend } = require('resend');
  resendClient = new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}

function formatTrialEndsDate(trialEndsAt) {
  const d = trialEndsAt instanceof Date ? trialEndsAt : new Date(trialEndsAt);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

/**
 * data = { contactName, companyName, industryName, trialEndsAt }
 * Never throws — a signup must succeed regardless of email deliverability.
 * If RESEND_API_KEY isn't configured at all, logs a warning and skips
 * (not an error: plenty of local/test environments won't have it set).
 */
async function sendWelcomeEmail(to, data) {
  const client = getResendClient();
  if (!client) {
    logger.warn('RESEND_API_KEY not set — skipping welcome email.');
    return { ok: false, skipped: true };
  }

  const trialEndsDate = formatTrialEndsDate(data.trialEndsAt);

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; color: #202124;">
      <p>Hi ${data.contactName},</p>
      <p>Your 7-day trial of <strong>KAPA ONE ${data.industryName}</strong> for <strong>${data.companyName}</strong> is ready to go.</p>
      <p>Message <strong>${DEMO_WHATSAPP}</strong> on WhatsApp to start using your ${data.industryName} trial right now.</p>
      <p>Your trial ends on <strong>${trialEndsDate}</strong>.</p>
      <p>Thanks for trying KAPA ONE.<br>— The KAPA Technologies Team</p>
      <p style="font-size: 13px; color: #5f6368; margin-top: 24px;">Questions? Reach our team at ${SUPPORT_WHATSAPP}.</p>
    </div>
  `;

  try {
    const { data: result, error } = await client.emails.send({
      from: FROM_ADDRESS,
      to,
      subject: `Your KAPA ONE ${data.industryName} trial is ready`,
      html,
    });

    if (error) {
      logger.error(`Welcome email failed for ${to}: ${error.message || JSON.stringify(error)}`);
      return { ok: false, error };
    }

    logger.info(`Welcome email sent to ${to} (id=${result?.id})`);
    return { ok: true, id: result?.id };
  } catch (err) {
    logger.error(`Welcome email threw for ${to}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

module.exports = { sendWelcomeEmail };
