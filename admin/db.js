/**
 * admin/db.js — admin-panel query layer over the SAME data/bot.db the bot uses.
 *
 * We reuse the bot's openDb() so the shared migrations (messages table,
 * agent_owned column, WAL) always run, whichever process boots first. On top of
 * that we add two admin-OWNED tables the bot never reads:
 *
 *   admin_users  — seeded telecaller/admin logins (bcrypt password hashes)
 *   agent_views  — per-conversation "last time an agent looked" (unread badges)
 *
 * All admin reads/writes go through this module; the bot's own db.js is left
 * untouched beyond the additive shared schema.
 */

import { openDb } from '../src/db.js';

const ADMIN_SCHEMA = `
CREATE TABLE IF NOT EXISTS admin_users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'telecaller',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_views (
  phone TEXT PRIMARY KEY,
  last_view_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/**
 * Open the shared database and return the bot's db API augmented with the
 * admin-specific query methods. `filename` defaults to the same data/bot.db.
 */
export function openAdminDb(filename = process.env.DB_PATH || 'data/bot.db') {
  const db = openDb(filename);
  return withAdminQueries(db);
}

/**
 * Augment an already-open db (openDb result) with admin schema + queries.
 * Exposed separately so tests can pass an in-memory db.
 */
export function withAdminQueries(db) {
  const raw = db.raw;
  raw.exec(ADMIN_SCHEMA);

  const stmts = {
    // ── Conversation list (left pane) ──
    // One row per conversation with the aggregates the list needs: last message
    // preview + timestamp, last inbound (for the 24h window), unread count
    // (inbound messages newer than this agent's last view), and the lock flag.
    conversationList: raw.prepare(`
      SELECT
        c.phone AS phone,
        COALESCE(c.agent_owned, 0) AS agent_owned,
        (SELECT m.body      FROM messages m WHERE m.phone = c.phone ORDER BY m.timestamp DESC, m.id DESC LIMIT 1) AS last_body,
        (SELECT m.direction FROM messages m WHERE m.phone = c.phone ORDER BY m.timestamp DESC, m.id DESC LIMIT 1) AS last_direction,
        (SELECT MAX(m.timestamp) FROM messages m WHERE m.phone = c.phone) AS last_ts,
        (SELECT MAX(m.timestamp) FROM messages m WHERE m.phone = c.phone AND m.direction = 'in') AS last_inbound_ts,
        (SELECT COUNT(*) FROM messages m
           WHERE m.phone = c.phone AND m.direction = 'in'
             AND m.timestamp > COALESCE((SELECT v.last_view_at FROM agent_views v WHERE v.phone = c.phone), 0)
        ) AS unread
      FROM conversations c
      ORDER BY last_ts DESC
    `),

    lastInbound: raw.prepare(
      "SELECT MAX(timestamp) AS ts FROM messages WHERE phone = ? AND direction = 'in'"
    ),

    allLeads: raw.prepare('SELECT * FROM leads ORDER BY id DESC'),

    markViewed: raw.prepare(`
      INSERT INTO agent_views (phone, last_view_at) VALUES (@phone, @at)
      ON CONFLICT(phone) DO UPDATE SET last_view_at = @at
    `),

    getUser: raw.prepare('SELECT * FROM admin_users WHERE username = ?'),
    insertUser: raw.prepare(`
      INSERT OR IGNORE INTO admin_users (username, password_hash, role, created_at)
      VALUES (@username, @password_hash, @role, @created_at)
    `),
    updateUserPassword: raw.prepare(
      'UPDATE admin_users SET password_hash = ? WHERE username = ?'
    ),
    getAdminMeta: raw.prepare('SELECT value FROM admin_meta WHERE key = ?'),
    setAdminMeta: raw.prepare(`
      INSERT INTO admin_meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `),
  };

  return Object.assign(db, {
    /** Left-pane conversation list, newest activity first. */
    conversationList() {
      return stmts.conversationList.all();
    },

    /** Timestamp (ms) of this phone's most recent inbound, or null if none. */
    lastInboundAt(phone) {
      const row = stmts.lastInbound.get(phone);
      return row?.ts ?? null;
    },

    /** All leads across all phones, newest first (Leads tab). */
    allLeads() {
      return stmts.allLeads.all();
    },

    /** Mark a conversation as viewed now (clears its unread badge for this agent). */
    markViewed(phone, at = Date.now()) {
      stmts.markViewed.run({ phone, at });
    },

    /** Look up a seeded admin/telecaller user by username. */
    getUser(username) {
      return stmts.getUser.get(username) ?? null;
    },

    /** Insert a seed user if absent (INSERT OR IGNORE). Returns true if created. */
    insertUser({ username, password_hash, role = 'telecaller', created_at = Date.now() }) {
      const info = stmts.insertUser.run({ username, password_hash, role, created_at });
      return info.changes > 0;
    },

    /** Replace the bcrypt hash for an existing default admin user. */
    updateUserPassword(username, password_hash) {
      const info = stmts.updateUserPassword.run(password_hash, username);
      return info.changes > 0;
    },

    getAdminMeta(key) {
      return stmts.getAdminMeta.get(key)?.value ?? null;
    },

    setAdminMeta(key, value) {
      stmts.setAdminMeta.run(key, value);
    },
  });
}
