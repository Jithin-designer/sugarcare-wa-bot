# RAILWAY-DEPLOY — SugarCARE WhatsApp Bot on Railway

Deploy the bot to [Railway](https://railway.com) from GitHub, with a persistent
volume for the SQLite database. Takes you from the repo to a public HTTPS URL
you can paste into Meta's webhook config.

> **Repo:** `Jithin-designer/sugarcare-wa-bot` · **branch:** `main`
> **What Railway runs:** `npm install` (compiles `better-sqlite3` from source) →
> `npm start` (which is `node server.js`). Config lives in `railway.json`.

---

## Why Railway works for this bot

- **`better-sqlite3` is a native module** — it compiles against Node during the
  build. Railway's Nixpacks builder includes the C/C++ toolchain by default, so
  this "just works" with no extra config.
- **SQLite needs a persistent disk.** Railway's ephemeral container filesystem is
  wiped on every redeploy/restart — so the DB **must** live on a Railway
  **Volume** (a persistent disk that survives deploys). §3 sets this up. Without
  it, every redeploy would silently start with an empty `leads` table.
- **The app already reads `PORT` and `DB_PATH` from the environment** — no code
  changes were needed. Railway injects `PORT`; you set `DB_PATH` to the volume
  path (§2 + §3).

---

## 0. Prerequisites

- A Railway account (railway.com) — sign in with GitHub.
- The repo pushed to GitHub: `Jithin-designer/sugarcare-wa-bot`, `main` branch.
- Your Meta WhatsApp credentials ready to paste into the Railway dashboard
  (you set these by hand — this guide never handles secret values).

---

## 1. Create the project from GitHub

1. Railway dashboard → **New Project** → **Deploy from GitHub repo**.
2. Authorize Railway to access your GitHub if prompted, then pick
   **`Jithin-designer/sugarcare-wa-bot`**.
3. Confirm the deployed branch is **`main`** (Settings → Service → Source → Branch).
4. Railway reads `railway.json`, detects a Node app, and kicks off the first
   build (`npm install` → `npm start`). **It will boot, but do NOT rely on this
   first deploy yet** — the env vars and volume aren't set. Finish §2–§4 first,
   then redeploy.

---

## 2. Set environment variables (Railway dashboard → Variables)

Set these in **Service → Variables**. **Names only below — you fill in the
values by hand from Meta.** Do not commit these anywhere.

| Variable | Notes |
|---|---|
| `WHATSAPP_TOKEN` | Permanent System User token from Meta. Required for live sending. |
| `PHONE_NUMBER_ID` | From Meta ▸ WhatsApp ▸ API Setup (numeric id, not the phone number). |
| `APP_SECRET` | Meta ▸ App Settings ▸ Basic. **Required in production** — without it every webhook POST is rejected with 401 (fail-safe). |
| `VERIFY_TOKEN` | A random string you invent; you paste the SAME value into Meta's webhook config (§5). |
| `MOCK_MODE` | Set to **`false`** to send real WhatsApp messages. (Omitting it defaults to mock mode — the bot would receive messages but never reply for real.) |
| `DB_PATH` | Set to a file path **inside** your volume mount — e.g. `/data/bot.db` (see §3). Keep it consistent with the volume mount path. |

Notes:
- **`PORT` — do NOT set this.** Railway assigns it automatically and injects it;
  the app already reads `process.env.PORT`. Setting it by hand can break routing.
- `MOCK_OUTBOX` / `SIM_BASE_URL` are for local development/the simulator only —
  not needed on Railway.
- Anything you don't set falls back to the code's defaults (see `.env.example`
  in the repo for the full reference). The **minimum for a live bot** is
  `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID`, `APP_SECRET`, `VERIFY_TOKEN`,
  `MOCK_MODE=false`, and `DB_PATH`.

---

## 3. Add the persistent volume for SQLite

This is the step that makes leads/conversations survive redeploys.

1. Service → **Settings → Volumes → + New Volume** (or **Data** tab depending on
   dashboard version).
2. Set the **Mount path** to **`/data`**.
3. Save. Railway attaches a persistent disk mounted at `/data` in your container.
4. Make sure the `DB_PATH` variable from §2 points at a file **inside** that
   mount — **`/data/bot.db`**.

**Important — point `DB_PATH` at a FILE inside the volume, not the mount dir
itself.** Use `/data/bot.db` (correct), not `/data` (wrong — SQLite can't open a
directory as a database). The app auto-creates the `/data` directory contents on
first boot; you don't pre-create anything.

**WAL note:** the DB runs in SQLite WAL mode, so it creates three files next to
each other — `bot.db`, `bot.db-wal`, `bot.db-shm`. With `DB_PATH=/data/bot.db`
all three live on the volume together and persist correctly. Nothing extra to
configure.

---

## 4. Redeploy with everything in place

After §2 and §3 are set:

1. Service → **Deployments → Redeploy** (or push any commit to `main` — Railway
   auto-deploys on push to the tracked branch).
2. Watch the **build + deploy logs**. On success you'll see the app's own boot
   line:
   ```
   SugarCARE WA bot listening on :<PORT>  (LIVE mode)
   ```
   `(LIVE mode)` confirms `MOCK_MODE=false` took effect. `(MOCK mode)` means it's
   still mocking — re-check the `MOCK_MODE` variable.

---

## 5. Get the public URL + register the Meta webhook

1. **Generate the public URL:** Service → **Settings → Networking → Public
   Networking → Generate Domain**. Railway gives you an HTTPS URL like
   `https://sugarcare-wa-bot-production.up.railway.app`.
   - (If asked for a port to expose, use the same port the app logs on boot —
     it's the `PORT` Railway injected.)
2. **Health check** (no secrets involved):
   ```
   curl https://YOUR-RAILWAY-URL/health
   → {"status":"ok","mode":"live"}
   ```
   `"mode":"live"` confirms the deployed service is in live mode.
3. **Register the webhook in Meta** (Meta for Developers → your app →
   **WhatsApp → Configuration → Webhook → Edit**):
   - **Callback URL:** `https://YOUR-RAILWAY-URL/webhook`
   - **Verify token:** the exact same string you set as `VERIFY_TOKEN` in §2.
   - Click **Verify and save** — Meta sends a GET handshake; the bot echoes the
     challenge and you'll see `webhook: verified` in the Railway logs.
   - Under **Webhook fields**, subscribe to **`messages`**.
4. **Test end-to-end:** send `hi` from a test phone to your WhatsApp number →
   you should get the Malayalam welcome menu. The `X-Hub-Signature-256` on every
   POST is validated with `APP_SECRET`; tampered/unsigned requests get `401`.

---

## 6. Operating notes

- **Reading leads:** the DB lives on the volume at `/data/bot.db`. To inspect it,
  use Railway's shell (Service → **Shell**, if available on your plan) or add a
  temporary read-only admin route — the file isn't downloadable from the
  dashboard directly. Leads land in the `leads` table; `priority = 1` rows
  (clinical escalations, report/team requests) should be actioned first.
- **Redeploys are safe:** conversation state + leads are on the persistent
  volume, and inbound message dedup (`processed_messages`) means Meta's delivery
  retries during a restart won't double-process.
- **Backups:** periodically copy `/data/bot.db` off the volume (via the Railway
  shell) — it holds all leads + live conversation state.
- **Editing copy / redeploying code:** push to `main`; Railway auto-builds and
  redeploys. Run `npm test` locally first (the banned-word scan runs in CI-style
  as part of the suite).
- **`data/` and `.env` are gitignored** — the local dev DB and any secrets never
  reach the repo or Railway's build. Railway gets its config purely from the
  dashboard Variables (§2) and the mounted volume (§3).

---

## 7. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Build fails compiling `better-sqlite3` | Rare on Nixpacks (toolchain is included). Check the Node version — `engines.node` is `>=18`; Railway should honor it. |
| Leads/conversations reset after each deploy | Volume not mounted at `/data`, or `DB_PATH` not pointing inside it. Re-check §3. |
| All webhook POSTs return 401 | `APP_SECRET` missing/wrong in Railway Variables (production rejects unsigned requests by design). |
| Bot receives but never replies | `MOCK_MODE` still unset/true — check `/health` shows `"mode":"live"`. |
| Meta "Verify and save" fails | `VERIFY_TOKEN` mismatch between Meta and Railway, or the public domain not generated / not reachable over HTTPS. |
| `SqliteError: unable to open database file` | `DB_PATH` points at the mount dir (`/data`) instead of a file (`/data/bot.db`), or the volume isn't attached. |
| App crashes then restarts repeatedly | `railway.json` restarts on failure (up to 10×). Check deploy logs for the underlying error — usually a missing required env var. |
