/**
 * stateMachine.test.js — exercises every state transition of the pure engine:
 * MENU into both branches, all states through to HANDOFF/DORMANT, the clinical
 * guard, and both fallback tiers.
 */

import { describe, it, expect } from 'vitest';
import { processMessage, STATES, DORMANT_12H_MS, isClinicalQuestion } from '../src/stateMachine.js';
import { IDS, clinicRowId } from '../src/messages.js';

// ── builders ─────────────────────────────────────────────────────────────────
const conv = (o = {}) => ({
  phone: '911234567890',
  state: STATES.MENU,
  lang: 'ml',
  data: {},
  fallback_count: 0,
  dormant_until: null,
  last_user_message_at: null,
  ...o,
});
const txt = (text) => ({ type: 'text', text, buttonId: null, listId: null, messageId: 'm', from: '911234567890', timestamp: 1 });
const btn = (buttonId) => ({ type: 'interactive', text: '', buttonId, listId: null, messageId: 'm', from: '911234567890', timestamp: 1 });
const lst = (listId) => ({ type: 'interactive', text: '', buttonId: null, listId, messageId: 'm', from: '911234567890', timestamp: 1 });

const buttonIds = (payload) => payload.interactive.action.buttons.map((b) => b.reply.id);
const listRowIds = (payload) => payload.interactive.action.sections.flatMap((s) => s.rows).map((r) => r.id);

// ── MENU ─────────────────────────────────────────────────────────────────────
describe('MENU', () => {
  it('first message greets with 3 buttons and sets greeted', () => {
    const r = processMessage(conv(), txt('namaskaram'));
    expect(r.nextState).toBe(STATES.MENU);
    expect(r.nextData.greeted).toBe(true);
    expect(r.replies).toHaveLength(1);
    expect(buttonIds(r.replies[0])).toEqual([IDS.BTN_NEW, IDS.BTN_EXISTING, IDS.BTN_ENGLISH]);
  });

  it('btn_new → LEAD_INTEREST with 4 interest rows', () => {
    const r = processMessage(conv({ data: { greeted: true } }), btn(IDS.BTN_NEW));
    expect(r.nextState).toBe(STATES.LEAD_INTEREST);
    expect(listRowIds(r.replies[0])).toEqual([
      IDS.INTEREST_DIABETES, IDS.INTEREST_BPCHOL, IDS.INTEREST_CGM, IDS.INTEREST_PRICE,
    ]);
  });

  it('btn_existing → PATIENT_MENU with 3 buttons', () => {
    const r = processMessage(conv({ data: { greeted: true } }), btn(IDS.BTN_EXISTING));
    expect(r.nextState).toBe(STATES.PATIENT_MENU);
    expect(buttonIds(r.replies[0])).toEqual([IDS.BTN_APPT, IDS.BTN_REPORT, IDS.BTN_TEAM]);
  });

  it('btn_english → stays MENU, lang=en, menu has only 2 buttons', () => {
    const r = processMessage(conv({ data: { greeted: true } }), btn(IDS.BTN_ENGLISH));
    expect(r.nextState).toBe(STATES.MENU);
    expect(r.lang).toBe('en');
    expect(buttonIds(r.replies[0])).toEqual([IDS.BTN_NEW, IDS.BTN_EXISTING]);
  });
});

// ── BRANCH A: new lead ───────────────────────────────────────────────────────
describe('new-lead branch', () => {
  it('LEAD_INTEREST + interest → LEAD_CLINIC (7 clinics)', () => {
    const r = processMessage(conv({ state: STATES.LEAD_INTEREST, data: { greeted: true } }), lst(IDS.INTEREST_DIABETES));
    expect(r.nextState).toBe(STATES.LEAD_CLINIC);
    expect(r.nextData.interest).toBe('diabetes');
    expect(listRowIds(r.replies[0])).toHaveLength(7);
  });

  it('LEAD_CLINIC + clinic → LEAD_NAME', () => {
    const r = processMessage(
      conv({ state: STATES.LEAD_CLINIC, data: { greeted: true, interest: 'diabetes' } }),
      lst(clinicRowId('areekode'))
    );
    expect(r.nextState).toBe(STATES.LEAD_NAME);
    expect(r.nextData.clinic).toBe('areekode');
    expect(r.replies[0].type).toBe('text');
  });

  it('LEAD_NAME + name → HUMAN_HANDOFF, saves lead, dormant 12h', () => {
    const r = processMessage(
      conv({ state: STATES.LEAD_NAME, data: { greeted: true, interest: 'diabetes', clinic: 'areekode' } }),
      txt('Ramesh')
    );
    expect(r.nextState).toBe(STATES.HUMAN_HANDOFF);
    expect(r.dormantFor).toBe(DORMANT_12H_MS);
    expect(r.leadData).toMatchObject({ name: 'Ramesh', interest: 'diabetes', clinic: 'areekode', lead_type: 'new', priority: 0 });
  });
});

// ── BRANCH B: existing patient ───────────────────────────────────────────────
describe('existing-patient branch', () => {
  it('PATIENT_MENU + btn_appt → APPT_CLINIC', () => {
    const r = processMessage(conv({ state: STATES.PATIENT_MENU, data: { greeted: true } }), btn(IDS.BTN_APPT));
    expect(r.nextState).toBe(STATES.APPT_CLINIC);
    expect(listRowIds(r.replies[0])).toHaveLength(7);
  });

  it('APPT_CLINIC + clinic → APPT_DAY', () => {
    const r = processMessage(conv({ state: STATES.APPT_CLINIC, data: { greeted: true } }), lst(clinicRowId('kondotty')));
    expect(r.nextState).toBe(STATES.APPT_DAY);
    expect(r.nextData.clinic).toBe('kondotty');
  });

  it('APPT_DAY + day → DORMANT, saves callback lead', () => {
    const r = processMessage(conv({ state: STATES.APPT_DAY, data: { greeted: true, clinic: 'kondotty' } }), txt('ചൊവ്വ'));
    expect(r.nextState).toBe(STATES.DORMANT);
    expect(r.dormantFor).toBe(DORMANT_12H_MS);
    expect(r.leadData).toMatchObject({ lead_type: 'callback', clinic: 'kondotty', priority: 0 });
    expect(r.leadData.notes).toContain('ചൊവ്വ');
  });

  it('btn_report → PRIORITY handoff', () => {
    const r = processMessage(conv({ state: STATES.PATIENT_MENU, data: { greeted: true } }), btn(IDS.BTN_REPORT));
    expect(r.nextState).toBe(STATES.HUMAN_HANDOFF);
    expect(r.priority).toBe(true);
    expect(r.leadData).toMatchObject({ priority: 1, lead_type: 'priority', interest: 'report' });
  });

  it('btn_team → PRIORITY handoff', () => {
    const r = processMessage(conv({ state: STATES.PATIENT_MENU, data: { greeted: true } }), btn(IDS.BTN_TEAM));
    expect(r.nextState).toBe(STATES.HUMAN_HANDOFF);
    expect(r.priority).toBe(true);
    expect(r.leadData.interest).toBe('team');
  });
});

// ── Clinical guard (HARD RULE #1) ────────────────────────────────────────────
describe('clinical guard', () => {
  it('detector: flags clinical questions, not lead intent', () => {
    expect(isClinicalQuestion('എന്റെ sugar 300 ആണ്, എന്ത് ചെയ്യണം?')).toBe(true);
    expect(isClinicalQuestion('what insulin dose should I take')).toBe(true);
    expect(isClinicalQuestion('Ramesh')).toBe(false);
    expect(isClinicalQuestion('ചൊവ്വ')).toBe(false);
    expect(isClinicalQuestion('I want diabetes care')).toBe(false); // lead intent, not a question
  });

  it('a clinical question anywhere → PRIORITY handoff, dormant 12h', () => {
    const r = processMessage(conv({ state: STATES.LEAD_NAME, data: { greeted: true } }), txt('my sugar is 350 what should I do'));
    expect(r.nextState).toBe(STATES.HUMAN_HANDOFF);
    expect(r.priority).toBe(true);
    expect(r.dormantFor).toBe(DORMANT_12H_MS);
    expect(r.leadData.lead_type).toBe('clinical');
    // Never stores the raw clinical text (DPDP data-minimisation).
    expect(JSON.stringify(r.leadData)).not.toContain('350');
  });
});

// ── Fallback (2 strikes → handoff) ───────────────────────────────────────────
describe('fallback', () => {
  it('1st unrecognised input → re-prompt main menu, count=1', () => {
    const r = processMessage(conv({ state: STATES.LEAD_INTEREST, data: { greeted: true }, fallback_count: 0 }), txt('random gibberish'));
    expect(r.nextState).toBe(STATES.MENU);
    expect(r.fallbackCount).toBe(1);
    expect(r.replies).toHaveLength(2); // apology + menu
    expect(buttonIds(r.replies[1])).toContain(IDS.BTN_NEW);
  });

  it('2nd unrecognised input → HUMAN_HANDOFF, dormant 12h', () => {
    const r = processMessage(conv({ state: STATES.MENU, data: { greeted: true }, fallback_count: 1 }), btn('btn_does_not_exist'));
    expect(r.nextState).toBe(STATES.HUMAN_HANDOFF);
    expect(r.dormantFor).toBe(DORMANT_12H_MS);
    expect(r.leadData.lead_type).toBe('fallback');
  });
});

// ── English flow parity ──────────────────────────────────────────────────────
describe('english flow', () => {
  it('carries lang=en through the branch', () => {
    const r = processMessage(conv({ state: STATES.LEAD_INTEREST, lang: 'en', data: { greeted: true } }), lst(IDS.INTEREST_DIABETES));
    expect(r.lang).toBe('en');
    expect(r.replies[0].interactive.body.text).toMatch(/pick one/i); // English body
  });
});

// ── Terminal-state safety ────────────────────────────────────────────────────
describe('terminal state re-entry', () => {
  it('a message in HUMAN_HANDOFF greets fresh (defensive reset)', () => {
    const r = processMessage(conv({ state: STATES.HUMAN_HANDOFF, data: { greeted: true } }), txt('hello again'));
    expect(r.nextState).toBe(STATES.MENU);
    expect(r.nextData.greeted).toBe(true);
  });
});
