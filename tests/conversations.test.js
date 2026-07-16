/**
 * conversations.test.js — full end-to-end walkthroughs through the imperative
 * shell (handleIncoming), asserting the resulting rows in SQLite. The closest
 * thing to "a real WhatsApp conversation" without the network. FAQ-flow rebuild.
 */

import { describe, it, expect, beforeEach } from 'vitest';

process.env.MOCK_MODE = 'true';
process.env.MOCK_OUTBOX = 'data/test_outbox.jsonl';

const { handleIncoming } = await import('../server.js');
const { openDb } = await import('../src/db.js');
const { STATES } = await import('../src/stateMachine.js');
const { IDS, clinicRowId } = await import('../src/messages.js');

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

const from = '919812345678';
const feed = (partial) => handleIncoming({ db, send }, {
  from, messageId: `wamid.T${++seq}`, timestamp: Date.now(),
  type: 'text', text: '', buttonId: null, listId: null, ...partial,
});
const text = (t) => feed({ type: 'text', text: t });
const list = (id) => feed({ type: 'interactive', listId: id });
const button = (id) => feed({ type: 'interactive', buttonId: id });

describe('booking walkthrough (WELCOME → book → clinic, no name step)', () => {
  it('captures a booking lead with clinic and no name, resets to WELCOME', async () => {
    await text('namaskaram');            // → WELCOME, greeted
    await list(IDS.BTN_BOOK);            // → CLINIC_SELECT
    await list(clinicRowId('chemmad')); // → booking lead saved, back to WELCOME

    const leads = db.leadsForPhone(from);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ clinic: 'chemmad', lead_type: 'booking', priority: 0, name: null });
    expect(db.getConversation(from).state).toBe(STATES.WELCOME);
  });
});

describe('medicine walkthrough (WELCOME → medicine → clinic, no name step)', () => {
  it('captures a medicine lead with clinic and no name', async () => {
    await text('hi');
    await list(IDS.BTN_MEDS);
    await list(clinicRowId('punnayurkulam'));

    const leads = db.leadsForPhone(from);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ clinic: 'punnayurkulam', lead_type: 'medicine', name: null });
  });
});

describe('dormancy gating', () => {
  it('ignores inbound messages while the conversation is dormant', async () => {
    // Drive to a dormant close via two-strike fallback.
    await text('hi');
    await button('nope_1');   // 1st miss → re-prompt
    await button('nope_2');   // 2nd miss → HUMAN_HANDOFF + dormant 12h

    expect(db.getConversation(from).state).toBe(STATES.HUMAN_HANDOFF);
    const sentSoFar = sends.length;

    // A follow-up ping during dormancy must be logged, not answered.
    const status = await text('are you there?');
    expect(status).toBe('dormant');
    expect(sends.length).toBe(sentSoFar); // nothing new sent
  });
});

describe('clinical question end-to-end', () => {
  it('escalates to a PRIORITY clinical lead', async () => {
    await text('my hba1c is 9, what dose of metformin should I take?');
    const leads = db.leadsForPhone(from);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ priority: 1, lead_type: 'clinical' });
    expect(db.getConversation(from).state).toBe(STATES.HUMAN_HANDOFF);
  });
});

describe('two-strike fallback (threshold 1)', () => {
  it('re-prompts once, then hands off on the second miss', async () => {
    await text('hi');
    const s1 = await button('nope_1');
    expect(s1).toBe('processed');
    expect(db.getConversation(from).fallback_count).toBe(1);

    await button('nope_2');
    expect(db.getConversation(from).state).toBe(STATES.HUMAN_HANDOFF);
    expect(db.leadsForPhone(from).some((l) => l.lead_type === 'fallback')).toBe(true);
  });
});
