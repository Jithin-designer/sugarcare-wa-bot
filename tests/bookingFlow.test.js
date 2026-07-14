/**
 * bookingFlow.test.js — the booking-first flow (feature/booking-first-flow):
 * WELCOME → CLINIC_SELECT → NAME_CAPTURE → BOOKING_COMPLETE → CLOSING_LOOP,
 * the secondary Q&A path (QA_ANSWER), mid-booking interception + resume, and
 * the new HbA1c/diet education carve-outs in the clinical guard.
 *
 * Pure-engine tests (processMessage) follow the same builder pattern as
 * stateMachine.test.js. End-to-end tests (handleIncoming) follow the same
 * pattern as conversations.test.js.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  processMessage,
  STATES,
  DORMANT_12H_MS,
  isClinicalQuestion,
  classifyQaTopic,
  isPersonalMedicalQuestion,
} from '../src/stateMachine.js';
import { IDS, clinicRowId } from '../src/messages.js';

// ── builders (mirrors stateMachine.test.js) ──────────────────────────────────
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

// ── WELCOME (entry point) ─────────────────────────────────────────────────────
describe('WELCOME', () => {
  it('first message greets with Book/Doubt buttons and sets greeted', () => {
    const r = processMessage(conv(), txt('namaskaram'));
    expect(r.nextState).toBe(STATES.WELCOME);
    expect(r.nextData.greeted).toBe(true);
    expect(r.replies).toHaveLength(1);
    expect(buttonIds(r.replies[0])).toEqual([IDS.BTN_BOOK, IDS.BTN_DOUBT]);
  });

  it('btn_book → CLINIC_SELECT with all 7 clinics (incl. Edappal)', () => {
    const r = processMessage(conv({ data: { greeted: true } }), btn(IDS.BTN_BOOK));
    expect(r.nextState).toBe(STATES.CLINIC_SELECT);
    const rows = listRowIds(r.replies[0]);
    expect(rows).toHaveLength(7);
    expect(rows).toContain(clinicRowId('edappal'));
  });

  it('btn_doubt → QA_ANSWER, prompts for the question', () => {
    const r = processMessage(conv({ data: { greeted: true } }), btn(IDS.BTN_DOUBT));
    expect(r.nextState).toBe(STATES.QA_ANSWER);
    expect(r.replies[0].type).toBe('text');
  });

  it('btn_talk_to_team bridges into the pre-existing PATIENT_MENU (report/Rx/team kept intact)', () => {
    const r = processMessage(conv({ data: { greeted: true } }), btn(IDS.BTN_TALK_TO_TEAM));
    expect(r.nextState).toBe(STATES.PATIENT_MENU);
    expect(buttonIds(r.replies[0])).toEqual([IDS.BTN_APPT, IDS.BTN_REPORT, IDS.BTN_TEAM]);
  });

  // Manglish / English / Malayalam all understood at WELCOME without forcing a button tap.
  it('typed Manglish "book cheyyam" → CLINIC_SELECT', () => {
    const r = processMessage(conv({ data: { greeted: true } }), txt('book cheyyam'));
    expect(r.nextState).toBe(STATES.CLINIC_SELECT);
  });

  it('typed English "I want to book an appointment" → CLINIC_SELECT', () => {
    const r = processMessage(conv({ data: { greeted: true } }), txt('I want to book an appointment'));
    expect(r.nextState).toBe(STATES.CLINIC_SELECT);
  });

  it('typed Manglish "doubt undu" → QA_ANSWER', () => {
    const r = processMessage(conv({ data: { greeted: true } }), txt('doubt undu'));
    expect(r.nextState).toBe(STATES.QA_ANSWER);
  });

  it('typed Malayalam "ബുക്ക് ചെയ്യണം" → CLINIC_SELECT (never forces Malayalam typing, but understands it too)', () => {
    const r = processMessage(conv({ data: { greeted: true } }), txt('ബുക്ക് ചെയ്യണം'));
    expect(r.nextState).toBe(STATES.CLINIC_SELECT);
  });

  it('unrecognised text after greeting → fallback (not a silent no-op)', () => {
    const r = processMessage(conv({ data: { greeted: true } }), txt('asdkjasdkj'));
    expect(r.nextState).toBe(STATES.WELCOME);
    expect(r.fallbackCount).toBe(1);
  });
});

// ── CLINIC_SELECT ─────────────────────────────────────────────────────────────
describe('CLINIC_SELECT', () => {
  it('clinic pick → NAME_CAPTURE', () => {
    const r = processMessage(conv({ state: STATES.CLINIC_SELECT, data: { greeted: true } }), lst(clinicRowId('edappal')));
    expect(r.nextState).toBe(STATES.NAME_CAPTURE);
    expect(r.nextData.clinic).toBe('edappal');
    expect(r.replies[0].type).toBe('text');
  });

  it('mid-booking Q&A topic question → brief answer, then RESUME the clinic list (not restart welcome)', () => {
    const r = processMessage(conv({ state: STATES.CLINIC_SELECT, data: { greeted: true } }), txt('what should I eat for diet'));
    expect(r.nextState).toBe(STATES.CLINIC_SELECT); // resumed at the same step, not WELCOME
    expect(r.nextData.resumeState).toBe(STATES.CLINIC_SELECT);
    // brief answer + "back to booking" line + the re-shown clinic list (3 payloads)
    expect(r.replies.length).toBeGreaterThanOrEqual(3);
    const rendered = JSON.stringify(r.replies);
    expect(rendered).toContain('Back to booking');
    const listPayload = r.replies.find((p) => p.interactive?.type === 'list');
    expect(listRowIds(listPayload)).toHaveLength(7);
  });

  it('mid-booking PERSONAL question ("is my sugar okay") → doctor deferral, then resume clinic list', () => {
    const r = processMessage(conv({ state: STATES.CLINIC_SELECT, data: { greeted: true } }), txt('is my sugar okay'));
    expect(r.nextState).toBe(STATES.CLINIC_SELECT);
    const rendered = JSON.stringify(r.replies);
    expect(rendered).toMatch(/doctor/i);
    const listPayload = r.replies.find((p) => p.interactive?.type === 'list');
    expect(listPayload).toBeDefined();
  });

  it('garbage (unrecognised, non-question) input → ordinary fallback, not a resume', () => {
    const r = processMessage(conv({ state: STATES.CLINIC_SELECT, data: { greeted: true } }), txt('zzz random gibberish zzz'));
    expect(r.nextState).toBe(STATES.WELCOME);
    expect(r.fallbackCount).toBe(1);
  });
});

// ── NAME_CAPTURE ──────────────────────────────────────────────────────────────
describe('NAME_CAPTURE', () => {
  it('typed name → BOOKING_COMPLETE, confirmation + closing loop (2 payloads)', () => {
    const r = processMessage(
      conv({ state: STATES.NAME_CAPTURE, data: { greeted: true, clinic: 'edappal' } }),
      txt('Ramesh')
    );
    expect(r.nextState).toBe(STATES.BOOKING_COMPLETE);
    expect(r.replies).toHaveLength(2);
    expect(r.replies[0].type).toBe('text');
    expect(JSON.stringify(r.replies[0])).toContain('Ramesh');
    expect(buttonIds(r.replies[1])).toEqual([IDS.BTN_CLOSING_YES, IDS.BTN_CLOSING_NO]);
  });

  it('leadData captures phone (auto, never asked), name, clinic, timestamp-ready shape', () => {
    const r = processMessage(
      conv({ state: STATES.NAME_CAPTURE, data: { greeted: true, clinic: 'kondotty' } }),
      txt('Fathima')
    );
    expect(r.leadData).toMatchObject({
      phone: '911234567890', name: 'Fathima', clinic: 'kondotty', lead_type: 'booking', priority: 0,
    });
  });

  it('mid-booking Q&A topic question → brief answer, then RESUME the name prompt', () => {
    const r = processMessage(
      conv({ state: STATES.NAME_CAPTURE, data: { greeted: true, clinic: 'edappal' } }),
      txt('how often should I check my sugar')
    );
    expect(r.nextState).toBe(STATES.NAME_CAPTURE);
    expect(r.nextData.resumeState).toBe(STATES.NAME_CAPTURE);
    expect(r.leadData).toBeNull(); // must NOT have captured the question text as the name
  });

  it('mid-booking PERSONAL question ("should I change my medicine") → doctor deferral, resume name prompt', () => {
    const r = processMessage(
      conv({ state: STATES.NAME_CAPTURE, data: { greeted: true, clinic: 'edappal' } }),
      txt('should I change my medicine')
    );
    expect(r.nextState).toBe(STATES.NAME_CAPTURE);
    expect(r.leadData).toBeNull();
    expect(JSON.stringify(r.replies)).toMatch(/doctor/i);
  });
});

// ── QA_ANSWER (secondary path) ────────────────────────────────────────────────
describe('QA_ANSWER', () => {
  it('diet question → canned diet answer + mandatory [Book][Doubt] footer', () => {
    const r = processMessage(conv({ state: STATES.QA_ANSWER, data: { greeted: true } }), txt('what should I eat'));
    expect(r.nextState).toBe(STATES.QA_ANSWER);
    expect(r.replies).toHaveLength(2);
    expect(buttonIds(r.replies[1])).toEqual([IDS.BTN_BOOK, IDS.BTN_DOUBT]);
  });

  it('"what is HbA1c" → education answer (carve-out), NOT escalated to a human', () => {
    const r = processMessage(conv({ state: STATES.QA_ANSWER, data: { greeted: true } }), txt('what is HbA1c'));
    expect(r.nextState).toBe(STATES.QA_ANSWER);
    expect(JSON.stringify(r.replies)).toMatch(/hba1c/i);
  });

  it('personal question ("is my sugar okay") → doctor deferral + footer, never a canned topic answer', () => {
    const r = processMessage(conv({ state: STATES.QA_ANSWER, data: { greeted: true } }), txt('is my sugar okay'));
    expect(r.nextState).toBe(STATES.QA_ANSWER);
    expect(JSON.stringify(r.replies)).toMatch(/doctor/i);
    expect(buttonIds(r.replies[1])).toEqual([IDS.BTN_BOOK, IDS.BTN_DOUBT]);
  });

  it('unrecognised topic → safe qa_redirect_unknown deferral, never fabricates an answer', () => {
    const r = processMessage(conv({ state: STATES.QA_ANSWER, data: { greeted: true } }), txt('xyz something unrelated'));
    expect(r.nextState).toBe(STATES.QA_ANSWER);
    expect(JSON.stringify(r.replies)).toMatch(/doctor/i);
  });

  it('"Book cheyyam" from QA_ANSWER → jumps straight to CLINIC_SELECT (does NOT restart welcome)', () => {
    const r = processMessage(conv({ state: STATES.QA_ANSWER, data: { greeted: true } }), btn(IDS.BTN_BOOK));
    expect(r.nextState).toBe(STATES.CLINIC_SELECT);
    expect(listRowIds(r.replies[0])).toHaveLength(7);
  });

  it('"Doubt undu" again from QA_ANSWER → stays in QA_ANSWER, re-prompts for a question', () => {
    const r = processMessage(conv({ state: STATES.QA_ANSWER, data: { greeted: true } }), btn(IDS.BTN_DOUBT));
    expect(r.nextState).toBe(STATES.QA_ANSWER);
  });
});

// ── CLOSING_LOOP / BOOKING_COMPLETE ──────────────────────────────────────────
describe('closing loop', () => {
  it('BOOKING_COMPLETE + Yes → back to WELCOME buttons', () => {
    const r = processMessage(conv({ state: STATES.BOOKING_COMPLETE, data: { greeted: true } }), btn(IDS.BTN_CLOSING_YES));
    expect(r.nextState).toBe(STATES.WELCOME);
    expect(buttonIds(r.replies[0])).toEqual([IDS.BTN_BOOK, IDS.BTN_DOUBT]);
  });

  it('BOOKING_COMPLETE + No → closing bye message, DORMANT 12h (session ends)', () => {
    const r = processMessage(conv({ state: STATES.BOOKING_COMPLETE, data: { greeted: true } }), btn(IDS.BTN_CLOSING_NO));
    expect(r.nextState).toBe(STATES.DORMANT);
    expect(r.dormantFor).toBe(DORMANT_12H_MS);
  });

  it('CLOSING_LOOP + Yes → back to WELCOME buttons (same as BOOKING_COMPLETE)', () => {
    const r = processMessage(conv({ state: STATES.CLOSING_LOOP, data: { greeted: true } }), btn(IDS.BTN_CLOSING_YES));
    expect(r.nextState).toBe(STATES.WELCOME);
  });

  it('CLOSING_LOOP + No → DORMANT 12h', () => {
    const r = processMessage(conv({ state: STATES.CLOSING_LOOP, data: { greeted: true } }), btn(IDS.BTN_CLOSING_NO));
    expect(r.nextState).toBe(STATES.DORMANT);
    expect(r.dormantFor).toBe(DORMANT_12H_MS);
  });
});

// ── Safety rules ──────────────────────────────────────────────────────────────
describe('safety: garbage input twice → handoff with phone number', () => {
  it('2nd unrecognised input from WELCOME → HUMAN_HANDOFF, reply includes the team phone number', () => {
    const r = processMessage(conv({ state: STATES.WELCOME, data: { greeted: true }, fallback_count: 1 }), btn('btn_does_not_exist'));
    expect(r.nextState).toBe(STATES.HUMAN_HANDOFF);
    expect(r.dormantFor).toBe(DORMANT_12H_MS);
    const rendered = JSON.stringify(r.replies);
    expect(rendered).toContain('79948 84799');
  });

  it('2nd unrecognised input from CLINIC_SELECT (mid-booking) → same handoff + phone number', () => {
    const r = processMessage(conv({ state: STATES.CLINIC_SELECT, data: { greeted: true }, fallback_count: 1 }), txt('zzz'));
    expect(r.nextState).toBe(STATES.HUMAN_HANDOFF);
    expect(JSON.stringify(r.replies)).toContain('79948 84799');
  });
});

describe('safety: mid-booking question resumes, never restarts welcome', () => {
  it('answering a diet question mid-CLINIC_SELECT keeps the clinic already chosen intact on the next real pick', () => {
    const afterQ = processMessage(conv({ state: STATES.CLINIC_SELECT, data: { greeted: true } }), txt('what about exercise'));
    expect(afterQ.nextState).toBe(STATES.CLINIC_SELECT);
    // now actually pick a clinic — should proceed normally, unaffected by the interruption
    const afterPick = processMessage(conv({ state: STATES.CLINIC_SELECT, data: afterQ.nextData }), lst(clinicRowId('areekode')));
    expect(afterPick.nextState).toBe(STATES.NAME_CAPTURE);
    expect(afterPick.nextData.clinic).toBe('areekode');
  });
});

describe('safety: no phone number is ever asked (auto-captured from sender)', () => {
  it('the booking confirmation flow never produces a prompt asking for a phone number', () => {
    const r1 = processMessage(conv({ state: STATES.CLINIC_SELECT, data: { greeted: true } }), lst(clinicRowId('edappal')));
    const r2 = processMessage(conv({ state: STATES.NAME_CAPTURE, data: r1.nextData }), txt('Ramesh'));
    const allText = JSON.stringify([r1.replies, r2.replies]);
    expect(allText.toLowerCase()).not.toMatch(/phone number|mobile number|ഫോൺ നമ്പർ/);
    expect(r2.leadData.phone).toBe('911234567890'); // auto-captured from message.from
  });
});

// ── Classifier unit checks ────────────────────────────────────────────────────
describe('classifyQaTopic', () => {
  it('recognises the 4 allowed education topics', () => {
    expect(classifyQaTopic('what should I eat')).toBe('diet');
    expect(classifyQaTopic('is walking good for me')).toBe('exercise');
    expect(classifyQaTopic('how often should I check my sugar')).toBe('monitoring');
    expect(classifyQaTopic('what is hba1c')).toBe('hba1c');
  });

  it('returns null for unrelated text', () => {
    expect(classifyQaTopic('Ramesh')).toBeNull();
    expect(classifyQaTopic('random text')).toBeNull();
  });
});

describe('isPersonalMedicalQuestion', () => {
  it('flags "about me" phrasings the broad clinical guard misses', () => {
    expect(isPersonalMedicalQuestion('is my sugar okay')).toBe(true);
    expect(isPersonalMedicalQuestion('should I change my medicine')).toBe(true);
  });

  it('does not flag generic education questions', () => {
    expect(isPersonalMedicalQuestion('what should I eat')).toBe(false);
    expect(isPersonalMedicalQuestion('what is hba1c')).toBe(false);
  });
});

describe('isClinicalQuestion carve-outs (HbA1c + diet education)', () => {
  it('"what is HbA1c" is NOT clinical (education carve-out)', () => {
    expect(isClinicalQuestion('what is HbA1c')).toBe(false);
  });

  it('"my hba1c is 9.2" STILL escalates (personal reading, carve-out does not apply)', () => {
    expect(isClinicalQuestion('my hba1c is 9.2, what dose should I take')).toBe(true);
  });

  it('"what should i eat" is NOT clinical (diet education carve-out)', () => {
    expect(isClinicalQuestion('what should i eat')).toBe(false);
  });

  it('"what should i do about my sugar 300" STILL escalates (has a number + personal framing)', () => {
    expect(isClinicalQuestion('what should i do about my sugar 300')).toBe(true);
  });
});

// ── End-to-end (handleIncoming) — the 5 named scenarios ──────────────────────
describe('end-to-end scenarios (handleIncoming)', () => {
  let handleIncoming, openDb;
  let db, sends, send, seq;

  beforeEach(async () => {
    process.env.MOCK_MODE = 'true';
    process.env.MOCK_OUTBOX = 'data/test_outbox_booking.jsonl';
    ({ handleIncoming } = await import('../server.js'));
    ({ openDb } = await import('../src/db.js'));
    db = openDb(':memory:');
    sends = [];
    send = async (to, payload) => sends.push({ to, payload });
    seq = 0;
  });

  const from = '919812340000';
  const feed = (partial) => handleIncoming({ db, send }, {
    from, messageId: `wamid.BF${++seq}`, timestamp: Date.now(),
    type: 'text', text: '', buttonId: null, listId: null, ...partial,
  });
  const text = (t) => feed({ type: 'text', text: t });
  const button = (id) => feed({ type: 'interactive', buttonId: id });
  const list = (id) => feed({ type: 'interactive', listId: id });

  it('scenario 1: full happy path — welcome → clinic → name → confirm', async () => {
    await text('hi');
    await button(IDS.BTN_BOOK);
    await list(clinicRowId('edappal'));
    await text('Ramesh');

    const leads = db.leadsForPhone(from);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ name: 'Ramesh', clinic: 'edappal', lead_type: 'booking' });
    expect(db.getConversation(from).state).toBe(STATES.BOOKING_COMPLETE);
  });

  it('scenario 2: "Book now" from Q&A mid-conversation → jumps to CLINIC_SELECT, no welcome restart', async () => {
    await text('hi');
    await button(IDS.BTN_DOUBT);
    await text('what should I eat');       // gets a diet answer + footer
    await button(IDS.BTN_BOOK);             // taps Book from the Q&A footer

    const c = db.getConversation(from);
    expect(c.state).toBe(STATES.CLINIC_SELECT); // NOT back at WELCOME
    await list(clinicRowId('chemmad'));
    await text('Fathima');
    const leads = db.leadsForPhone(from);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ name: 'Fathima', clinic: 'chemmad', lead_type: 'booking' });
  });

  it('scenario 3: mid-booking question → resume booking at the exact step it paused', async () => {
    await text('hi');
    await button(IDS.BTN_BOOK);
    await list(clinicRowId('kondotty')); // → NAME_CAPTURE
    await text('how often should I check my sugar'); // interrupts NAME_CAPTURE
    expect(db.getConversation(from).state).toBe(STATES.NAME_CAPTURE); // resumed, not restarted
    await text('Ramesh'); // now actually gives the name
    const leads = db.leadsForPhone(from);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ name: 'Ramesh', clinic: 'kondotty' });
  });

  it('scenario 4: garbage input twice → HUMAN_HANDOFF with team phone number', async () => {
    await text('hi');
    const s1 = await button('nope_1');
    expect(s1).toBe('processed');
    expect(db.getConversation(from).fallback_count).toBe(1);

    await button('nope_2');
    expect(db.getConversation(from).state).toBe(STATES.HUMAN_HANDOFF);
    const leads = db.leadsForPhone(from);
    expect(leads.some((l) => l.lead_type === 'fallback')).toBe(true);
    const lastTwoSends = sends.slice(-2).map((s) => JSON.stringify(s.payload)).join(' ');
    expect(lastTwoSends).toContain('79948 84799');
  });

  it('scenario 5a: Malayalam input at welcome is understood ("ബുക്ക് ചെയ്യണം")', async () => {
    await text('നമസ്കാരം');
    await text('ബുക്ക് ചെയ്യണം');
    expect(db.getConversation(from).state).toBe(STATES.CLINIC_SELECT);
  });

  it('scenario 5b: Manglish input at welcome is understood ("doubt undu")', async () => {
    await text('hi');
    await text('doubt undu');
    expect(db.getConversation(from).state).toBe(STATES.QA_ANSWER);
  });

  it('scenario 5c: English input at welcome is understood ("book an appointment")', async () => {
    await text('hello');
    await text('I need to book an appointment please');
    expect(db.getConversation(from).state).toBe(STATES.CLINIC_SELECT);
  });
});
