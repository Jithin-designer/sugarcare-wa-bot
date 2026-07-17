/**
 * admin/seed-demo.cjs — insert 3 fake conversations (with message history) and a
 * few leads so the admin panel has something to show in local MOCK_MODE.
 *
 *   node admin/seed-demo.cjs
 *
 * CommonJS on purpose: the project is an ESM package, so `.cjs` gives us plain
 * require() here. It talks to better-sqlite3 directly and ensures the shared
 * schema exists, so it runs even before the bot/panel has booted once.
 *
 * Safe to re-run: it clears any prior demo rows for the three demo phones first.
 */

const path = require('node:path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'bot.db');

// ── ensure shared schema (mirrors src/db.js — additive, IF NOT EXISTS) ────────
function ensureSchema(db) {
  db.pragma('journal_mode = WAL');
  db.exec(`
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
      phone TEXT NOT NULL, name TEXT, interest TEXT, clinic TEXT,
      priority INTEGER NOT NULL DEFAULT 0, lead_type TEXT NOT NULL DEFAULT 'new',
      notes TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('in','out')),
      type TEXT NOT NULL CHECK (type IN ('text','interactive','button_reply','list_reply')),
      body TEXT NOT NULL, raw_json TEXT, timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
  `);
  const cols = db.prepare('PRAGMA table_info(conversations)').all();
  if (!cols.some((c) => c.name === 'agent_owned')) {
    db.exec('ALTER TABLE conversations ADD COLUMN agent_owned INTEGER DEFAULT 0');
  }
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const now = Date.now();

// Three demo conversations, each a different panel state:
//   1. open window, bot-owned          2. open window, AGENT-owned (locked)
//   3. closed window (last inbound >24h ago)
const DEMOS = [
  {
    phone: '919812340001',
    agent_owned: 0,
    lastInbound: now - 8 * MIN,
    lead: { name: null, interest: 'booking', clinic: 'chemmad', priority: 0, lead_type: 'booking' },
    msgs: [
      { d: 'in',  t: 'text',        body: 'namaskaram',                    at: now - 12 * MIN },
      { d: 'out', t: 'interactive', body: 'buttons: ...  [ബുക്ക് ചെയ്യൂ] [മരുന്ന്] [സംശയം]', at: now - 12 * MIN + 2000 },
      { d: 'in',  t: 'button_reply',body: 'ബുക്ക് ചെയ്യൂ',                 at: now - 10 * MIN },
      { d: 'out', t: 'interactive', body: 'list: ഏത് ക്ലിനിക്?  [ചെമ്മാട്] [എടപ്പാൾ] …', at: now - 10 * MIN + 1500 },
      { d: 'in',  t: 'list_reply',  body: 'ചെമ്മാട്',                       at: now - 8 * MIN },
      { d: 'out', t: 'text',        body: "നന്ദി, 'ചെമ്മാട്' ക്ലിനിക്കിലേക്ക് ബുക്കിംഗ് റിക്വസ്റ്റ് ചെയ്തിട്ടുണ്ട്. ടീം വിളിക്കും 🙏", at: now - 8 * MIN + 1500 },
    ],
  },
  {
    phone: '919812340002',
    agent_owned: 1,
    lastInbound: now - 25 * MIN,
    lead: { name: 'Ramesh', interest: 'appointment', clinic: 'edappal', priority: 1, lead_type: 'priority' },
    msgs: [
      { d: 'in',  t: 'text', body: 'എനിക്ക് ഡോക്ടറെ കാണണം, റിപ്പോർട്ട് ഉണ്ട്', at: now - 40 * MIN },
      { d: 'out', t: 'text', body: 'ഞങ്ങളുടെ ടീം ഉടൻ വിളിക്കും 🙏',           at: now - 39 * MIN },
      { d: 'in',  t: 'text', body: 'എത്ര മണിക്ക് വിളിക്കും?',                 at: now - 25 * MIN },
      { d: 'out', t: 'text', body: 'നമസ്കാരം Ramesh, ഞാൻ Aleena. 30 മിനിറ്റിനുള്ളിൽ വിളിക്കാം.', at: now - 24 * MIN }, // telecaller reply
    ],
  },
  {
    phone: '919812340003',
    agent_owned: 0,
    lastInbound: now - 30 * HOUR,
    lead: { name: null, interest: 'medicine', clinic: 'kondotty', priority: 0, lead_type: 'medicine' },
    msgs: [
      { d: 'in',  t: 'text',        body: 'marunnu venam',                  at: now - 31 * HOUR },
      { d: 'out', t: 'interactive', body: 'list: ഏത് ക്ലിനിക്?  [കൊണ്ടോട്ടി] …', at: now - 31 * HOUR + 1500 },
      { d: 'in',  t: 'list_reply',  body: 'കൊണ്ടോട്ടി',                     at: now - 30 * HOUR },
      { d: 'out', t: 'text',        body: 'മരുന്ന് റിക്വസ്റ്റ് ലഭിച്ചു. ടീം വിളിക്കും 🙏', at: now - 30 * HOUR + 1500 },
    ],
  },
];

function run() {
  const db = new Database(DB_PATH);
  ensureSchema(db);

  const delConv = db.prepare('DELETE FROM conversations WHERE phone = ?');
  const delMsgs = db.prepare('DELETE FROM messages WHERE phone = ?');
  const delLeads = db.prepare('DELETE FROM leads WHERE phone = ?');
  const insConv = db.prepare(`
    INSERT INTO conversations (phone, state, lang, data_json, fallback_count, dormant_until, last_user_message_at, updated_at, agent_owned)
    VALUES (@phone, 'WELCOME', 'ml', '{}', 0, NULL, @last, @updated, @agent_owned)
  `);
  const insMsg = db.prepare(`
    INSERT INTO messages (phone, direction, type, body, raw_json, timestamp)
    VALUES (@phone, @d, @t, @body, NULL, @at)
  `);
  const insLead = db.prepare(`
    INSERT INTO leads (phone, name, interest, clinic, priority, lead_type, notes, created_at)
    VALUES (@phone, @name, @interest, @clinic, @priority, @lead_type, NULL, @created_at)
  `);

  const seed = db.transaction(() => {
    for (const demo of DEMOS) {
      delMsgs.run(demo.phone);
      delLeads.run(demo.phone);
      delConv.run(demo.phone);

      insConv.run({
        phone: demo.phone,
        last: demo.lastInbound,
        updated: demo.msgs[demo.msgs.length - 1].at,
        agent_owned: demo.agent_owned,
      });
      for (const m of demo.msgs) {
        insMsg.run({ phone: demo.phone, d: m.d, t: m.t, body: m.body, at: m.at });
      }
      insLead.run({
        phone: demo.phone, name: demo.lead.name, interest: demo.lead.interest,
        clinic: demo.lead.clinic, priority: demo.lead.priority,
        lead_type: demo.lead.lead_type, created_at: demo.lastInbound,
      });
    }
  });
  seed();

  const counts = {
    conversations: db.prepare('SELECT COUNT(*) n FROM conversations').get().n,
    messages: db.prepare('SELECT COUNT(*) n FROM messages').get().n,
    leads: db.prepare('SELECT COUNT(*) n FROM leads').get().n,
  };
  db.close();
  console.log(`✅ Seeded 3 demo conversations into ${DB_PATH}`);
  console.log(`   totals now — conversations:${counts.conversations} messages:${counts.messages} leads:${counts.leads}`);
  console.log('   • 919812340001  window OPEN, bot-owned');
  console.log('   • 919812340002  window OPEN, 🔒 agent-owned (telecaller replied)');
  console.log('   • 919812340003  window CLOSED (last inbound 30h ago)');
}

run();
