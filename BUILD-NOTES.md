# BUILD-NOTES — Telecaller Admin Panel

Branch: `feature/admin-panel` (do **not** push to main).
All work is additive and fully testable in `MOCK_MODE`. All **91** tests pass
(78 pre-existing + 13 new). No existing state-machine flow logic was changed
beyond the single `agent_owned` check, and the webhook route's response
behaviour is untouched.

---

## 1. Bot changes (additive only)

### `src/db.js`
- **`messages` table** added to the startup schema (`CREATE TABLE IF NOT EXISTS`)
  with the `idx_messages_phone` / `idx_messages_timestamp` indexes. Permanent
  log of every inbound + outbound message. Never purged.
- **`agent_owned` column** on `conversations`, added via a guarded migration
  (`ensureColumn` → probes `PRAGMA table_info` then `ALTER TABLE ADD COLUMN`,
  because `ALTER … ADD COLUMN` is not idempotent). Runs safely on every boot,
  including against the existing production `bot.db`.
- **WAL** (`db.pragma('journal_mode = WAL')`) was **already present** — required
  so the bot and the admin panel can read/write the same file concurrently.
  Verified live: `journal_mode = wal`.
- New query methods: `logMessage()`, `messagesForPhone()`, `setAgentOwned()`.
  The existing `upsertConversation` statement does **not** list `agent_owned`,
  so a normal `saveConversation` can never clobber the telecaller's flag (INSERT
  → `DEFAULT 0`; UPDATE → preserved).

### `server.js`
- Imports `describe` (whatsapp.js) and `isClinicalQuestion` (stateMachine.js).
- **Inbound logging**: `logInbound()` after the idempotency check (so duplicates
  aren't double-logged) and before every gate (so dormant / agent-owned pings
  still appear in history). Interactive taps are logged with the richer
  `button_reply` / `list_reply` type.
- **Outbound logging**: `logOutbound()` inside the dispatch loop — every actual
  send is logged, MOCK_MODE included.
- **`agent_owned` gate** (the only flow change), placed after the terminal-reset
  block and before `processMessage`:
  - `agent_owned = 1` + free text that is **not** a clinical question →
    bot stays silent (inbound already logged), returns status `'agent_owned'`.
  - Patient taps **any** interactive button/list row → `setAgentOwned(0)` then
    falls through to normal bot processing (ownership released).
  - Clinical escalation still fires even while agent-owned (safety guard) — a
    clinical free-text message is never left silent.
  - Note on "banned words": the compliance guard (`assertClean`) is **outbound
    only** in this codebase, so there is no inbound banned-word path to fire;
    the safety guard that "still fires" while agent-owned is the clinical
    escalation. This is intentional and matches the existing HARD RULE wiring.

No changes to: signature verification, the 200-in-5s ACK, idempotency, dormancy
gating, or the state machine's decisions.

---

## 2. Admin panel files added (`admin/`)

| File | Purpose |
|------|---------|
| `admin/server.js` | Separate Express app (port 3010). `createAdminApp({db, send})` factory + boot block. All routes under `/admin/*`. |
| `admin/db.js` | Opens the **same** `data/bot.db` via the bot's `openDb()` (so shared migrations run), adds admin-owned `admin_users` + `agent_views` tables and all admin queries. |
| `admin/auth.js` | express-session (12h rolling), bcrypt seeding of the 3 users, `verifyLogin`, `requireAuth` guard, `loginLimiter` (express-rate-limit). |
| `admin/util.js` | Pure view helpers: `windowInfo` (24h), `relativeTime`, `clock`, `truncate`. |
| `admin/views/*.ejs` | `login`, `conversations` (two-pane), `leads`, `partials/head`, `partials/foot`. Server-rendered, no build step. |
| `admin/public/style.css` | SugarCARE tokens (purple `#4A2FA0`, orange `#E86A1A`, ink `#1A0E50`), Plus Jakarta Sans + Noto Sans Malayalam, two-pane desktop / stacked mobile. |
| `admin/seed-demo.cjs` | Inserts 3 demo conversations (open/bot-owned, open/agent-owned, closed-window) with mixed in/out message history + leads. |

**New dependencies** (exactly the four allowed): `express-session`, `bcryptjs`
(chosen over native `bcrypt` — pure JS, no compile step), `ejs`,
`express-rate-limit`.

### Routes
```
GET  /admin/login              login form
POST /admin/login              authenticate (rate-limited)
GET  /admin/logout             clear session
GET  /admin/                   conversation list (auth)
GET  /admin/conv/:phone        conversation view (auth)
GET  /admin/conv/:phone/messages   JSON thread for the 5s poll (auth) — added for polling
POST /admin/reply              send a reply (auth) body: {phone, text}
POST /admin/release/:phone     release to bot (auth)
GET  /admin/leads              leads table (auth)
```
(`/admin/conv/:phone/messages` is an additive read-only JSON endpoint powering
the "poll every 5s, no websockets" auto-refresh.)

---

## 3. How to test locally (MOCK_MODE)

```bash
npm install                     # installs the 4 new deps
node admin/seed-demo.cjs        # seed 3 demo conversations into data/bot.db

# start the admin panel with dev credentials
MOCK_MODE=true \
ADMIN_SESSION_SECRET=devsecret \
ADMIN_SEED_PASSWORD_NITHIN=demo123 \
ADMIN_SEED_PASSWORD_ALEENA=demo123 \
ADMIN_SEED_PASSWORD_JITHIN=demo123 \
node admin/server.js
# → http://127.0.0.1:3010/admin/login
```
Log in as **nithin / demo123** (or aleena / jithin). If the seed-password env
vars are unset in MOCK_MODE, each user is seeded with the dev password
`changeme` (a warning is printed).

The bot and panel can run together (`npm start` on :3000, panel on :3010),
both against `data/bot.db`. In MOCK_MODE the reply box logs to `messages` +
console and never calls the Graph API. Verified end-to-end in a browser:
login → list badges (unread/🔒/window) → thread bubbles (Malayalam renders) →
send reply (logged, sets `agent_owned=1`) → closed-window disables composer →
Release to bot (`agent_owned=0`) → Leads tab → mobile stacked layout.

Run the tests: `npm test`  →  **91 passed**.

New tests: `tests/messagesLog.test.js` (inbound/outbound logging, agent_owned
suppression, interactive resume), `tests/window.test.js` (24h open/closed/edge),
`tests/admin.test.js` (unauth redirect, reply logs without fetch, closed-window
refusal).

---

## 4. Data safety status

- ✅ `.gitignore` already ignored `data/` (covers `bot.db`, `bot.db-wal`,
  `bot.db-shm`, `mock_outbox.jsonl`). The three explicit `data/bot.db*` lines
  were **added** anyway for belt-and-suspenders per the brief.
- ✅ `git ls-files` shows **no** `.db` / `data/` files tracked — nothing to
  untrack. (If a `.db` were ever tracked, the untrack command would be:
  `git rm --cached data/bot.db data/bot.db-wal data/bot.db-shm` — not needed here.)
- ✅ No `.db` file is committed in this branch.
- ✅ Live `bot.db` verified after migration: `messages` table present,
  `conversations.agent_owned` present, `journal_mode = wal`.

---

## 5. Blockers / manual verification steps

- **None blocking.** All features verified in MOCK_MODE + browser.
- **Session store**: express-session uses the default in-memory `MemoryStore`
  (fine for a single pm2 instance — see `admin/DEPLOY.md`). If the panel is ever
  scaled to multiple processes, swap in a shared store; today it is single-proc.
- **Live send** (`MOCK_MODE=false`) uses the existing `sendMessage()` client
  (Graph API v25.0, `WHATSAPP_TOKEN` + `PHONE_NUMBER_ID`). This path was **not**
  exercised against the real Meta API here — verify one real reply after deploy.
- **`npm audit`** reports pre-existing advisories in transitive deps; not
  introduced by this branch and left untouched (no `audit fix --force`).
