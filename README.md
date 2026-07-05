# KAPA Bot — Multi-Tenant WhatsApp Automation Platform

One Node.js service, built to serve **every** Kapa Technologies customer's WhatsApp automation — including Kapa's own internal use — safely isolated from each other, all through the official **Meta WhatsApp Cloud API**.

- 👋 **Lead / signup notifications**
- 🕐 **Employee check-in / check-out** (with location confirmation)
- 🚨 **Error / health monitoring alerts**
- 💳 **Subscription / billing alerts**
- 🤖 **Admin dashboard via WhatsApp chat**

Every module above is **per-tenant** — Kapa Technologies is tenant #1, and every future customer (Asia Avid, or anyone else) becomes tenant #2, #3, and so on, all running on this same codebase with zero risk of seeing each other's data.

---

## How multi-tenancy works here

WhatsApp's Cloud API lets **one Meta App hold many phone numbers**. Every incoming message tells you exactly which number it arrived on (`phone_number_id`). This bot uses that to route:

- **Incoming WhatsApp messages** → tenant resolved by `phone_number_id`
- **Incoming API calls** (leads, errors, etc. from a tenant's own systems) → tenant resolved by their unique `x-api-key`

All tenant configuration lives in **`config/tenants.js`** — one array, one object per company. No tenant ID ever needs to appear in a URL; everything is resolved automatically and safely scoped.

---

## 1. Local setup

```bash
npm install
cp .env.example .env
npm start
```

Runs in **mock mode** automatically if no Meta credentials are set — logs what it *would* send instead of actually sending, so you can build/test everything first.

---

## 2. Onboarding a new tenant (customer)

1. **In Meta**: add their WhatsApp number — either under Kapa's existing App (simplest, recommended default) or their own separate App if they need billing/ownership separation
2. **In `config/tenants.js`**: copy the example block at the bottom, fill in their real `phoneNumberId`, `officeNumber`, `adminNumbers`
3. **In your `.env`** (or Render environment): add their env vars following the `<TENANTID>_*` naming pattern shown in `.env.example`
4. **Generate their API key**: `openssl rand -hex 24` → give this to them for their own integrations (their signup form, their backend, etc.) to use as the `x-api-key` header
5. **Point their number's webhook** at the same shared URL: `https://kapa-bot.onrender.com/webhook` — no per-tenant webhook setup needed
6. Deploy (or restart) — they're live. No code changes required for a standard onboarding.

**Asia Avid's existing system** (`kapa-attendance-bot1`) stays completely untouched and independent until you deliberately choose to migrate them onto this platform using the steps above.

---

## 3. Setting up Meta WhatsApp Cloud API (first time)

1. [developers.facebook.com](https://developers.facebook.com) → create/open an App → add **WhatsApp** product
2. Under **API Setup**, copy the **access token** and **phone number ID**
3. Put the access token in `META_ACCESS_TOKEN` (shared default for all tenants on this App)
4. Put the phone number ID in that tenant's `<TENANTID>_PHONE_NUMBER_ID`
5. **Webhook** (once, shared across all tenants on this App): **WhatsApp → Configuration**
   - Callback URL: `https://YOUR_DEPLOYED_URL/webhook`
   - Verify token: must match `META_VERIFY_TOKEN`
   - Subscribe to the **messages** field

---

## 4. Deploying (Render)

1. Push to GitHub
2. Render → **New → Web Service** → connect the repo
3. Build command: `npm install` · Start command: `npm start`
4. Add every variable from `.env.example`, filled in for each tenant you're launching with
5. Deploy

⚠️ Render's free tier sleeps after 15 min idle (first request after sleep takes 10–30s) and its filesystem is **ephemeral** — `data/db.json` resets on every redeploy. Fine for testing; for real production volume across multiple paying customers, either add a persistent disk on Render or migrate `services/db.js` to a real hosted database (the tenant-scoping logic stays identical either way).

---

## 5. Connecting a tenant's own systems (e.g. `submit.php`)

```php
'wa_channel' => 'custom_bot',
'custom_bot' => [
    'api_url'  => 'https://kapa-bot.onrender.com/api/leads',
    'api_key'  => 'THEIR_UNIQUE_API_KEY_HERE',
],
```

```php
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
    'x-api-key: THEIR_UNIQUE_API_KEY_HERE'
]);
```

---

## 6. API Reference

All `/api/*` routes require an `x-api-key` header — this is what resolves *which tenant* the request belongs to.

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/leads` | Send a lead notification |
| `GET`  | `/api/leads` | View this tenant's last 50 leads |
| `POST` | `/api/attendance/manual` | Manually log a check-in/out |
| `GET`  | `/api/attendance/today` | This tenant's today attendance summary |
| `POST` | `/api/errors/report` | Report a system error/incident |
| `GET`  | `/api/errors` | This tenant's last 50 errors |
| `POST` | `/api/subscriptions/alert` | Report a billing/subscription event |
| `GET`  | `/api/subscriptions` | This tenant's last 50 subscription events |

### Example

```bash
curl -X POST https://YOUR_DEPLOYED_URL/api/errors/report \
  -H "Content-Type: application/json" \
  -H "x-api-key: THEIR_UNIQUE_API_KEY" \
  -d '{"source": "Payment Webhook", "message": "Signature check failed", "severity": "high"}'
```

---

## 7. WhatsApp commands (per tenant)

**Any employee** (if `features.attendance` is on for that tenant):
- `check in` → bot asks for location → confirmed
- `check out` → same flow

**That tenant's admin numbers only** (if `features.adminDashboard` is on):
- `today sales` · `pending approvals` · `today attendance` · `new leads` · `system status` · `help`

---

## 8. Wiring real backend data per tenant

Edit `services/adminCommands.js` — the `// TODO` sections show exactly where to plug in each tenant's real KAPA HUB (or other) API, using `tenant.id` to know which company's data to fetch.

---

## 9. Data storage & isolation

`data/db.json` is structured as:
```json
{ "tenants": { "kapa": { "leads": [...], "attendance": [...] }, "asia-avid": { ... } } }
```
Every route goes through `tenantDb(tenant.id)` — there is no code path that can accidentally read or write another tenant's data.
