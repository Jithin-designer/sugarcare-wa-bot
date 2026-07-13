# README — Deploy the SugarCARE WhatsApp Bot

Deterministic WhatsApp bot (Node.js + Express + SQLite, **no RAG**). This guide
takes you from a clean checkout to receiving real WhatsApp messages.

---

## 0. Requirements

- **Node.js ≥ 18** (developed/tested on Node 25). `node --version`
- A **public HTTPS URL** for the webhook. Meta will not call `http://` or
  `localhost`. Options: a VPS with a domain + reverse proxy (Caddy/Nginx +
  Let's Encrypt), a PaaS (Render/Railway/Fly.io), or `ngrok`/`cloudflared` for
  a quick test tunnel.
- A **Meta WhatsApp Business** app with a phone number (Cloud API).

---

## 1. Install & test locally

```bash
cd sugarcare-wa-bot
npm install
npm test            # expect: Tests 37 passed (37)
```

Run it in mock mode (nothing is sent to WhatsApp):

```bash
npm start           # terminal 1 — listens on :3000, MOCK mode
# terminal 2:
node scripts/simulate.js --scenario new-lead
node scripts/simulate.js --scenario existing
node scripts/simulate.js                       # interactive REPL
```

Outbound messages in mock mode are logged and appended to
`data/mock_outbox.jsonl`.

---

## 2. Configure environment

```bash
cp .env.example .env
```

Fill in `.env`:

| Var | Where to get it | Notes |
|---|---|---|
| `WHATSAPP_TOKEN` | Meta ▸ WhatsApp ▸ API Setup (use a **permanent** System User token) | temp tokens expire in 24h |
| `PHONE_NUMBER_ID` | Meta ▸ WhatsApp ▸ API Setup | numeric id, not the phone number |
| `WABA_ID` | Meta ▸ WhatsApp ▸ API Setup | WhatsApp Business Account id |
| `APP_SECRET` | Meta ▸ App Settings ▸ Basic ▸ App Secret | **required in production** — validates every POST |
| `VERIFY_TOKEN` | you invent it | any random string; paste the same value into Meta |
| `PORT` | e.g. `3000` | the app port behind your HTTPS proxy |
| `MOCK_MODE` | `false` for production | `true` = never sends, logs to mock outbox |
| `DB_PATH` | default `data/bot.db` | SQLite file location |

> ⚠️ In production, if `APP_SECRET` is unset the bot **rejects every webhook
> POST with 401** (fail-safe). The dev default is only used in MOCK_MODE.

---

## 3. Run in production

Behind an HTTPS reverse proxy that forwards to `PORT`:

```bash
MOCK_MODE=false node server.js
```

Keep it alive with a process manager (pick one):

```bash
# pm2
npm i -g pm2 && pm2 start server.js --name sugarcare-wa && pm2 save

# or systemd (unit file sketch)
# [Service]
# WorkingDirectory=/opt/sugarcare-wa-bot
# ExecStart=/usr/bin/node server.js
# EnvironmentFile=/opt/sugarcare-wa-bot/.env
# Restart=always
```

Health check: `curl https://YOURHOST/health` → `{"status":"ok","mode":"live"}`.

---

## 4. Register the webhook in Meta

1. Meta App Dashboard ▸ **WhatsApp ▸ Configuration ▸ Webhook ▸ Edit**.
2. **Callback URL:** `https://YOURHOST/webhook`
3. **Verify token:** the exact `VERIFY_TOKEN` from your `.env`.
4. Click **Verify and save** — Meta sends a GET handshake; the bot echoes
   `hub.challenge` (you'll see `webhook: verified` in the logs).
5. Under **Webhook fields**, subscribe to **`messages`**.
6. Send `hi` from a test phone to your WhatsApp number → you should get the
   Malayalam menu with 3 buttons.

The signature (`X-Hub-Signature-256`) is validated on every POST using
`APP_SECRET`; tampered or unsigned requests get `401`.

---

## 5. Operating notes

- **Leads** are written to `data/bot.db` (`leads` table). Read them with any
  SQLite client:
  ```bash
  sqlite3 data/bot.db "SELECT created_at,phone,name,interest,clinic,priority,lead_type,notes FROM leads ORDER BY id DESC;"
  ```
  `priority = 1` rows (clinical escalations, report/team requests) should be
  actioned first.
- **Conversation state** lives in the `conversations` table; `processed_messages`
  is the idempotency ledger. Both are safe to inspect; avoid hand-editing
  `conversations` while the bot runs.
- **Back up `data/bot.db`** regularly (it holds leads + live conversation state).
- **Editing copy:** change strings in `src/messages.js` only, then `npm test`
  (the banned-word scan runs automatically). Restart to apply.
- **Turning the bot off** for maintenance: stop the process; Meta will retry
  delivery for a while, and dedup means replays are safe when you restart.

---

## 6. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Meta "Verify and save" fails | `VERIFY_TOKEN` mismatch, or URL not reachable over HTTPS |
| All POSTs return 401 | `APP_SECRET` missing/wrong in production |
| Bot receives but never replies | `MOCK_MODE=true` still set (check `/health` → `mode`) |
| "Cannot send" in logs | `WHATSAPP_TOKEN` / `PHONE_NUMBER_ID` missing or token expired |
| Duplicate handling | expected — same `message_id` is logged as `duplicate` and skipped |
