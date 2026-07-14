/**
 * src/whatsapp.js — outbound Meta WhatsApp Cloud API client.
 *
 * MOCK_MODE=true  → nothing hits the network. Each message is console-logged and
 *                   appended to data/mock_outbox.jsonl (the simulator reads it).
 * MOCK_MODE=false → POST to graph.facebook.com/v25.0/{PHONE_NUMBER_ID}/messages.
 *
 * The payload passed in is a Meta message body WITHOUT messaging_product/to
 * (as produced by messages.js). We add those two fields at send time.
 */

import fs from 'node:fs';
import path from 'node:path';

const GRAPH_VERSION = 'v25.0';
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

const outboxPath = () => process.env.MOCK_OUTBOX || 'data/mock_outbox.jsonl';
const isMock = () => String(process.env.MOCK_MODE ?? 'true').toLowerCase() !== 'false';

/**
 * HARD RULE #4 — WhatsApp only allows free-form messages within 24h of the
 * user's last inbound message. Outside that window we must not send (a template
 * would be required); we log instead.
 */
export function isWithinSessionWindow(lastUserMessageAt, now = Date.now()) {
  if (!lastUserMessageAt) return true; // no record yet → this very turn opened it
  return now - lastUserMessageAt <= TWENTY_FOUR_HOURS_MS;
}

/**
 * Send one message. Returns { ok, mocked, status?, id?, error? }.
 * Never throws on a delivery failure — logs and returns { ok:false } so the
 * webhook handler stays alive.
 */
export async function sendMessage(to, payload) {
  const body = { messaging_product: 'whatsapp', to, ...payload };

  if (isMock()) {
    appendOutbox({ ts: Date.now(), to, payload });
    // eslint-disable-next-line no-console
    console.log(`[MOCK → ${to}] ${describe(payload)}`);
    return { ok: true, mocked: true };
  }

  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    console.error('whatsapp: WHATSAPP_TOKEN / PHONE_NUMBER_ID missing — cannot send');
    return { ok: false, error: 'missing_credentials' };
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error(`whatsapp: send failed to=${to} status=${resp.status}`, JSON.stringify(json));
      return { ok: false, status: resp.status, error: json };
    }
    return { ok: true, status: resp.status, id: json?.messages?.[0]?.id };
  } catch (err) {
    console.error(`whatsapp: send threw to=${to} — ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// ── Mock outbox helpers ──────────────────────────────────────────────────────

function appendOutbox(record) {
  const file = outboxPath();
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf8');
}

/** Read all mock-outbox records (used by the simulator). */
export function readOutbox() {
  const file = outboxPath();
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** One-line human summary of a payload (for logs + the simulator). */
export function describe(payload) {
  if (payload.type === 'text') return `text: ${payload.text.body}`;
  const it = payload.interactive;
  if (it?.type === 'button') {
    const titles = it.action.buttons.map((b) => `[${b.reply.title}]`).join(' ');
    return `buttons: ${it.body.text}  ${titles}`;
  }
  if (it?.type === 'list') {
    const rows = it.action.sections.flatMap((s) => s.rows).map((r) => `[${r.title}]`).join(' ');
    return `list: ${it.body.text}  ${rows}`;
  }
  return JSON.stringify(payload);
}
