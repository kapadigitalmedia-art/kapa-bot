# WhatsApp Number Troubleshooting: Messages Not Reaching the Webhook

Documented from a real investigation (2026-07-22) while testing the trial-signup
flow against a freshly-registered WhatsApp Business number. Kept for future
reference — this exact symptom is expected to recur whenever a real customer's
own WhatsApp Business number is onboarded onto the platform.

## Symptom

Real inbound WhatsApp messages never reach the webhook (no log entry at all —
not even an "UNKNOWN phone_number_id" warning, since the request never arrives),
despite:

- Correct Callback URL configured
- Correct Phone Number ID confirmed
- 'messages' webhook field showing 'Subscribed'
- Meta's synthetic Test button payload successfully reaching the webhook
- The number successfully SENDING/RECEIVING regular WhatsApp messages
  (double-tick delivery confirmed)

In other words: every piece of standard webhook plumbing checks out, and the
number clearly works as a WhatsApp number — but real messages specifically
never make it to `POST /webhook`.

## Root Cause

Check **WhatsApp Manager → [WABA] → Phone number status** column. If it shows
**'Rejected'**, click it — a rejected **display name** (e.g. containing "Demo",
"Test", "Trial", "Sample") can restrict business-API-level webhook message
forwarding, even though basic message delivery still works normally at the
consumer-app level.

This is a Meta-side restriction tied to the display name review, not a bug in
this codebase's webhook handler, tenant resolution, or Meta App configuration.

## Fix

Change the display name to something that reads as a genuine business name
(avoid Demo/Test/Trial/Sample), resubmit, and wait for Meta's review (minutes
to 24+ hours).

## Diagnostic Checklist for This Class of Issue (in order)

1. Confirm Phone Number ID matches `config/tenants.js`'s configured value
   exactly (e.g. `KAPA_PHONE_NUMBER_ID`).
2. Confirm Callback URL + Verify Token match what's configured in
   `config/config.js` (`meta.verifyToken`).
3. Confirm the `'messages'` webhook field is Subscribed.
4. Test with Meta's own Test button — if this reaches your webhook but real
   messages don't, the plumbing works and the issue is number-specific, not a
   code/config problem.
5. Check basic message delivery (double-tick) from a different WhatsApp
   account, to confirm the number itself is functional at the consumer level.
6. **Check Phone Number status** — if 'Rejected', this is very likely the
   actual cause. Check the rejection reason first, before debugging anything
   else in this codebase.

## Why This Matters for Onboarding Real Customers

Every future customer onboarded with their own dedicated WhatsApp Business
number (per `config/tenants.js`'s onboarding steps) will go through this same
Meta-side display-name review. If a customer reports "the bot isn't
responding" right after onboarding, check their number's status in WhatsApp
Manager (step 6 above) before assuming it's a `phone_number_id`/webhook
configuration mistake in this codebase.
