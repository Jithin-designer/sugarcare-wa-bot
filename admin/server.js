/**
 * admin/server.js — SugarCARE telecaller admin panel.
 *
 * A SEPARATE Express process (port 3010) that reads/writes the SAME data/bot.db
 * as the bot. Server-rendered EJS, session auth, no build step. Behind nginx it
 * is mounted at /admin/ (path-based routing) so every route here is /admin/*.
 *
 * It never imports the bot's webhook/state-machine flow — the only shared code
 * is the db layer, the WhatsApp send client, and the message builders. That
 * keeps the two processes decoupled: deleting this panel cannot affect the bot.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';

import { openAdminDb, withAdminQueries } from './db.js';
import { seedUsers, verifyLogin, sessionMiddleware, requireAuth, loginLimiter } from './auth.js';
import { windowInfo, relativeTime, truncate, clock } from './util.js';
import { sendMessage } from '../src/whatsapp.js';
import { textMsg } from '../src/messages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isMock = () => String(process.env.MOCK_MODE ?? 'true').toLowerCase() !== 'false';

/**
 * Build the admin Express app.
 * @param {object}   opts
 * @param {object}   opts.db    admin-augmented db (openAdminDb / withAdminQueries result)
 * @param {Function} opts.send  send(to, payload) → used for outbound replies (default: real client)
 */
export function createAdminApp({ db, send = sendMessage } = {}) {
  seedUsers(db);

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use('/admin/static', express.static(path.join(__dirname, 'public')));
  app.use(sessionMiddleware());

  // View helpers available to every template.
  app.locals.relativeTime = relativeTime;
  app.locals.truncate = truncate;
  app.locals.clock = clock;

  // ── Auth ───────────────────────────────────────────────────────────────────

  app.get('/admin/login', (req, res) => {
    if (req.session.user) return res.redirect('/admin/');
    res.render('login', { error: null });
  });

  app.post('/admin/login', loginLimiter(), (req, res) => {
    const { username, password } = req.body || {};
    const user = verifyLogin(db, username, password);
    if (!user) {
      return res.status(401).render('login', { error: 'Invalid username or password.' });
    }
    req.session.user = user;
    res.redirect('/admin/');
  });

  app.get('/admin/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/admin/login'));
  });

  // Everything below requires a session.
  app.use('/admin', requireAuth);

  // ── Conversation list (left pane) ────────────────────────────────────────────

  app.get('/admin/', (req, res) => {
    const now = Date.now();
    const conversations = decorateList(db.conversationList(), now);
    res.render('conversations', {
      user: req.session.user,
      conversations,
      selected: null,
      messages: [],
      agentOwned: false,
      window: { open: false, msLeft: 0 },
      err: null,
      now,
    });
  });

  // ── Conversation view (right pane) ───────────────────────────────────────────

  app.get('/admin/conv/:phone', (req, res) => {
    const now = Date.now();
    const phone = req.params.phone;
    db.markViewed(phone, now);        // opening the thread clears its unread badge
    const conversations = decorateList(db.conversationList(), now);
    const messages = db.messagesForPhone(phone);
    const conv = db.getConversation(phone);
    res.render('conversations', {
      user: req.session.user,
      conversations,
      selected: phone,
      messages,
      agentOwned: !!(conv && conv.agent_owned),
      window: windowInfo(db.lastInboundAt(phone), now),
      err: req.query.err || null,
      now,
    });
  });

  // JSON thread for the 5s poll (no websockets). Also keeps the thread marked
  // read while the agent has it open.
  app.get('/admin/conv/:phone/messages', (req, res) => {
    const now = Date.now();
    const phone = req.params.phone;
    db.markViewed(phone, now);
    const conv = db.getConversation(phone);
    res.json({
      messages: db.messagesForPhone(phone),
      window: windowInfo(db.lastInboundAt(phone), now),
      agentOwned: !!(conv && conv.agent_owned),
    });
  });

  // ── Reply (telecaller → patient) ─────────────────────────────────────────────

  app.post('/admin/reply', async (req, res) => {
    const now = Date.now();
    const phone = String((req.body && req.body.phone) || '').trim();
    const text = String((req.body && req.body.text) || '').trim();
    const wantsJson = req.is('application/json');

    if (!phone || !text) {
      return fail(res, wantsJson, phone, 'Message text is required.', 400);
    }

    // 24h window guard — never attempt a free-form send outside it.
    const win = windowInfo(db.lastInboundAt(phone), now);
    if (!win.open) {
      return fail(res, wantsJson, phone, 'Window closed — patient must message first.', 409);
    }

    // Send (real Graph API, or MOCK log), then persist to history + take ownership.
    const payload = textMsg(text);
    await send(phone, payload);
    db.logMessage({
      phone, direction: 'out', type: 'text', body: text,
      raw_json: JSON.stringify(payload), timestamp: now,
    });
    db.setAgentOwned(phone, 1);        // telecaller now owns the thread; bot goes silent
    db.markViewed(phone, now);

    if (wantsJson) return res.json({ ok: true });
    res.redirect(`/admin/conv/${encodeURIComponent(phone)}`);
  });

  // ── Release back to the bot ──────────────────────────────────────────────────

  app.post('/admin/release/:phone', (req, res) => {
    const phone = req.params.phone;
    db.setAgentOwned(phone, 0);
    if (req.is('application/json')) return res.json({ ok: true });
    res.redirect(`/admin/conv/${encodeURIComponent(phone)}`);
  });

  // ── Leads tab ────────────────────────────────────────────────────────────────

  app.get('/admin/leads', (req, res) => {
    res.render('leads', { user: req.session.user, leads: db.allLeads() });
  });

  return app;
}

// ── helpers ────────────────────────────────────────────────────────────────

function decorateList(rows, now) {
  return rows.map((r) => ({
    ...r,
    win: windowInfo(r.last_inbound_ts, now),
  }));
}

function fail(res, wantsJson, phone, message, status) {
  if (wantsJson) return res.status(status).json({ ok: false, error: message });
  // For a normal form post, bounce back to the conversation with a flash query.
  const q = phone ? `/admin/conv/${encodeURIComponent(phone)}?err=${encodeURIComponent(message)}` : '/admin/';
  return res.redirect(q);
}

// ── Boot (only when run directly, not when imported by tests) ────────────────

/**
 * Is this module the process entrypoint?
 *
 * The naive check `import.meta.url === pathToFileURL(process.argv[1]).href`
 * breaks under pm2 on a real deploy: Node resolves symlinks in `import.meta.url`
 * (so it points at the real release dir), but `process.argv[1]` is whatever path
 * pm2 was given — typically a RELATIVE path (`pm2 start admin/server.js`, as our
 * DEPLOY.md instructs) under a symlinked app dir (`/var/www/... -> releases/x`).
 * The two strings then differ, `isMain` is false, and the boot block silently
 * never runs: the process starts, exits clean, listens on nothing, logs nothing
 * — exactly the "under pm2 but not on :3010, empty logs" symptom.
 *
 * Fix: compare the two after resolving BOTH through realpath (symlink-safe) and
 * to absolute paths (relative-arg-safe). `ADMIN_FORCE_START=1` is an explicit
 * escape hatch for any launcher that still trips this.
 */
function isEntrypoint() {
  if (String(process.env.ADMIN_FORCE_START ?? '') === '1') return true;
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    const here = fs.realpathSync(fileURLToPath(import.meta.url));
    const invoked = fs.realpathSync(path.resolve(arg));
    return here === invoked;
  } catch {
    // realpath throws only if a path vanished mid-start — fall back to the
    // percent-encoding-safe string compare rather than refusing to boot.
    return import.meta.url === pathToFileURL(path.resolve(arg)).href;
  }
}

if (isEntrypoint()) {
  const db = openAdminDb();
  const app = createAdminApp({ db });
  const port = Number(process.env.ADMIN_PORT || 3010);
  app.listen(port, '127.0.0.1', () => {
    console.log(`SugarCARE admin panel on http://127.0.0.1:${port}/admin/  (${isMock() ? 'MOCK' : 'LIVE'} mode)`);
  });
}

export { withAdminQueries };
