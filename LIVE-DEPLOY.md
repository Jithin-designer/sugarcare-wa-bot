# Live Deploy Guide — SugarCARE WhatsApp Bot (Node.js)
Connect to +91 92920 25379 (Areekode WhatsApp / Phone Number ID: 1232912896566193)

---

## What this bot is

A deterministic state machine — no RAG, no LLM, no embeddings. It acts as a Malayalam-first receptionist:
- New visitors → captures lead (name, interest, preferred clinic)
- Existing patients → books a callback for appointment
- Clinical questions (insulin, dose, HbA1c, etc.) → immediately escalates to human
- Banned words ("reversal", "cure", "മുക്തി", "മാറ്റിയെടുക്കാം") → blocked at outbound level

**37/37 tests passing. Built and tested locally. Ready to connect.**

---

## Stack

- Node.js ≥ 18, ES modules (`"type": "module"`)
- Express 4 (webhook server)
- better-sqlite3 (local SQLite — `data/bot.db`)
- Vitest (tests)
- Meta WhatsApp Cloud API v25.0
- No external AI APIs in the message flow

---

## Credentials needed

```
WHATSAPP_TOKEN=        # Permanent System User token from Meta Business Suite
PHONE_NUMBER_ID=1232912896566193   # Already filled — Areekode number
WABA_ID=3507409086077679           # Already filled
APP_SECRET=            # Meta App > App Settings > Basic > App Secret
VERIFY_TOKEN=          # Any random string — you choose, then paste same into Meta webhook config
MOCK_MODE=false        # Set to false to send real messages
PORT=3000
DB_PATH=data/bot.db
```

---

## Step-by-step deploy

### 1. Copy and fill .env
```bash
cp .env.example .env
# Fill WHATSAPP_TOKEN, APP_SECRET, VERIFY_TOKEN
# Set MOCK_MODE=false
```

### 2. Install and start
```bash
npm install
npm start
# Output: SugarCARE WA bot listening on :3000 (LIVE mode)
```

### 3. Expose to internet (needs HTTPS)
Meta requires HTTPS. Options:
- **Cloudflare Tunnel** (zero config, free): `cloudflared tunnel --url http://localhost:3000`
- **ngrok**: `ngrok http 3000`
- VPS with nginx + Let's Encrypt (permanent)

Note your public URL, e.g. `https://abc123.trycloudflare.com`

### 4. Configure webhook in Meta
Go to: Meta for Developers → Your App → WhatsApp → Configuration

**Webhook URL:** `https://your-public-url/webhook`
**Verify token:** (same string you put in VERIFY_TOKEN)

Click **Verify and Save** — the bot responds to the GET handshake automatically.

Then subscribe to: **messages** (under Webhook fields)

### 5. Verify it's live
```bash
curl https://your-public-url/health
# → {"status":"ok","mode":"live"}
```

Send a WhatsApp message to +91 92920 25379 from any phone. The bot should reply in Malayalam.

---

## What happens on first message

A new user gets:

**Malayalam menu (WhatsApp interactive buttons):**
- 🌟 SugarCARE അറിയാൻ (Learn about SugarCARE)
- 📅 അപ്പോയിന്റ്മെന്റ് (I'm a patient, book callback)
- 🌐 English

Leads flow: interest → clinic selection → name → confirmation → saved to SQLite `leads` table.

Patient flow: clinic selection → preferred day → callback confirmation → dormant 12h.

Clinical question at any point → immediate human escalation message, bot goes dormant.

---

## Leads — how to read them

Leads currently land in SQLite only (`data/bot.db`). Read them:

```bash
sqlite3 data/bot.db "SELECT * FROM leads ORDER BY created_at DESC LIMIT 20;"
```

Or install DB Browser for SQLite and open `data/bot.db`.

**No push to CRM/Slack yet** — that's the next integration step.

---

## State machine states

```
MENU → LEAD_INTEREST → LEAD_CLINIC → LEAD_NAME → (lead saved, dormant)
MENU → PATIENT_MENU → APPT_CLINIC → APPT_DAY → (callback saved, dormant)
Any state → HUMAN_HANDOFF (clinical question detected)
DORMANT → resets to MENU after 12h
```

---

## Files

```
sugarcare-wa-bot/
├── server.js              Entry point. Webhook security, 200ms ACK, dispatch.
├── src/
│   ├── stateMachine.js    Pure FSM. processMessage(conv, msg) → {nextState, replies, ...}
│   ├── db.js              SQLite helpers — conversations, leads, processed_messages
│   ├── messages.js        All ML + EN strings + WhatsApp payload builders
│   ├── bannedWords.js     assertClean() — throws if banned word found in outbound
│   ├── whatsapp.js        sendMessage() — MOCK or real Meta API call
│   └── patientLookup.js   EMR lookup stub — returns null (blocker: no EMR API yet)
├── scripts/simulate.js    npm run sim — runs scenarios without real WhatsApp
├── tests/
│   ├── stateMachine.test.js   State transitions, clinical guard, language switch
│   ├── bannedWords.test.js    All 4 banned words in EN + ML
│   ├── webhook.test.js        Signature validation, dedup, 401 on bad sig
│   └── conversations.test.js  Full new-lead and existing-patient flows
├── .env.example
├── PLAN.md
├── HANDOFF.md
└── README-DEPLOY.md
```

---

## Security (all active)

- Every POST: `X-Hub-Signature-256` verified (HMAC-SHA256 with APP_SECRET). Bad sig → 401.
- Webhook ACKs 200 immediately, processes async — Meta won't retry.
- Message dedup by WhatsApp `message_id` — stored in `processed_messages` table.
- 24h session window enforced — bot won't send outside it.
- Dormancy: after handoff or lead capture, bot stays silent for 12h so human can reply.
- PHONE_NUMBER_ID and WABA_ID read from env — never hardcoded.

---

## Known issues / next steps

| # | Issue | Action |
|---|---|---|
| 1 | Leads in SQLite only | Wire Slack/email notification or push to CRM |
| 2 | No EMR lookup | `patientLookup.js` returns null — patient ID lookup not implemented |
| 3 | SQLite is local | For multi-server deploy, migrate to PostgreSQL (Neon) |
| 4 | Malayalam copy | Review `src/messages.js` — wording written by AI, check it sounds natural |

---

## Run tests before going live

```bash
npm test
# All 37 tests should pass
```

If any fail after filling .env, check that `MOCK_MODE` is correctly set and `WHATSAPP_TOKEN` doesn't have extra whitespace.
