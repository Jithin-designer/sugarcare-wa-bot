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

describe('full new-lead walkthrough', () => {
  it('captures a lead with name, interest and clinic', async () => {
    await text('namaskaram');          // greet
    await button(IDS.BTN_NEW);         // → LEAD_INTEREST
    await list(IDS.INTEREST_CGM);      // → LEAD_CLINIC
    await list(clinicRowId('chemmad')); // → LEAD_NAME
    await text('Fathima');             // → HUMAN_HANDOFF + lead saved

    const leads = db.leadsForPhone(from);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      name: 'Fathima', interest: 'cgm', clinic: 'chemmad', lead_type: 'new', priority: 0,
    });

    const c = db.getConversation(from);
    expect(c.state).toBe(STATES.HUMAN_HANDOFF);
    expect(c.dormant_until).toBeGreaterThan(Date.now());
  });
});

describe('full existing-patient appointment walkthrough', () => {
  it('saves a callback lead with the preferred day', async () => {
    await text('hi');                  // greet
    await button(IDS.BTN_EXISTING);    // → PATIENT_MENU
    await button(IDS.BTN_APPT);        // → APPT_CLINIC
    await list(clinicRowId('edappal')); // → APPT_DAY
    await text('ബുധൻ');                // → DORMANT + callback saved

    const leads = db.leadsForPhone(from);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ lead_type: 'callback', clinic: 'edappal', priority: 0 });
    expect(leads[0].notes).toContain('ബുധൻ');

    const c = db.getConversation(from);
    expect(c.state).toBe(STATES.DORMANT);
  });
});

describe('existing-patient report request', () => {
  it('creates a PRIORITY lead and hands off', async () => {
    await text('hello');
    await button(IDS.BTN_EXISTING);
    await button(IDS.BTN_REPORT);

    const leads = db.leadsForPhone(from);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ priority: 1, lead_type: 'priority', interest: 'report' });
    expect(db.getConversation(from).state).toBe(STATES.HUMAN_HANDOFF);
  });
});

describe('dormancy gating', () => {
  it('ignores inbound messages while the conversation is dormant', async () => {
    // Drive to a dormant close (appointment callback).
    await text('hi');
    await button(IDS.BTN_EXISTING);
    await button(IDS.BTN_APPT);
    await list(clinicRowId('kanjirathani'));
    await text('തിങ്കൾ'); // → DORMANT for 12h
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

describe('two-strike fallback', () => {
  it('re-prompts once, then hands off on the second miss', async () => {
    await text('hi');                    // greet, state MENU greeted
    const s1 = await button('nope_1');   // 1st miss → re-prompt
    expect(s1).toBe('processed');
    expect(db.getConversation(from).fallback_count).toBe(1);

    await button('nope_2');              // 2nd miss → handoff
    expect(db.getConversation(from).state).toBe(STATES.HUMAN_HANDOFF);
    const leads = db.leadsForPhone(from);
    expect(leads.some((l) => l.lead_type === 'fallback')).toBe(true);
  });
});
