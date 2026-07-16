# DEPLOY — SugarCARE Telecaller Admin Panel

The panel is a **separate Node process** on `127.0.0.1:3010`, reading/writing the
same `data/bot.db` as the bot. It is exposed under `/admin/` via nginx
path-based routing — **no new DNS record or subdomain needed**.

---

## 1. nginx — path-based routing

Add this `location` block inside the existing `server { … }` for your domain
(the same one that already proxies the webhook). It routes `/admin/` to the
panel while everything else continues to hit the bot.

```nginx
# Telecaller admin panel → separate process on :3010
location /admin/ {
    proxy_pass         http://127.0.0.1:3010;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;   # so secure cookies work behind TLS
}
```

Notes:
- The app already serves every route under `/admin/*`, so **no path rewrite** is
  needed — `proxy_pass` without a trailing path preserves `/admin/…`.
- The session cookie is `Secure` in production, so the panel must be served over
  HTTPS (it already is, via your existing TLS on this server block). The
  `X-Forwarded-Proto` header above lets Express know the original scheme.
- Reload after editing: `sudo nginx -t && sudo systemctl reload nginx`.

If Express needs to trust the proxy for correct secure-cookie / rate-limit IP
handling, it is safe to set `app.set('trust proxy', 1)` — not required for the
current config but harmless behind a single nginx hop.

---

## 2. pm2

```bash
cd /path/to/sugarcare-wa-bot
npm install --omit=dev              # installs express-session, bcryptjs, ejs, express-rate-limit

pm2 start admin/server.js --name sugarcare-admin
pm2 save                            # persist across reboots
```

The bot continues to run as its own pm2 process (unchanged). Confirm both:

```bash
pm2 list        # expect: sugarcare-wa-bot (or your bot name) + sugarcare-admin
pm2 logs sugarcare-admin --lines 20
```

Optional log check on boot — you should see:
`SugarCARE admin panel on http://127.0.0.1:3010/admin/  (LIVE mode)`
and three `admin: seeded user "…"` lines on the very first start.

---

## 3. `.env` additions

Add these to the existing `.env` (already gitignored). The bot's variables
(`WHATSAPP_TOKEN`, `PHONE_NUMBER_ID`, `MOCK_MODE`, `DB_PATH`, …) are shared —
the panel reads the same file.

```ini
# Session cookie signing secret — long random string (e.g. `openssl rand -hex 32`)
ADMIN_SESSION_SECRET=<long-random-string>

# Seed passwords (used ONCE on first boot, then stored bcrypt-hashed).
ADMIN_SEED_PASSWORD_NITHIN=<password for nithin>
ADMIN_SEED_PASSWORD_ALEENA=<password for aleena>
ADMIN_SEED_PASSWORD_JITHIN=<password for jithin>

# Optional — defaults to 3010.
# ADMIN_PORT=3010
```

Seeding is idempotent: once a user exists, its stored hash is never overwritten,
so changing an `ADMIN_SEED_PASSWORD_*` value later has **no effect** on an
already-seeded user. To rotate a password, update the hash in the DB directly or
delete that `admin_users` row and restart.

In production, a missing `ADMIN_SEED_PASSWORD_*` means that user is **not
seeded** (no guessable default). A missing `ADMIN_SESSION_SECRET` logs an error
and falls back to an insecure value — always set it.

---

## 4. Rollback

The panel is fully decoupled — removing it cannot affect the bot:

```bash
pm2 delete sugarcare-admin
pm2 save
```

The bot process, the webhook, and `data/bot.db` are unaffected. The additive
`messages` table and `agent_owned` column remain in the DB (harmless — the bot
keeps logging to `messages`, and `agent_owned` stays `0` for every conversation
once nothing sets it). No schema rollback is required.

To also stop the bot writing message history, you would revert the
`feature/admin-panel` changes to `server.js` / `src/db.js` — but there is no
need; the logging is cheap and self-contained.
