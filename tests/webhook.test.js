/**
 * webhook.test.js — HTTP surface + security (HARD RULES #5, #6, #7):
 *   - GET verify handshake (token match / mismatch)
 *   - POST rejects a bad X-Hub-Signature-256 with 401
 *   - POST accepts a valid signature with 200
 *   - idempotency: a duplicate message_id is skipped
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Env must be set before the server reads it (it reads at request time, but set early anyway).
process.env.MOCK_MODE = 'true';
process.env.VERIFY_TOKEN = 'verify_me_123';
process.env.APP_SECRET = 'test_secret_abc';
process.env.MOCK_OUTBOX = 'data/test_outbox.jsonl';

const { createApp, handleIncoming, signBody, extractMessages } = await import('../server.js');
const { openDb } = await import('../src/db.js');

function startServer(db, send) {
  const app = createApp({ db, send });
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

let ctx;
let db;
const sends = [];
beforeAll(async () => {
  db = openDb(':memory:');
  ctx = await startServer(db, async (to, payload) => { sends.push({ to, payload }); });
});
afterAll(() => {
  ctx.server.close();
  db.close();
});

const base = () => `http://localhost:${ctx.port}`;

describe('GET /webhook (verify handshake)', () => {
  it('echoes hub.challenge when the verify token matches', async () => {
    const res = await fetch(`${base()}/webhook?hub.mode=subscribe&hub.verify_token=verify_me_123&hub.challenge=CHALLENGE42`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('CHALLENGE42');
  });

  it('returns 403 when the verify token is wrong', async () => {
    const res = await fetch(`${base()}/webhook?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=X`);
    expect(res.status).toBe(403);
  });
});

describe('POST /webhook (signature)', () => {
  const url = () => `${base()}/webhook`;

  it('returns 401 on a bad signature', async () => {
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    const res = await fetch(url(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=deadbeef' },
      body,
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 when the signature header is missing', async () => {
    const res = await fetch(url(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry: [] }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 200 on a valid signature', async () => {
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    const sig = signBody(body, 'test_secret_abc');
    const res = await fetch(url(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig },
      body,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});

describe('idempotency (dedup by message_id)', () => {
  it('processes a message once and skips the duplicate', async () => {
    const localDb = openDb(':memory:');
    const localSends = [];
    const send = async (to, payload) => { localSends.push({ to, payload }); };
    const msg = {
      type: 'text', text: 'hi', buttonId: null, listId: null,
      messageId: 'wamid.DUP1', from: '919999000011', timestamp: Date.now(),
    };

    const first = await handleIncoming({ db: localDb, send }, msg);
    const second = await handleIncoming({ db: localDb, send }, msg);

    expect(first).toBe('processed');
    expect(second).toBe('duplicate');
    expect(localSends).toHaveLength(1); // greeting sent once, not twice
    localDb.close();
  });
});

describe('extractMessages', () => {
  it('normalises text, button_reply and list_reply, and drops status callbacks', () => {
    const payload = {
      entry: [
        { changes: [{ value: { messages: [
          { from: '91a', id: 'i1', timestamp: '1700000000', type: 'text', text: { body: '  hi  ' } },
          { from: '91b', id: 'i2', timestamp: '1700000001', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'btn_new', title: 'x' } } },
          { from: '91c', id: 'i3', timestamp: '1700000002', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'clinic_areekode', title: 'y' } } },
        ] } }] },
        { changes: [{ value: { statuses: [{ id: 's1', status: 'delivered' }] } }] },
      ],
    };
    const out = extractMessages(payload);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ type: 'text', text: 'hi', from: '91a' });
    expect(out[1]).toMatchObject({ type: 'interactive', buttonId: 'btn_new' });
    expect(out[2]).toMatchObject({ type: 'interactive', listId: 'clinic_areekode' });
  });
});
