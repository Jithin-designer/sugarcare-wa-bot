/**
 * intentRouter.test.js — server-level (handleIncoming) tests for the free-text
 * intent router. Where intentClassifier.test.js unit-tests the PURE classifier,
 * this file drives the imperative shell end-to-end against an in-memory SQLite
 * DB and asserts the resulting rows / outbound sends — i.e. that a TYPED sentence
 * is routed into the same flows the bot previously reached only via button taps,
 * and that the safety guard, agent-ownership and fallback rules are all honoured.
 */

import { describe, it, expect, beforeEach } from 'vitest';

process.env.MOCK_MODE = 'true';
process.env.MOCK_OUTBOX = 'data/test_outbox.jsonl';

const { handleIncoming } = await import('../server.js');
const { openDb } = await import('../src/db.js');
const { STATES } = await import('../src/stateMachine.js');
const { clinicRowId } = await import('../src/messages.js');

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

const from = '919800000001';
const feed = (partial) => handleIncoming({ db, send }, {
  from, messageId: `wamid.R${++seq}`, timestamp: Date.now(),
  type: 'text', text: '', buttonId: null, listId: null, ...partial,
});
const text = (t) => feed({ type: 'text', text: t });
const list = (id) => feed({ type: 'interactive', listId: id });

// ── Free-text routing into existing flows ────────────────────────────────────

describe('intent router — typed text routes into existing flows', () => {
  it('BOOKING: "appointment venam" enters the booking clinic picker', async () => {
    await text('appointment venam');
    expect(db.getConversation(from).state).toBe(STATES.CLINIC_SELECT);
  });

  it('BOOKING → clinic pick captures a booking lead (full walk-through)', async () => {
    await text('Need consultation');           // typed English → BOOKING
    await list(clinicRowId('chemmad'));         // pick a clinic
    const leads = db.leadsForPhone(from);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ clinic: 'chemmad', lead_type: 'booking' });
    expect(db.getConversation(from).state).toBe(STATES.WELCOME);
  });

  it('MEDICINE: "marunnu venam" enters the medicine clinic picker', async () => {
    await text('marunnu venam');
    expect(db.getConversation(from).state).toBe(STATES.MED_CLINIC);
  });

  it('FAQ: a typed doubt opens the 8-row FAQ list', async () => {
    await text('enikk oru doubt und');
    expect(db.getConversation(from).state).toBe(STATES.FAQ_LIST);
  });
});

// ── Safety guard always wins over intent routing ─────────────────────────────

describe('intent router — safety guard fires first (never overridden)', () => {
  it('"ente sugar 300, appointment venam" escalates clinically, does NOT book', async () => {
    await text('ente sugar 300, appointment venam');
    const conv = db.getConversation(from);
    // Clinical guard intercepts BEFORE the classifier ever routes to booking.
    expect(conv.state).toBe(STATES.HUMAN_HANDOFF);
    const leads = db.leadsForPhone(from);
    expect(leads.some((l) => l.lead_type === 'clinical')).toBe(true);
    expect(leads.some((l) => l.lead_type === 'booking')).toBe(false);
  });
});

// ── RESCHEDULE → telecaller handoff (no self-serve) ──────────────────────────

describe('intent router — RESCHEDULE hands off to a telecaller', () => {
  it('sets agent_owned=1, sends a handoff, books nothing (brand-new phone)', async () => {
    await text('reschedule cheyyanam');
    const conv = db.getConversation(from);
    expect(conv.agent_owned).toBe(1);            // regression: row must exist first
    expect(sends).toHaveLength(1);               // handoff message went out
    expect(db.leadsForPhone(from).some((l) => l.lead_type === 'booking')).toBe(false);
  });

  it('stays silent on subsequent free text while agent-owned', async () => {
    await text('reschedule');
    const before = sends.length;
    await text('okay when will you call me');    // free text, non-clinical
    expect(sends.length).toBe(before);           // no new outbound — bot is silent
    expect(db.getConversation(from).agent_owned).toBe(1);
  });
});

// ── AFFIRMATION ──────────────────────────────────────────────────────────────

describe('intent router — AFFIRMATION', () => {
  it('at WELCOME re-sends the welcome without a fallback strike', async () => {
    await text('namaskaram');                    // greet → WELCOME, greeted
    const before = sends.length;
    await text('yes');
    const conv = db.getConversation(from);
    expect(conv.state).toBe(STATES.WELCOME);     // did NOT start booking
    expect(conv.fallback_count).toBe(0);         // clean re-greet, not a fallback
    expect(sends.length).toBeGreaterThan(before);
  });

  it('mid-flow it is passed through as text — never hijacked into a new booking', async () => {
    await text('appointment venam');             // → CLINIC_SELECT (pending)
    await text('yes');                           // affirmation, handled in-context
    expect(db.leadsForPhone(from).some((l) => l.lead_type === 'booking')).toBe(false);
    expect(db.getConversation(from).state).not.toBe(STATES.HUMAN_HANDOFF);
  });
});

// ── UNKNOWN → existing 2-strike fallback (unchanged) ─────────────────────────

describe('intent router — UNKNOWN keeps the existing 2-strike fallback', () => {
  it('two unrecognised free-text messages reach HUMAN_HANDOFF', async () => {
    await text('namaskaram');                    // greet
    await text('asdfqwer');                      // miss 1 → reprompt
    await text('zxcvbnmk');                      // miss 2 → HUMAN_HANDOFF
    expect(db.getConversation(from).state).toBe(STATES.HUMAN_HANDOFF);
  });
});

// ── agent_owned conversations stay silent on free text ───────────────────────

describe('intent router — agent_owned silence is preserved', () => {
  it('a telecaller-owned thread does not auto-reply to typed booking intent', async () => {
    // Simulate a human takeover, then the patient types a booking phrase.
    await text('hello');                         // create the conversation row
    db.setAgentOwned(from, 1);
    const before = sends.length;
    await text('appointment venam');             // would normally route to booking
    expect(sends.length).toBe(before);           // silent — no booking, no reply
    expect(db.leadsForPhone(from).some((l) => l.lead_type === 'booking')).toBe(false);
    expect(db.getConversation(from).agent_owned).toBe(1);
  });
});
