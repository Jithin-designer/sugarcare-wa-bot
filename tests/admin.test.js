/**
 * admin.test.js — admin panel HTTP surface:
 *   6. an unauthenticated GET /admin/ redirects to /admin/login
 *   7. POST /admin/reply (authenticated, open window, MOCK_MODE) logs an outbound
 *      message and does NOT hit the network (no fetch)
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Must be set before auth.js / whatsapp.js read them.
process.env.MOCK_MODE = 'true';
process.env.MOCK_OUTBOX = 'data/test_outbox.jsonl';
process.env.ADMIN_SESSION_SECRET = 'test_admin_secret';
process.env.ADMIN_SEED_PASSWORD_NITHIN = 'testpass-nithin';

const { openDb } = await import('../src/db.js');
const { withAdminQueries } = await import('../admin/db.js');
const { createAdminApp } = await import('../admin/server.js');

let db;
let ctx;
function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, port: server.address().port }));
  });
}
const base = () => `http://localhost:${ctx.port}`;

beforeAll(async () => {
  db = withAdminQueries(openDb(':memory:'));
  const app = createAdminApp({ db });   // default send = real (MOCK) sendMessage
  ctx = await startServer(app);
});
afterAll(() => {
  ctx.server.close();
  db.close();
});

describe('auth guard', () => {
  it('redirects an unauthenticated GET /admin/ to /admin/login', async () => {
    const res = await fetch(`${base()}/admin/`, { redirect: 'manual' });
    expect([301, 302, 303, 307].includes(res.status)).toBe(true);
    expect(res.headers.get('location')).toBe('/admin/login');
  });
});

// Log in as the seeded telecaller and return the session cookie string.
async function login() {
  const res = await fetch(`${base()}/admin/login`, {
    method: 'POST',
    redirect: 'manual',
    body: new URLSearchParams({ username: 'nithin', password: 'testpass-nithin' }),
  });
  const cookies = res.headers.getSetCookie();
  expect(cookies.length).toBeGreaterThan(0);
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

describe('POST /admin/reply (MOCK_MODE)', () => {
  it('logs an outbound message and never calls fetch()', async () => {
    const phone = '919800000007';
    const now = Date.now();
    // Open window: the patient has an inbound within 24h.
    db.saveConversation(phone, { state: 'WELCOME', data: {}, last_user_message_at: now, updated_at: now });
    db.logMessage({ phone, direction: 'in', type: 'text', body: 'hello', timestamp: now });

    const cookie = await login();

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const before = fetchSpy.mock.calls.length;

    const res = await fetch(`${base()}/admin/reply`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ phone, text: 'Hello from the telecaller' }),
    });
    expect(res.status).toBe(200);

    // The only fetch in play is the test's own request to our server; the reply
    // handler used the MOCK send path, which must not perform a network fetch.
    // (Our request itself increments the spy by exactly 1.)
    expect(fetchSpy.mock.calls.length - before).toBe(1);
    fetchSpy.mockRestore();

    // Outbound was persisted to history, and the telecaller now owns the thread.
    const out = db.messagesForPhone(phone).filter((m) => m.direction === 'out');
    expect(out.some((m) => m.body === 'Hello from the telecaller')).toBe(true);
    expect(db.getConversation(phone).agent_owned).toBe(1);
  });

  it('refuses to send when the 24h window is closed', async () => {
    const phone = '919800000008';
    const old = Date.now() - 25 * 60 * 60 * 1000;
    db.saveConversation(phone, { state: 'WELCOME', data: {}, last_user_message_at: old, updated_at: old });
    db.logMessage({ phone, direction: 'in', type: 'text', body: 'old ping', timestamp: old });

    const cookie = await login();
    const res = await fetch(`${base()}/admin/reply`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ phone, text: 'too late' }),
    });
    expect(res.status).toBe(409);
    const out = db.messagesForPhone(phone).filter((m) => m.direction === 'out');
    expect(out.length).toBe(0);   // nothing sent, nothing logged
  });
});
