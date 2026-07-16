/**
 * stateMachine.test.js — core pure-engine guarantees that are NOT the FAQ-flow
 * happy paths (those live in faqFlow.test.js): the clinical guard, terminal-state
 * defensive reset, the Malayalam-only contract, and the result shape.
 */

import { describe, it, expect } from 'vitest';
import { processMessage, STATES, DORMANT_12H_MS, isClinicalQuestion } from '../src/stateMachine.js';
import { IDS } from '../src/messages.js';

const conv = (o = {}) => ({
  phone: '911234567890',
  state: STATES.WELCOME,
  lang: 'ml',
  data: {},
  fallback_count: 0,
  dormant_until: null,
  last_user_message_at: null,
  ...o,
});
const txt = (text) => ({ type: 'text', text, buttonId: null, listId: null, messageId: 'm', from: '911234567890', timestamp: 1 });

// ── Clinical guard (HARD RULE #1) ────────────────────────────────────────────
describe('clinical guard', () => {
  it('detector: flags clinical questions, not plain intent', () => {
    expect(isClinicalQuestion('എന്റെ sugar 300 ആണ്, എന്ത് ചെയ്യണം?')).toBe(true);
    expect(isClinicalQuestion('what insulin dose should I take')).toBe(true);
    expect(isClinicalQuestion('Ramesh')).toBe(false);
    expect(isClinicalQuestion('I want diabetes care')).toBe(false); // intent, not a question
  });

  it('a clinical question anywhere → PRIORITY handoff, dormant 12h, no raw text stored', () => {
    const r = processMessage(conv({ state: STATES.FAQ_LIST, data: { greeted: true } }), txt('my sugar is 350 what should I do'));
    expect(r.nextState).toBe(STATES.HUMAN_HANDOFF);
    expect(r.priority).toBe(true);
    expect(r.dormantFor).toBe(DORMANT_12H_MS);
    expect(r.leadData.lead_type).toBe('clinical');
    expect(JSON.stringify(r.leadData)).not.toContain('350'); // DPDP data-minimisation
  });
});

// ── Malayalam-only contract ──────────────────────────────────────────────────
describe('language', () => {
  it('always returns lang=ml (no English fork remains)', () => {
    const r = processMessage(conv(), txt('hi'));
    expect(r.lang).toBe('ml');
  });
});

// ── Terminal-state safety ────────────────────────────────────────────────────
describe('terminal state re-entry', () => {
  it('a message in HUMAN_HANDOFF greets fresh at WELCOME (defensive reset)', () => {
    const r = processMessage(conv({ state: STATES.HUMAN_HANDOFF, data: { greeted: true } }), txt('hello again'));
    expect(r.nextState).toBe(STATES.WELCOME);
    expect(r.nextData.greeted).toBe(true);
  });
});

// ── Result shape ──────────────────────────────────────────────────────────────
describe('result contract', () => {
  it('returns the documented keys', () => {
    const r = processMessage(conv(), txt('hi'));
    expect(Object.keys(r).sort()).toEqual(
      ['dormantFor', 'fallbackCount', 'lang', 'leadData', 'nextData', 'nextState', 'priority', 'replies'].sort()
    );
    expect(Array.isArray(r.replies)).toBe(true);
  });

  it('welcome greeting sets greeted and does not save a lead', () => {
    const r = processMessage(conv(), txt('namaskaram'));
    expect(r.nextData.greeted).toBe(true);
    expect(r.leadData).toBeNull();
    expect(r.replies[0].interactive.type).toBe('list'); // 3-row welcome list
    void IDS; // (imported for parity with other suites)
  });
});
