/**
 * messagesLog.test.js — admin-panel additive behaviour on the bot side:
 *   1. inbound messages are logged with direction='in'
 *   2. outbound sends are logged with direction='out' (MOCK_MODE)
 *   3. agent_owned=1 suppresses the bot's reply to free text
 *   4. an interactive tap while agent_owned resumes the bot AND resets the flag
 */

import { describe, it, expect, beforeEach } from 'vitest';

process.env.MOCK_MODE = 'true';
process.env.MOCK_OUTBOX = 'data/test_outbox.jsonl';

const { handleIncoming } = await import('../server.js');
const { openDb } = await import('../src/db.js');
const { IDS } = await import('../src/messages.js');

let db;
let sends;
let send;
let seq;
beforeEach(() => {
  db = openDb(':memory:');
  sends = [];
  send = async (to, payload) => sends.push({ to, payload });
  seq = 0;
});

const from = '919812349999';
const feed = (partial) => handleIncoming({ db, send }, {
  from, messageId: `wamid.M${++seq}`, timestamp: Date.now(),
  type: 'text', text: '', buttonId: null, listId: null, ...partial,
});
const text = (t) => feed({ type: 'text', text: t });
const button = (id) => feed({ type: 'interactive', buttonId: id });

describe('message logging', () => {
  it('logs an inbound message with direction=in', async () => {
    await text('namaskaram');
    const msgs = db.messagesForPhone(from);
    const inbound = msgs.filter((m) => m.direction === 'in');
    expect(inbound).toHaveLength(1);
    expect(inbound[0]).toMatchObject({ direction: 'in', type: 'text', body: 'namaskaram' });
    expect(inbound[0].timestamp).toBeTypeOf('number');
  });

  it('logs outbound sends with direction=out in MOCK_MODE', async () => {
    await text('namaskaram');                 // greeting reply is dispatched (mocked)
    const out = db.messagesForPhone(from).filter((m) => m.direction === 'out');
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(sends.length).toBe(out.length);    // every send was logged
    expect(out[0].direction).toBe('out');
  });

  it('records interactive taps with the button_reply/list_reply type', async () => {
    await text('hi');                          // → WELCOME greeted
    await button(IDS.BTN_BOOK);                // interactive tap
    const inbound = db.messagesForPhone(from).filter((m) => m.direction === 'in');
    expect(inbound.some((m) => m.type === 'button_reply')).toBe(true);
  });
});

describe('agent_owned suppression', () => {
  it('does NOT auto-reply to free text when agent_owned=1', async () => {
    await text('hi');                          // create the conversation + greet
    const sentAfterGreet = sends.length;
    db.setAgentOwned(from, 1);                 // telecaller takes over

    const status = await text('is anyone there?');

    expect(status).toBe('agent_owned');
    expect(sends.length).toBe(sentAfterGreet); // nothing new was sent
    // The inbound was still logged (permanent history), no new outbound row.
    const msgs = db.messagesForPhone(from);
    expect(msgs.filter((m) => m.direction === 'in').some((m) => m.body === 'is anyone there?')).toBe(true);
  });
});

describe('interactive resume while agent_owned', () => {
  it('resumes the bot and resets agent_owned=0 on a button tap', async () => {
    await text('hi');
    db.setAgentOwned(from, 1);
    const sentBefore = sends.length;
    expect(db.getConversation(from).agent_owned).toBe(1);

    const status = await button(IDS.BTN_BOOK);  // patient taps a button

    expect(status).toBe('processed');
    expect(sends.length).toBeGreaterThan(sentBefore); // bot replied (clinic list)
    expect(db.getConversation(from).agent_owned).toBe(0); // ownership released
  });
});
