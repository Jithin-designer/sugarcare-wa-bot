/**
 * conversations.test.js — full end-to-end walkthroughs through the imperative
 * shell (handleIncoming), asserting the resulting rows in SQLite. This is the
 * closest thing to "a real WhatsApp conversation" without the network.
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

// helpers to feed one inbound at a time with unique message ids
const from = '919812345678';
const feed = (partial) => handleIncoming({ db, send }, {
  from, messageId: `wamid.T${++seq}`, timestamp: Date.now(),
  type: 'text', text: '', buttonId: null, listId: null, ...partial,
});
const text = (t) => feed({ type: 'text', text: t });
const button = (id) => feed({ type: 'interactive', buttonId: id });
const list = (id) => feed({ type: 'interactive', listId: id });

describe('full booking-first walkthrough', () => {
  it('captures a booking lead with name and clinic (WELCOME → Book cheyyam)', async () => {
    await text('namaskaram');            // → WELCOME, greeted
    await button(IDS.BTN_BOOK);          // → CLINIC_SELECT
    await list(clinicRowId('chemmad'));  // → NAME_CAPTURE
    await text('Fathima');               // → BOOKING_COMPLETE + lead saved

    const leads = db.leadsForPhone(from);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      name: 'Fathima', clinic: 'chemmad', lead_type: 'booking', priority: 0,
    });

    const c = db.getConversation(from);
    expect(c.state).toBe(STATES.BOOKING_COMPLETE);
  });
});

describe('existing-patient report request (WELCOME → talk to team bridge)', () => {
  it('creates a PRIORITY lead and hands off', async () => {
    await text('hello');                    // → WELCOME, greeted
    await button(IDS.BTN_TALK_TO_TEAM);      // → PATIENT_MENU (old flow, kept intact)
    await button(IDS.BTN_REPORT);

    const leads = db.leadsForPhone(from);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ priority: 1, lead_type: 'priority', interest: 'report' });
    expect(db.getConversation(from).state).toBe(STATES.HUMAN_HANDOFF);
  });
});

describe('dormancy gating', () => {
  it('ignores inbound messages while the conversation is dormant', async () => {
    // Drive to a dormant close via the booking-complete → closing-loop → No path.
    await text('hi');
    await button(IDS.BTN_BOOK);
    await list(clinicRowId('kanjirathani'));
    await text('Ramesh');
    const closingSends = sends.length;
    await button(IDS.BTN_CLOSING_NO); // → DORMANT for 12h

    const sentSoFar = sends.length;
    expect(sentSoFar).toBeGreaterThan(closingSends);

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

describe('two-strike fallback', () => {
  it('re-prompts once, then hands off on the second miss', async () => {
    await text('hi');                    // greet, state WELCOME greeted
    const s1 = await button('nope_1');   // 1st miss → re-prompt
    expect(s1).toBe('processed');
    expect(db.getConversation(from).fallback_count).toBe(1);

    await button('nope_2');              // 2nd miss → handoff
    expect(db.getConversation(from).state).toBe(STATES.HUMAN_HANDOFF);
    const leads = db.leadsForPhone(from);
    expect(leads.some((l) => l.lead_type === 'fallback')).toBe(true);
  });
});
