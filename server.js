/**
 * server.js — Express entry point. The imperative shell around the pure state
 * machine. Owns: webhook security, the 200-in-5s rule, idempotency, dormancy
 * gating, persistence, and dispatch.
 *
 * Routes:
 *   GET  /webhook  — Meta verification handshake (hub.verify_token)
 *   POST /webhook  — incoming messages (X-Hub-Signature-256 verified → 401)
 *   GET  /health   — liveness
 *
 * (/whatsapp/webhook is registered as an alias so the Meta dashboard URL can use
 *  either path.)
 */

import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import express from 'express';

import { openDb } from './src/db.js';
import { processMessage, STATES, isClinicalQuestion } from './src/stateMachine.js';
import { sendMessage, isWithinSessionWindow, describe } from './src/whatsapp.js';
import { assertClean } from './src/bannedWords.js';

const WEBHOOK_PATHS = ['/webhook', '/whatsapp/webhook'];
const TERMINAL_STATES = new Set([STATES.HUMAN_HANDOFF, STATES.DORMANT]);

const isMockEnv = () => String(process.env.MOCK_MODE ?? 'true').toLowerCase() !== 'false';

let _warnedSecret = false;
function getAppSecret() {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  if (isMockEnv()) {
    if (!_warnedSecret) {
      console.warn('⚠️  APP_SECRET unset — using dev default "dev_secret_change_me" (MOCK_MODE only).');
      _warnedSecret = true;
    }
    return 'dev_secret_change_me';
  }
  return ''; // production with no secret → every signature fails (fail-safe)
}

// ── Webhook signature (HARD RULE #6) ─────────────────────────────────────────

/** Compute the header value Meta sends: "sha256=<hmac-hex>". */
export function signBody(rawBody, secret = getAppSecret()) {
  const buf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
  return 'sha256=' + crypto.createHmac('sha256', secret).update(buf).digest('hex');
}

/** Timing-safe verification of X-Hub-Signature-256 against the raw request body. */
export function verifySignature(req, secret = getAppSecret()) {
  const provided = req.get('x-hub-signature-256');
  if (!provided || !secret || !req.rawBody) return false;
  const expected = signBody(req.rawBody, secret);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── Payload extraction ───────────────────────────────────────────────────────

/**
 * Normalise a Meta webhook payload into a flat array of incoming messages:
 *   { type:'text'|'interactive', text, buttonId, listId, messageId, from, timestamp }
 * Status callbacks (delivered/read) and unsupported types are dropped.
 */
export function extractMessages(payload) {
  const out = [];
  const entries = payload?.entry ?? [];
  for (const entry of entries) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value ?? {};
      for (const msg of value.messages ?? []) {
        const base = {
          from: msg.from,
          messageId: msg.id,
          timestamp: msg.timestamp ? Number(msg.timestamp) * 1000 : Date.now(),
          text: '',
          buttonId: null,
          listId: null,
        };
        if (msg.type === 'text') {
          out.push({ ...base, type: 'text', text: (msg.text?.body ?? '').trim() });
        } else if (msg.type === 'interactive') {
          const it = msg.interactive ?? {};
          if (it.type === 'button_reply') {
            out.push({ ...base, type: 'interactive', text: it.button_reply?.title ?? '', buttonId: it.button_reply?.id ?? null });
          } else if (it.type === 'list_reply') {
            out.push({ ...base, type: 'interactive', text: it.list_reply?.title ?? '', listId: it.list_reply?.id ?? null });
          }
        }
        // other types (image/audio/location/...) are intentionally ignored
      }
    }
  }
  return out;
}

// ── Message logging (admin-panel history) ────────────────────────────────────

/** Map a normalised inbound message to the messages-table `type` enum. */
function inboundType(msg) {
  if (msg.buttonId) return 'button_reply';
  if (msg.listId) return 'list_reply';
  if (msg.type === 'interactive') return 'interactive';
  return 'text';
}

/** A short human-readable body for the inbound log (title of a tap, or the text). */
function inboundBody(msg) {
  const t = String(msg.text || '').trim();
  if (t) return t;
  return msg.buttonId || msg.listId || '';
}

/** Log one inbound message to the permanent history. Best-effort: never throws. */
function logInbound(db, msg, now) {
  try {
    db.logMessage({
      phone: msg.from,
      direction: 'in',
      type: inboundType(msg),
      body: inboundBody(msg),
      raw_json: JSON.stringify(msg),
      timestamp: msg.timestamp || now,
    });
  } catch (err) {
    console.error(`messages: failed to log inbound for ${msg.from} — ${err.message}`);
  }
}

/** Log one outbound send (bot reply) to the permanent history. Never throws. */
function logOutbound(db, to, payload, now) {
  try {
    const type = payload.type === 'text' ? 'text' : 'interactive';
    const body = payload.type === 'text' ? payload.text.body : describe(payload);
    db.logMessage({
      phone: to,
      direction: 'out',
      type,
      body,
      raw_json: JSON.stringify(payload),
      timestamp: now,
    });
  } catch (err) {
    console.error(`messages: failed to log outbound for ${to} — ${err.message}`);
  }
}

// ── Core per-message handler (the imperative shell) ──────────────────────────

/**
 * Process one normalised inbound message. Pure state machine + all I/O.
 * @returns {string} one of: 'processed' | 'duplicate' | 'dormant' | 'ignored'
 */
export async function handleIncoming({ db, send = sendMessage }, msg, now = Date.now()) {
  if (!msg?.from) return 'ignored';

  // HARD RULE #5 — idempotency. Dedup by WhatsApp message_id.
  if (msg.messageId) {
    if (db.isProcessed(msg.messageId)) {
      console.log(`webhook: duplicate message_id=${msg.messageId} — skipping`);
      return 'duplicate';
    }
    db.markProcessed(msg.messageId, now);
  }

  // Log every inbound to the permanent history (after dedup so duplicates are not
  // double-logged; before every gate so dormant/agent-owned pings still appear).
  logInbound(db, msg, now);

  // Load (or default) the conversation. Booking-first flow: any brand-new
  // phone number lands on WELCOME (Book/Doubt), not the old MENU greeting.
  let conv = db.getConversation(msg.from) || {
    phone: msg.from,
    state: STATES.WELCOME,
    lang: 'ml',
    data: {},
    fallback_count: 0,
    dormant_until: null,
    last_user_message_at: null,
  };

  // Dormancy gate: a human owns this thread for now — record the ping, stay quiet.
  if (conv.dormant_until && now < conv.dormant_until) {
    console.log(`webhook: ${msg.from} is dormant until ${conv.dormant_until} — logging, not replying`);
    db.saveConversation(msg.from, { ...conv, last_user_message_at: now, updated_at: now });
    return 'dormant';
  }

  // Terminal state or expired dormancy → start a fresh conversation at
  // WELCOME (booking-first flow), preserving only the chosen language.
  if (TERMINAL_STATES.has(conv.state) || (conv.dormant_until && now >= conv.dormant_until)) {
    conv = {
      phone: msg.from,
      state: STATES.WELCOME,
      lang: conv.lang || 'ml',
      data: {},
      fallback_count: 0,
      dormant_until: null,
      last_user_message_at: conv.last_user_message_at ?? null,
    };
  }

  // ── agent_owned gate (admin panel) ──
  // A telecaller has taken over this thread. While agent_owned = 1 the bot must
  // NOT auto-reply to free text — it stays silent (the inbound is already logged
  // above). Two escape hatches:
  //   1. The patient taps ANY interactive button/list row → the bot resumes
  //      normally AND ownership is released (agent_owned reset to 0).
  //   2. A safety/compliance guard (clinical escalation) still fires even while
  //      agent-owned — a clinical question is never left silent.
  if (conv.agent_owned) {
    const isInteractive = !!msg.buttonId || !!msg.listId || msg.type === 'interactive';
    if (isInteractive) {
      db.setAgentOwned(msg.from, 0);        // release ownership, then fall through
      conv = { ...conv, agent_owned: 0 };
    } else if (!isClinicalQuestion(msg.text)) {
      // Free text, not a clinical escalation → stay silent. Record the ping so the
      // 24h window / last-seen stays accurate, but send nothing.
      db.saveConversation(msg.from, { ...conv, last_user_message_at: now, updated_at: now });
      console.log(`webhook: ${msg.from} is agent-owned — logged, not replying`);
      return 'agent_owned';
    }
    // else: clinical question while agent-owned → fall through so the guard fires.
  }

  // ── Pure decision ──
  const r = processMessage(conv, msg);

  // ── Persist ──
  const dormantUntil = r.dormantFor > 0 ? now + r.dormantFor : null;
  db.saveConversation(msg.from, {
    state: r.nextState,
    lang: r.lang || conv.lang,
    data: r.nextData,
    fallback_count: r.fallbackCount,
    dormant_until: dormantUntil,
    last_user_message_at: now,
    updated_at: now,
  });
  if (r.leadData) {
    db.saveLead({ ...r.leadData, created_at: now });
    // FAQ-list flow: extra console visibility in MOCK_MODE for the two lead
    // types the new flow produces (booking + medicine). The lead is ALSO always
    // written to SQLite above — this log never skips the DB write.
    if ((r.leadData.lead_type === 'booking' || r.leadData.lead_type === 'medicine') && isMockEnv()) {
      console.log(`[MOCK LEAD] ${r.leadData.lead_type}: phone=${r.leadData.phone} clinic=${r.leadData.clinic}`);
    }
  }

  // ── Dispatch (HARD RULE #4: only within the 24h session window) ──
  // This inbound just re-opened the window, so replies to it are always allowed.
  // Any future *proactive* sender must re-check with the real last-inbound time.
  if (!isWithinSessionWindow(now, now)) {
    console.log(`webhook: outside 24h window for ${msg.from} — replies logged, not sent`);
    return 'processed';
  }
  for (const payload of r.replies) {
    if (payload.type === 'text') assertClean(payload.text.body, 'outbound'); // defence in depth
    await send(msg.from, payload);
    logOutbound(db, msg.from, payload, now);  // permanent history (incl. MOCK_MODE)
  }
  return 'processed';
}

// ── Express app factory ──────────────────────────────────────────────────────

export function createApp({ db, send = sendMessage } = {}) {
  const app = express();

  // Capture the raw body so we can verify the HMAC signature over exact bytes.
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );

  // GET verify handshake — Meta calls this once when you save the webhook URL.
  app.get(WEBHOOK_PATHS, (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token && token === process.env.VERIFY_TOKEN) {
      console.log('webhook: verified');
      return res.status(200).type('text/plain').send(String(challenge ?? ''));
    }
    console.warn('webhook: verification failed (bad token or mode)');
    return res.sendStatus(403);
  });

  // POST incoming — verify signature, ACK within 5s, then process async.
  app.post(WEBHOOK_PATHS, (req, res) => {
    if (!verifySignature(req)) {
      console.warn('webhook: bad signature → 401');
      return res.status(401).json({ error: 'invalid signature' });
    }

    // HARD RULE #7 — ACK immediately; do the work afterwards.
    res.status(200).json({ status: 'ok' });

    const messages = extractMessages(req.body);
    const now = Date.now();
    (async () => {
      for (const m of messages) {
        try {
          await handleIncoming({ db, send }, m, now);
        } catch (err) {
          console.error(`webhook: handler error for ${m.from} — ${err.stack || err}`);
        }
      }
    })();
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', mode: isMockEnv() ? 'mock' : 'live' });
  });

  return app;
}

// ── Boot (only when run directly, not when imported by tests) ─────────────────

// Robust "is this the entry module?" check — pathToFileURL matches the
// percent-encoding of import.meta.url, so it works even when the project path
// contains spaces (e.g. ".../Jithin works/SugarCARE Clinics.../").
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const db = openDb(process.env.DB_PATH || 'data/bot.db');
  const app = createApp({ db });
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log(`SugarCARE WA bot listening on :${port}  (${isMockEnv() ? 'MOCK' : 'LIVE'} mode)`);
    console.log(`  GET  /webhook  → verify handshake`);
    console.log(`  POST /webhook  → incoming messages`);
    console.log(`  GET  /health`);
  });
}
