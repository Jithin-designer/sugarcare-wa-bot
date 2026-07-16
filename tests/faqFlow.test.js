/**
 * faqFlow.test.js — the FAQ-list rebuild (feature/faq-list-flow):
 *   WELCOME (3-row list) → book / doubt / medicine
 *   8-row FAQ list, one-step answers + two-step location/timing per clinic
 *   CALL_LINE on every resolving reply, absent on welcome/clinic-picker
 *   trailing buttons (book vs medicine for faq_delivery)
 *   safety guard (personal-medical + outcome/cure), mid-booking interception
 *   free-text → FAQ list → fallback-lead at threshold 1
 *   booking + medicine flows: clinic → lead saved, NO name step
 *
 * Pure-engine tests (processMessage) use the same builder pattern as
 * stateMachine.test.js. End-to-end tests (handleIncoming) mirror
 * conversations.test.js.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  processMessage,
  STATES,
  DORMANT_12H_MS,
  isClinicalQuestion,
  isSafetyRedirectQuestion,
} from '../src/stateMachine.js';
import {
  IDS,
  CALL_LINE,
  clinicRowId,
  CLINICS,
} from '../src/messages.js';
import { FAQ_ROWS } from '../src/content/faq.ml.js';

// ── builders ─────────────────────────────────────────────────────────────────
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
const btn = (buttonId) => ({ type: 'interactive', text: '', buttonId, listId: null, messageId: 'm', from: '911234567890', timestamp: 1 });
const lst = (listId) => ({ type: 'interactive', text: '', buttonId: null, listId, messageId: 'm', from: '911234567890', timestamp: 1 });

const buttonIds = (payload) => payload.interactive.action.buttons.map((b) => b.reply.id);
const listRowIds = (payload) => payload.interactive.action.sections.flatMap((s) => s.rows).map((r) => r.id);
const rendered = (r) => JSON.stringify(r.replies);
const hasCallLine = (r) => rendered(r).includes('79948 84799');

const ALL_CLINIC_IDS = CLINICS.map((c) => c.id);

// ── WELCOME (3-row list) ──────────────────────────────────────────────────────
describe('WELCOME', () => {
  it('first message greets with 3 rows (book/doubt/medicine), no CALL_LINE', () => {
    const r = processMessage(conv(), txt('namaskaram'));
    expect(r.nextState).toBe(STATES.WELCOME);
    expect(r.nextData.greeted).toBe(true);
    expect(listRowIds(r.replies[0])).toEqual([IDS.BTN_BOOK, IDS.BTN_DOUBT, IDS.BTN_MEDS]);
    expect(hasCallLine(r)).toBe(false);
  });

  it('book_appt → CLINIC_SELECT with all 7 clinics', () => {
    const r = processMessage(conv({ data: { greeted: true } }), lst(IDS.BTN_BOOK));
    expect(r.nextState).toBe(STATES.CLINIC_SELECT);
    expect(listRowIds(r.replies[0])).toHaveLength(7);
  });

  it('order_meds → MED_CLINIC with all 7 clinics', () => {
    const r = processMessage(conv({ data: { greeted: true } }), lst(IDS.BTN_MEDS));
    expect(r.nextState).toBe(STATES.MED_CLINIC);
    expect(listRowIds(r.replies[0])).toHaveLength(7);
  });

  it('ask_doubt → FAQ_LIST with 8 rows', () => {
    const r = processMessage(conv({ data: { greeted: true } }), lst(IDS.BTN_DOUBT));
    expect(r.nextState).toBe(STATES.FAQ_LIST);
    expect(listRowIds(r.replies[0])).toHaveLength(8);
  });

  it('clinic-picker prompt carries no CALL_LINE', () => {
    const r = processMessage(conv({ data: { greeted: true } }), lst(IDS.BTN_BOOK));
    expect(hasCallLine(r)).toBe(false);
  });
});

// ── BOOKING (2 steps, no name) ────────────────────────────────────────────────
describe('booking flow (no name step)', () => {
  it('clinic pick → lead saved (lead_type=booking, no name), confirm + CALL_LINE, reset to WELCOME', () => {
    const r = processMessage(conv({ state: STATES.CLINIC_SELECT, data: { greeted: true } }), lst(clinicRowId('edappal')));
    expect(r.nextState).toBe(STATES.WELCOME);
    expect(r.leadData).toMatchObject({ phone: '911234567890', clinic: 'edappal', lead_type: 'booking', priority: 0, name: null });
    expect(r.replies[0].type).toBe('text');
    expect(hasCallLine(r)).toBe(true);
  });

  it('confirmation interpolates the chosen clinic label', () => {
    const r = processMessage(conv({ state: STATES.CLINIC_SELECT, data: { greeted: true } }), lst(clinicRowId('edappal')));
    expect(r.replies[0].text.body).toContain('എടപ്പാൾ');
  });

  it('never asks for a phone number (auto-captured from sender)', () => {
    const r = processMessage(conv({ state: STATES.CLINIC_SELECT, data: { greeted: true } }), lst(clinicRowId('kondotty')));
    expect(rendered(r).toLowerCase()).not.toMatch(/phone number|mobile number|ഫോൺ നമ്പർ/);
    expect(r.leadData.phone).toBe('911234567890');
  });
});

// ── MEDICINE (2 steps, no name, mirrors booking) ─────────────────────────────
describe('medicine flow (no name step)', () => {
  it('clinic pick → lead saved (lead_type=medicine, no name), confirm + CALL_LINE, reset to WELCOME', () => {
    const r = processMessage(conv({ state: STATES.MED_CLINIC, data: { greeted: true } }), lst(clinicRowId('chemmad')));
    expect(r.nextState).toBe(STATES.WELCOME);
    expect(r.leadData).toMatchObject({ phone: '911234567890', clinic: 'chemmad', lead_type: 'medicine', priority: 0, name: null });
    expect(hasCallLine(r)).toBe(true);
  });
});

// ── DOUBT: 8 rows, one-step answers ──────────────────────────────────────────
describe('FAQ one-step answers', () => {
  const ONE_STEP = FAQ_ROWS.map((r) => r.id).filter((id) => id !== 'faq_location' && id !== 'faq_timing');

  for (const id of ONE_STEP) {
    it(`${id} → answer text + trailing buttons + CALL_LINE, stays FAQ_LIST`, () => {
      const r = processMessage(conv({ state: STATES.FAQ_LIST, data: { greeted: true } }), lst(id));
      expect(r.nextState).toBe(STATES.FAQ_LIST);
      expect(r.replies).toHaveLength(2);
      expect(r.replies[0].type).toBe('text');
      expect(r.replies[0].text.body.length).toBeGreaterThan(0);
      expect(hasCallLine(r)).toBe(true);
    });
  }

  it('faq_fees returns the ₹300 fee answer', () => {
    const r = processMessage(conv({ state: STATES.FAQ_LIST, data: { greeted: true } }), lst('faq_fees'));
    expect(r.replies[0].text.body).toContain('₹300');
  });
});

// ── DOUBT: two-step location + timing for all 7 clinics ──────────────────────
describe('FAQ two-step location', () => {
  it('faq_location → clinic picker (7 clinics), no CALL_LINE yet', () => {
    const r = processMessage(conv({ state: STATES.FAQ_LIST, data: { greeted: true } }), lst('faq_location'));
    expect(r.nextState).toBe(STATES.FAQ_LOCATION_CLINIC);
    expect(listRowIds(r.replies[0])).toHaveLength(7);
    expect(hasCallLine(r)).toBe(false);
  });

  for (const clinicId of ALL_CLINIC_IDS) {
    it(`location answer for ${clinicId} → text + CALL_LINE + trailing buttons, back to FAQ_LIST`, () => {
      const r = processMessage(
        conv({ state: STATES.FAQ_LOCATION_CLINIC, data: { greeted: true } }),
        lst(clinicRowId(clinicId))
      );
      expect(r.nextState).toBe(STATES.FAQ_LIST);
      expect(r.replies).toHaveLength(2);
      expect(r.replies[0].text.body.length).toBeGreaterThan(0);
      expect(hasCallLine(r)).toBe(true);
    });
  }
});

describe('FAQ two-step timing', () => {
  it('faq_timing → clinic picker (7 clinics)', () => {
    const r = processMessage(conv({ state: STATES.FAQ_LIST, data: { greeted: true } }), lst('faq_timing'));
    expect(r.nextState).toBe(STATES.FAQ_TIMING_CLINIC);
    expect(listRowIds(r.replies[0])).toHaveLength(7);
  });

  for (const clinicId of ALL_CLINIC_IDS) {
    it(`timing answer for ${clinicId} → timing + footer + CALL_LINE, back to FAQ_LIST`, () => {
      const r = processMessage(
        conv({ state: STATES.FAQ_TIMING_CLINIC, data: { greeted: true } }),
        lst(clinicRowId(clinicId))
      );
      expect(r.nextState).toBe(STATES.FAQ_LIST);
      // footer present after the clinic's timing
      expect(r.replies[0].text.body).toContain('ഞായറാഴ്ച അവധി');
      expect(hasCallLine(r)).toBe(true);
    });
  }
});

// ── Trailing buttons ──────────────────────────────────────────────────────────
describe('FAQ trailing buttons', () => {
  it('every non-delivery answer has [book_appt_short, ask_another]', () => {
    const r = processMessage(conv({ state: STATES.FAQ_LIST, data: { greeted: true } }), lst('faq_fees'));
    expect(buttonIds(r.replies[1])).toEqual([IDS.BTN_BOOK_SHORT, IDS.BTN_ASK_ANOTHER]);
  });

  it('faq_delivery has [order_meds_short, ask_another] instead of book', () => {
    const r = processMessage(conv({ state: STATES.FAQ_LIST, data: { greeted: true } }), lst('faq_delivery'));
    expect(buttonIds(r.replies[1])).toEqual([IDS.BTN_ORDER_MEDS_SHORT, IDS.BTN_ASK_ANOTHER]);
  });

  it('book_appt_short jumps into the booking clinic list', () => {
    const r = processMessage(conv({ state: STATES.FAQ_LIST, data: { greeted: true } }), btn(IDS.BTN_BOOK_SHORT));
    expect(r.nextState).toBe(STATES.CLINIC_SELECT);
    expect(listRowIds(r.replies[0])).toHaveLength(7);
  });

  it('order_meds_short jumps into the medicine clinic list', () => {
    const r = processMessage(conv({ state: STATES.FAQ_LIST, data: { greeted: true } }), btn(IDS.BTN_ORDER_MEDS_SHORT));
    expect(r.nextState).toBe(STATES.MED_CLINIC);
  });

  it('ask_another re-sends the 8-row FAQ list', () => {
    const r = processMessage(conv({ state: STATES.FAQ_LIST, data: { greeted: true } }), btn(IDS.BTN_ASK_ANOTHER));
    expect(r.nextState).toBe(STATES.FAQ_LIST);
    expect(listRowIds(r.replies[0])).toHaveLength(8);
  });
});

// ── Safety guard ──────────────────────────────────────────────────────────────
describe('safety guard: personal-medical + outcome/cure', () => {
  it('detector flags personal-medical and outcome/cure phrasings', () => {
    expect(isSafetyRedirectQuestion('ente sugar okay aano')).toBe(true);
    expect(isSafetyRedirectQuestion('should I change my medicine')).toBe(true);
    expect(isSafetyRedirectQuestion('will diabetes reverse')).toBe(true);
    expect(isSafetyRedirectQuestion('ഷുഗർ മാറുമോ')).toBe(true);
    expect(isSafetyRedirectQuestion('ഭേദമാകുമോ')).toBe(true);
  });

  it('does not flag ordinary FAQ intents', () => {
    expect(isSafetyRedirectQuestion('what are the clinic timings')).toBe(false);
    expect(isSafetyRedirectQuestion('location')).toBe(false);
  });

  it('cure question at FAQ_LIST → doctor redirect + book button + CALL_LINE (fires before FAQ dispatch)', () => {
    const r = processMessage(conv({ state: STATES.FAQ_LIST, data: { greeted: true } }), txt('diabetes cure ഉണ്ടോ'));
    expect(rendered(r)).toMatch(/ഡോക്ടറോട്/);
    expect(buttonIds(r.replies[1])).toEqual([IDS.BTN_BOOK_SHORT]);
    expect(hasCallLine(r)).toBe(true);
  });

  it('redirect reply is clean of banned words (never says cure/reversal in ML)', () => {
    const r = processMessage(conv({ state: STATES.FAQ_LIST, data: { greeted: true } }), txt('is my sugar okay'));
    // The English detection keyword 'cure'/'reverse' must NOT leak into the reply.
    expect(rendered(r).toLowerCase()).not.toMatch(/\bcure\b|\breversal\b/);
  });

  it('mid-booking safety interception → doctor redirect, then resume clinic list (no topic answering)', () => {
    // Personal-medical phrasing WITHOUT a numeric reading (a number would trip
    // the hard clinical guard → HUMAN_HANDOFF, which is correct but a different
    // path). This exercises the safety-only mid-booking resume.
    const r = processMessage(conv({ state: STATES.CLINIC_SELECT, data: { greeted: true } }), txt('ente marunnu maattano'));
    expect(r.nextState).toBe(STATES.CLINIC_SELECT);
    expect(rendered(r)).toMatch(/ഡോക്ടറോട്/);
    const listPayload = r.replies.find((p) => p.interactive?.type === 'list');
    expect(listPayload).toBeDefined();
    expect(listRowIds(listPayload)).toHaveLength(7);
  });

  it('strong clinical question still escalates to a PRIORITY human handoff', () => {
    const r = processMessage(conv({ state: STATES.FAQ_LIST, data: { greeted: true } }), txt('what metformin dose should I take'));
    expect(r.nextState).toBe(STATES.HUMAN_HANDOFF);
    expect(r.priority).toBe(true);
    expect(r.leadData.lead_type).toBe('clinical');
  });
});

// ── Free text / fallback (threshold = 1 retry) ───────────────────────────────
describe('fallback (threshold 1)', () => {
  it('1st unrecognised text → apology + 8-row FAQ list, count=1, no lead', () => {
    const r = processMessage(conv({ state: STATES.WELCOME, data: { greeted: true }, fallback_count: 0 }), txt('asdkjasdkj'));
    expect(r.nextState).toBe(STATES.FAQ_LIST);
    expect(r.fallbackCount).toBe(1);
    expect(r.leadData).toBeNull();
    expect(listRowIds(r.replies[1])).toHaveLength(8);
  });

  it('2nd consecutive miss → fallback lead saved, handoff + CALL_LINE, dormant 12h', () => {
    const r = processMessage(conv({ state: STATES.FAQ_LIST, data: { greeted: true }, fallback_count: 1 }), btn('nope'));
    expect(r.nextState).toBe(STATES.HUMAN_HANDOFF);
    expect(r.dormantFor).toBe(DORMANT_12H_MS);
    expect(r.leadData.lead_type).toBe('fallback');
    expect(hasCallLine(r)).toBe(true);
  });
});

// ── clinical detector sanity ─────────────────────────────────────────────────
describe('isClinicalQuestion', () => {
  it('flags dose/reading questions, not plain intents', () => {
    expect(isClinicalQuestion('what insulin dose should I take')).toBe(true);
    expect(isClinicalQuestion('my sugar is 300 what should I do')).toBe(true);
    expect(isClinicalQuestion('location')).toBe(false);
  });
});

// ── End-to-end (handleIncoming) ──────────────────────────────────────────────
describe('end-to-end (handleIncoming)', () => {
  let handleIncoming, openDb;
  let db, sends, send, seq;

  beforeEach(async () => {
    process.env.MOCK_MODE = 'true';
    process.env.MOCK_OUTBOX = 'data/test_outbox_faq.jsonl';
    ({ handleIncoming } = await import('../server.js'));
    ({ openDb } = await import('../src/db.js'));
    db = openDb(':memory:');
    sends = [];
    send = async (to, payload) => sends.push({ to, payload });
    seq = 0;
  });

  const from = '919812340000';
  const feed = (partial) => handleIncoming({ db, send }, {
    from, messageId: `wamid.F${++seq}`, timestamp: Date.now(),
    type: 'text', text: '', buttonId: null, listId: null, ...partial,
  });
  const text = (t) => feed({ type: 'text', text: t });
  const list = (id) => feed({ type: 'interactive', listId: id });
  const button = (id) => feed({ type: 'interactive', buttonId: id });

  it('booking happy path: welcome → book → clinic → booking lead saved, back at WELCOME', async () => {
    await text('hi');
    await list(IDS.BTN_BOOK);
    await list(clinicRowId('edappal'));
    const leads = db.leadsForPhone(from);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ clinic: 'edappal', lead_type: 'booking', name: null });
    expect(db.getConversation(from).state).toBe(STATES.WELCOME);
  });

  it('medicine happy path: welcome → medicine → clinic → medicine lead saved', async () => {
    await text('hi');
    await list(IDS.BTN_MEDS);
    await list(clinicRowId('kanjirathani'));
    const leads = db.leadsForPhone(from);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ clinic: 'kanjirathani', lead_type: 'medicine', name: null });
  });

  it('doubt → timing two-step → answer, then book_appt_short jumps into booking', async () => {
    await text('hi');
    await list(IDS.BTN_DOUBT);          // → FAQ_LIST
    await list('faq_timing');           // → FAQ_TIMING_CLINIC
    await list(clinicRowId('areekode')); // → answer, back to FAQ_LIST
    expect(db.getConversation(from).state).toBe(STATES.FAQ_LIST);
    await button(IDS.BTN_BOOK_SHORT);   // → CLINIC_SELECT
    expect(db.getConversation(from).state).toBe(STATES.CLINIC_SELECT);
    await list(clinicRowId('areekode'));
    const leads = db.leadsForPhone(from);
    expect(leads[0]).toMatchObject({ clinic: 'areekode', lead_type: 'booking' });
  });

  it('free text twice → fallback lead + handoff with phone number', async () => {
    await text('hi');
    await button('nope_1');
    expect(db.getConversation(from).fallback_count).toBe(1);
    await button('nope_2');
    expect(db.getConversation(from).state).toBe(STATES.HUMAN_HANDOFF);
    expect(db.leadsForPhone(from).some((l) => l.lead_type === 'fallback')).toBe(true);
    const lastSends = sends.slice(-2).map((s) => JSON.stringify(s.payload)).join(' ');
    expect(lastSends).toContain('79948 84799');
  });
});
