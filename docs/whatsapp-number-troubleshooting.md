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

## Update (same day) — Display Name Fix Was Necessary, Not Sufficient

After the display name was corrected and approved, real inbound messages
**still** did not reach the webhook. Before concluding the display-name fix
had failed to actually resolve anything, the investigation went one level
deeper than dashboard checks — verifying, at the request-logging level, that
no raw HTTP request was even arriving at this server for the affected
number's replies:

- `server.js` mounts `morgan('tiny')` (line 42) **before** `/webhook` is
  mounted (line 60) — morgan logs every request Express receives,
  unconditionally, regardless of anything the route handler does internally.
- Inside `routes/webhook.js`'s `router.post('/', ...)` handler, `res.sendStatus(200)`
  is the literal first statement — before the `try` block, before parsing
  `req.body`, before the `if (!message) return` early-exit for non-message
  events. Nothing in this handler can silently swallow a request before
  logging happens.
- Conclusion: a `"POST /webhook 200 ... ms"` morgan line is proof a raw
  request reached this server, completely independent of whether our own
  `"Incoming WhatsApp from..."` log line ever executes.
- Checked Railway's logs against this: every `POST /webhook` line present
  correlated 1:1 with one of our own custom log lines (either an
  `UNKNOWN phone_number_id` warning for unrelated traffic, or a real
  tenant's `Incoming WhatsApp from...`). **Zero** `POST /webhook` lines of
  any kind were ever associated with a reply from the affected number — not
  a silently-swallowed request, an actually-absent one.
- Separately confirmed `KAPA_PHONE_NUMBER_ID`/`KAPA_ACCESS_TOKEN` are both
  present in `.env` (values not exposed), and confirmed **outbound** sending
  works cleanly — a real `sendText()` call via `services/whatsapp.js` to the
  affected number returned `{ ok: true }` with a genuine Meta `messageId`.

### Final Conclusion

Display name approval was a **necessary but not sufficient** fix. With it
addressed, every checkable piece of configuration on both the code side (this
repo) and the dashboard side (Callback URL, Verify Token, subscribed fields,
outbound sending, `.env` credentials) checks out — yet real inbound messages
from this number still never arrive at this server at all, confirmed at the
raw-request level, not just our own application-level logging.

This rules out a code bug or a dashboard misconfiguration. At this point the
issue is a **Meta-side message delivery problem** for this specific number,
and requires escalating to **Meta's WhatsApp Business Platform support**
(via WhatsApp Manager's support/help flow) rather than further local
debugging — there is nothing left to check in this codebase or this
project's own Meta App configuration that would explain the gap.

### Diagnostic Checklist Addendum

7. If steps 1–6 all pass (including a resolved 'Rejected' status) and inbound
   still doesn't arrive: verify at the morgan/raw-request level (see above)
   that no request reaches the server at all, to conclusively rule out a
   code-side silent failure before escalating.
8. If step 7 confirms zero raw requests arriving, this is a Meta-side
   delivery issue — escalate to Meta support directly. Don't keep debugging
   this codebase or the Meta App dashboard further; there's nothing else
   here that can explain messages never reaching a correctly-configured,
   correctly-subscribed webhook.
