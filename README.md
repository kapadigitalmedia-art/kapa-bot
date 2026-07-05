# KAPA Bot

Kapa Technologies' WhatsApp automation platform — one Node.js service handling:

- 👋 **Lead notifications** — replaces the broken `/notify-lead` endpoint your `submit.php` was calling
- 🕐 **Employee check-in / check-out** — via WhatsApp chat, with location confirmation
- 🚨 **Error / health monitoring alerts** — KAPA ONE / KAPA HUB can report problems here
- 💳 **Subscription alerts** — payment received/due/failed, trial expiring, upgrades, cancellations
- 🤖 **Admin dashboard via WhatsApp** — admins text commands like `today sales`, `today attendance`, get instant replies

Built on the **official Meta WhatsApp Cloud API** — no third-party dependency, no free-tier reliability issues.

---

## 1. Local setup

```bash
npm install
cp .env.example .env
```

Open `.env` and fill in what you have. **You can run and test everything immediately, even with WhatsApp fields blank** — the bot automatically runs in **MOCK MODE**, logging what it *would* send to the console instead of actually sending it. This lets you wire up `submit.php`, test attendance, error alerts, etc. before WhatsApp is fully configured.

```bash
npm start
```

You should see:
```
[INFO] KAPA Bot listening on port 3000
[INFO] Mock mode: ON (no real WhatsApp messages will be sent)
```

---

## 2. Setting up the real Meta WhatsApp Cloud API

1. Go to [developers.facebook.com](https://developers.facebook.com) → create/open an App → add the **WhatsApp** product
2. Under **API Setup**, copy:
   - **Temporary access token** (or generate a permanent one under System Users for production)
   - **Phone number ID**
   - **WhatsApp Business Account ID**
3. Paste these into `.env`:
   ```
   META_ACCESS_TOKEN=...
   META_PHONE_NUMBER_ID=...
   META_WABA_ID=...
   ```
4. To connect your **real business number** (+91 75500 08031) instead of Meta's test number, follow Meta's phone number verification flow under **API Setup → Add phone number**.

### Configuring the webhook (for two-way chat: check-in/out + admin commands)

1. In the same App dashboard → **WhatsApp → Configuration**
2. **Callback URL**: `https://YOUR_DEPLOYED_URL/webhook`
3. **Verify token**: must match `META_VERIFY_TOKEN` in your `.env` (defaults to `kapa-verify-2026` — change this to your own value)
4. Subscribe to the **messages** field

Once verified, incoming WhatsApp messages will flow into `/webhook` and the bot will respond automatically.

---

## 3. Deploying (Render — same platform as your existing bot)

1. Push this folder to a GitHub repo
2. On [Render](https://render.com) → **New → Web Service** → connect the repo
3. **Build command**: `npm install`
4. **Start command**: `npm start`
5. Add all the variables from `.env.example` under **Environment**
6. Deploy — Render gives you a URL like `https://kapa-bot.onrender.com`
7. Use that URL + `/webhook` when configuring Meta's webhook (step 2 above)

⚠️ **Note on Render's free tier**: it sleeps after 15 minutes of inactivity, causing the first request after sleep to take 10–30 seconds. For a bot people expect instant replies from, consider Render's paid tier (from $7/mo) or an always-on host once this goes into real production use.

---

## 4. Connecting `submit.php` to this bot (fixes your immediate signup issue)

In `submit.php`, update the config to point at your deployed bot instead of CallMeBot:

```php
'wa_channel' => 'custom_bot',

'custom_bot' => [
    'api_url'       => 'https://YOUR_DEPLOYED_URL/api/leads',
    'notify_number' => '917550008031',
],
```

You'll also need to add the `x-api-key` header to the cURL call in `submit.php` matching your bot's `INTERNAL_API_KEY`:

```php
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
    'x-api-key: YOUR_INTERNAL_API_KEY_HERE'
]);
```

---

## 5. API Reference

All `/api/*` routes require an `x-api-key` header matching `INTERNAL_API_KEY` in `.env`.

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/leads` | Send a lead notification (called by `submit.php`) |
| `GET`  | `/api/leads` | View last 50 captured leads |
| `POST` | `/api/attendance/manual` | Manually log a check-in/out |
| `GET`  | `/api/attendance/today` | Today's attendance summary |
| `POST` | `/api/errors/report` | Report a system error/incident |
| `GET`  | `/api/errors` | View last 50 errors |
| `POST` | `/api/subscriptions/alert` | Report a billing/subscription event |
| `GET`  | `/api/subscriptions` | View last 50 subscription events |

### Example: reporting an error from KAPA ONE's backend

```bash
curl -X POST https://YOUR_DEPLOYED_URL/api/errors/report \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_INTERNAL_API_KEY" \
  -d '{
    "source": "KAPA ONE Payment Webhook",
    "message": "Stripe webhook signature verification failed",
    "severity": "high"
  }'
```

### Example: reporting a subscription payment

```bash
curl -X POST https://YOUR_DEPLOYED_URL/api/subscriptions/alert \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_INTERNAL_API_KEY" \
  -d '{
    "company": "Asia Avid Sdn Bhd",
    "event": "payment_received",
    "plan": "Professional",
    "amount": "999"
  }'
```

Valid `event` values: `payment_received`, `payment_due`, `payment_failed`, `trial_expiring`, `upgraded`, `downgraded`, `cancelled`

---

## 6. WhatsApp commands (what employees/admins type)

**Any employee:**
- `check in` → bot asks for location → employee shares it → recorded
- `check out` → same flow

**Admin numbers only** (set via `ADMIN_WHATSAPP_NUMBERS` in `.env`):
- `today sales`
- `pending approvals`
- `today attendance`
- `new leads`
- `system status`
- `help`

---

## 7. Wiring real data into the Admin Dashboard

Right now, `today sales` and `pending approvals` return placeholder text. To connect them to real KAPA HUB data, edit `services/adminCommands.js` — the exact spots are marked with `// TODO`. Example:

```js
if (text.includes('sales')) {
  const res = await axios.get(`${config.kapaHub.baseUrl}/reports/today-sales`, {
    headers: { Authorization: `Bearer ${config.kapaHub.apiKey}` }
  });
  return `💰 Today's Sales: RM ${res.data.total}`;
}
```

Set `KAPA_HUB_API_BASE_URL` and `KAPA_HUB_API_KEY` in `.env` once that API exists.

---

## 8. Data storage

Uses a simple local JSON file (`data/db.json`) via `lowdb` — no external database needed to get started. This is fine for moderate volume; if you outgrow it later, swap `services/db.js` for a real database (PostgreSQL, MongoDB, or your existing Zoho Creator backend) without touching any of the route files, since they only ever call `db.get(...)`.

**Important on Render**: the free tier's filesystem is ephemeral — `data/db.json` will reset on every redeploy/restart. For anything beyond quick testing, either upgrade to a persistent disk on Render, or migrate `services/db.js` to a real hosted database.
