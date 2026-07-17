/**
 * adminViews.test.js — every admin EJS view compiles AND renders.
 *
 * Why this exists: a stray EJS delimiter written inside a comment once slipped
 * through the HTTP tests (they never rendered GET /admin/ through EJS) and took
 * the whole panel down with "Could not find matching close tag". The route-level
 * admin.test.js couldn't catch it. This suite closes that gap: it compiles every
 * template (catches syntax errors) and fully renders each top-level view with
 * the SAME locals shape server.js passes (catches render-time errors, missing
 * locals, and unclosed tags), so a broken view fails CI instead of production.
 *
 * The locals below are copied from the res.render() call sites in
 * admin/server.js — keep them in sync if a view starts needing a new local.
 */

import { describe, it, expect } from 'vitest';
import ejs from 'ejs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS = path.resolve(__dirname, '../admin/views');

// View helpers server.js exposes via app.locals — provide no-op-ish stand-ins so
// templates that call them render. (relativeTime/truncate/clock come from util.js
// in production; here we only need them to not throw.)
const helpers = {
  relativeTime: () => 'just now',
  truncate: (s, n) => String(s ?? '').slice(0, n),
  clock: () => '10:00',
};

// renderFile with the views root set so include('partials/...') resolves exactly
// as Express resolves it at runtime.
function render(view, locals) {
  return ejs.renderFile(path.join(VIEWS, `${view}.ejs`), { ...helpers, ...locals }, { root: VIEWS });
}

const user = { username: 'nithin', role: 'telecaller' };
const now = Date.now();

describe('admin views compile', () => {
  const files = [
    ...fs.readdirSync(VIEWS).filter((f) => f.endsWith('.ejs')).map((f) => f),
    ...fs.readdirSync(path.join(VIEWS, 'partials')).filter((f) => f.endsWith('.ejs')).map((f) => `partials/${f}`),
  ];

  for (const f of files) {
    it(`${f} compiles without an EJS syntax error`, () => {
      const src = fs.readFileSync(path.join(VIEWS, f), 'utf8');
      expect(() => ejs.compile(src, { filename: path.join(VIEWS, f) })).not.toThrow();
    });
  }
});

describe('admin views render with server.js locals', () => {
  it('login.ejs renders (both error states)', async () => {
    expect(await render('login', { error: null })).toContain('</html>');
    expect(await render('login', { error: 'Invalid username or password.' })).toContain('Invalid username');
  });

  it('conversations.ejs renders the list view (no selection)', async () => {
    const html = await render('conversations', {
      user,
      conversations: [
        { phone: '919800000001', win: { open: true }, agent_owned: 0, unread: 2,
          last_direction: 'in', last_body: 'hi', last_ts: now, last_inbound_ts: now },
      ],
      selected: null,
      messages: [],
      agentOwned: false,
      window: { open: false, msLeft: 0 },
      err: null,
      now,
    });
    expect(html).toContain('</html>');
    expect(html).toContain('919800000001');
  });

  it('conversations.ejs renders the detail view (with a selected thread)', async () => {
    const html = await render('conversations', {
      user,
      conversations: [],
      selected: '919800000001',
      messages: [
        { direction: 'in', type: 'text', body: 'hello', timestamp: now },
        { direction: 'out', type: 'text', body: 'hi back', timestamp: now },
      ],
      agentOwned: true,
      window: { open: true, msLeft: 1000 },
      err: null,
      now,
    });
    expect(html).toContain('var PHONE =');
    expect(html).toContain('919800000001');
  });

  it('conversations.ejs neutralizes an XSS payload in the selected phone (script context)', async () => {
    const payload = '911</script><script>alert(document.cookie)</script>';
    const html = await render('conversations', {
      user,
      conversations: [],
      selected: payload,
      messages: [],
      agentOwned: false,
      window: { open: false, msLeft: 0 },
      err: null,
      now,
    });
    // The raw closing-script breakout must never survive into the output.
    expect(html).not.toMatch(/<\/script><script>alert/i);
    // The escaped form is present, so the value still round-trips in the browser.
    expect(html).toContain('\\u003c/script>');
  });

  it('leads.ejs renders', async () => {
    const html = await render('leads', {
      user,
      leads: [
        { phone: '919800000001', name: 'Ramesh', interest: 'booking', clinic: 'edappal',
          priority: 0, lead_type: 'booking', notes: null, created_at: now },
      ],
    });
    expect(html).toContain('</html>');
    expect(html).toContain('Ramesh');
  });
});
