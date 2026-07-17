/**
 * src/db.js — SQLite setup + every query the bot runs.
 *
 * Uses better-sqlite3 (synchronous). Synchronous is the right call here: the
 * work per webhook is a handful of tiny indexed queries that finish in well
 * under a millisecond, so there is no benefit to async and a real cost in
 * complexity. The webhook still returns 200 to Meta first and does this work
 * afterwards (see server.js), so Meta's 5s budget is never at risk.
 *
 * `openDb(filename)` is a factory — the server opens one file-backed db,
 * while tests open independent `:memory:` databases for full isolation.
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  phone TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'MENU',
  lang TEXT NOT NULL DEFAULT 'ml',
  data_json TEXT NOT NULL DEFAULT '{}',
  fallback_count INTEGER NOT NULL DEFAULT 0,
  dormant_until INTEGER,
  last_user_message_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  name TEXT,
  interest TEXT,
  clinic TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  lead_type TEXT NOT NULL DEFAULT 'new',
  notes TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS processed_messages (
  message_id TEXT PRIMARY KEY,
  processed_at INTEGER NOT NULL
);

-- Admin-panel message log (additive). Every inbound message and every outbound
-- send (bot OR telecaller, MOCK included) is appended here. History is permanent
-- — nothing purges this table. Read by the admin panel's conversation view.
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  type TEXT NOT NULL CHECK (type IN ('text','interactive','button_reply','list_reply')),
  body TEXT NOT NULL,
  raw_json TEXT,
  timestamp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
`;

/**
 * Open (and migrate) a database.
 * @param {string} filename  path to the .sqlite file, or ':memory:'
 * @returns {object} a small query API — see the returned object below.
 */
export function openDb(filename = 'data/bot.db') {
  if (filename !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  }

  const db = new Database(filename);
  db.pragma('journal_mode = WAL');   // better concurrency for a long-running server
  db.exec(SCHEMA);
  ensureColumn(db, 'conversations', 'agent_owned', 'INTEGER DEFAULT 0');

  // ── prepared statements (compiled once, reused per call) ───────────────────
  const stmts = {
    getConversation: db.prepare('SELECT * FROM conversations WHERE phone = ?'),
    upsertConversation: db.prepare(`
      INSERT INTO conversations
        (phone, state, lang, data_json, fallback_count, dormant_until, last_user_message_at, updated_at)
      VALUES
        (@phone, @state, @lang, @data_json, @fallback_count, @dormant_until, @last_user_message_at, @updated_at)
      ON CONFLICT(phone) DO UPDATE SET
        state = @state,
        lang = @lang,
        data_json = @data_json,
        fallback_count = @fallback_count,
        dormant_until = @dormant_until,
        last_user_message_at = @last_user_message_at,
        updated_at = @updated_at
    `),
    insertLead: db.prepare(`
      INSERT INTO leads (phone, name, interest, clinic, priority, lead_type, notes, created_at)
      VALUES (@phone, @name, @interest, @clinic, @priority, @lead_type, @notes, @created_at)
    `),
    isProcessed: db.prepare('SELECT 1 FROM processed_messages WHERE message_id = ?'),
    markProcessed: db.prepare(
      'INSERT OR IGNORE INTO processed_messages (message_id, processed_at) VALUES (?, ?)'
    ),
    leadsForPhone: db.prepare('SELECT * FROM leads WHERE phone = ? ORDER BY id DESC'),
    insertMessage: db.prepare(`
      INSERT INTO messages (phone, direction, type, body, raw_json, timestamp)
      VALUES (@phone, @direction, @type, @body, @raw_json, @timestamp)
    `),
    messagesForPhone: db.prepare('SELECT * FROM messages WHERE phone = ? ORDER BY timestamp ASC, id ASC'),
    setAgentOwned: db.prepare('UPDATE conversations SET agent_owned = @agent_owned WHERE phone = @phone'),
  };

  return {
    raw: db,

    /** Load a conversation row, or null if this phone is brand new. */
    getConversation(phone) {
      const row = stmts.getConversation.get(phone);
      if (!row) return null;
      return { ...row, data: safeParse(row.data_json) };
    },

    /**
     * Persist a conversation. `fields.data` (an object) is serialized to
     * data_json automatically. Missing fields fall back to sane defaults.
     */
    saveConversation(phone, fields) {
      const now = fields.updated_at ?? Date.now();
      stmts.upsertConversation.run({
        phone,
        state: fields.state ?? 'MENU',
        lang: fields.lang ?? 'ml',
        data_json: JSON.stringify(fields.data ?? {}),
        fallback_count: fields.fallback_count ?? 0,
        dormant_until: fields.dormant_until ?? null,
        last_user_message_at: fields.last_user_message_at ?? null,
        updated_at: now,
      });
    },

    /** Insert a lead (new lead, callback, or priority escalation). */
    saveLead(lead) {
      const info = stmts.insertLead.run({
        phone: lead.phone,
        name: lead.name ?? null,
        interest: lead.interest ?? null,
        clinic: lead.clinic ?? null,
        priority: lead.priority ? 1 : 0,
        lead_type: lead.lead_type ?? 'new',
        notes: lead.notes ?? null,
        created_at: lead.created_at ?? Date.now(),
      });
      return info.lastInsertRowid;
    },

    /** HARD RULE #5 — idempotency. True if we have already handled this id. */
    isProcessed(messageId) {
      return stmts.isProcessed.get(messageId) !== undefined;
    },

    /** Record a message id as handled. Returns true if newly inserted. */
    markProcessed(messageId, at = Date.now()) {
      const info = stmts.markProcessed.run(messageId, at);
      return info.changes > 0;
    },

    /** Debug/test helper — all leads for a phone, newest first. */
    leadsForPhone(phone) {
      return stmts.leadsForPhone.all(phone);
    },

    /**
     * Append one message to the permanent `messages` log (admin panel history).
     * Used for BOTH inbound (direction:'in') and every outbound send
     * (direction:'out'), including MOCK_MODE. Never purged.
     */
    logMessage({ phone, direction, type, body, raw_json = null, timestamp = Date.now() }) {
      const info = stmts.insertMessage.run({ phone, direction, type, body, raw_json, timestamp });
      return info.lastInsertRowid;
    },

    /** All logged messages for a phone, oldest-first (thread order). */
    messagesForPhone(phone) {
      return stmts.messagesForPhone.all(phone);
    },

    /**
     * Set the agent_owned flag on a conversation (1 = a human telecaller owns the
     * thread and the bot stays silent to free text; 0 = bot handles normally).
     * No-op if the conversation row does not exist yet.
     */
    setAgentOwned(phone, agent_owned) {
      stmts.setAgentOwned.run({ phone, agent_owned: agent_owned ? 1 : 0 });
    },

    close() {
      db.close();
    },
  };
}

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

/**
 * Additive column migration. SQLite's ALTER TABLE ADD COLUMN throws if the
 * column already exists, so we probe PRAGMA table_info first. Idempotent — safe
 * to run on every boot against an already-migrated production database.
 */
function ensureColumn(db, table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
