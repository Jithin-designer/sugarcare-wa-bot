/**
 * whatsappLimits.test.js — guards the WhatsApp Cloud API length limits that,
 * when exceeded, make Meta reject the ENTIRE message (a production outage:
 * every reply silently fails to send).
 *
 * Limits, counted in Unicode CODE POINTS — NOT visual glyphs and NOT UTF-16
 * units. A Malayalam orthographic cluster like "ക്ക" is several code points,
 * so [...s].length (code-point count) is the number Meta actually enforces:
 *   - interactive list row  title:        ≤ 24
 *   - interactive list row  description:   ≤ 72
 *   - interactive reply button title:      ≤ 20
 *   - list action button (the "open list" label): ≤ 20
 *   - interactive body text:               ≤ 1024
 *
 * This walks every rendered interactive payload the bot can send and asserts
 * each field is within limit, so an over-length label fails CI instead of
 * silently breaking sends in production.
 */

import { describe, it, expect } from 'vitest';
import {
  welcome,
  bookingClinicList, medicineClinicList,
  bookingConfirm, medicineConfirm,
  faqList, faqClinicPicker,
  faqAnswer, faqLocationAnswer, faqTimingAnswer,
  doctorRedirect, fallbackReprompt, fallbackHandoff,
  CLINICS,
} from '../src/messages.js';
import { FAQ_ROWS } from '../src/content/faq.ml.js';

const LIMITS = {
  listRowTitle: 24,
  listRowDescription: 72,
  buttonTitle: 20,
  listButton: 20,
  bodyText: 1024,
};

const cp = (s) => [...String(s)].length; // code-point count (what Meta counts)

// Render every interactive payload the bot can emit. Flatten multi-payload
// replies (answers are [text, buttons]; redirects are [text, buttons]; etc.).
function allPayloads() {
  const out = [
    welcome(),
    bookingClinicList(),
    medicineClinicList(),
    bookingConfirm('edappal'),
    medicineConfirm(),
    faqList(),
    faqClinicPicker(),
    ...doctorRedirect(),
    ...fallbackReprompt(),
    ...fallbackHandoff(),
  ];
  for (const row of FAQ_ROWS) {
    if (row.id === 'faq_location' || row.id === 'faq_timing') continue;
    out.push(...faqAnswer(row.id));
  }
  for (const c of CLINICS) {
    out.push(...faqLocationAnswer(c.id));
    out.push(...faqTimingAnswer(c.id));
  }
  return out;
}

/** Collect every length violation across a payload into a flat list. */
function violations(payload) {
  const bad = [];
  const it = payload.interactive;
  if (!it) return bad; // plain text bubbles have no length-limited controls

  if (it.body?.text && cp(it.body.text) > LIMITS.bodyText) {
    bad.push({ field: 'body', len: cp(it.body.text), limit: LIMITS.bodyText, text: it.body.text });
  }

  if (it.type === 'button') {
    for (const b of it.action.buttons) {
      if (cp(b.reply.title) > LIMITS.buttonTitle) {
        bad.push({ field: 'button.title', len: cp(b.reply.title), limit: LIMITS.buttonTitle, text: b.reply.title });
      }
    }
  }

  if (it.type === 'list') {
    if (cp(it.action.button) > LIMITS.listButton) {
      bad.push({ field: 'list.button', len: cp(it.action.button), limit: LIMITS.listButton, text: it.action.button });
    }
    for (const section of it.action.sections) {
      for (const row of section.rows) {
        if (cp(row.title) > LIMITS.listRowTitle) {
          bad.push({ field: 'row.title', len: cp(row.title), limit: LIMITS.listRowTitle, text: row.title });
        }
        if (row.description && cp(row.description) > LIMITS.listRowDescription) {
          bad.push({ field: 'row.description', len: cp(row.description), limit: LIMITS.listRowDescription, text: row.description });
        }
      }
    }
  }
  return bad;
}

describe('WhatsApp payload length limits (code points)', () => {
  it('no interactive payload exceeds any WhatsApp limit', () => {
    const offenders = allPayloads().flatMap(violations);
    // A readable failure: shows exactly which label is over and by how much.
    expect(offenders).toEqual([]);
  });

  it('every FAQ row has both a short title (≤24) and a description (≤72)', () => {
    for (const row of FAQ_ROWS) {
      expect(cp(row.title), `title "${row.title}"`).toBeLessThanOrEqual(LIMITS.listRowTitle);
      expect(row.description, `row ${row.id} description`).toBeTruthy();
      expect(cp(row.description), `desc "${row.description}"`).toBeLessThanOrEqual(LIMITS.listRowDescription);
    }
  });

  it('welcome list rows fit (24) and the 3 entry ids are present', () => {
    const rows = welcome().interactive.action.sections.flatMap((s) => s.rows);
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(cp(r.title)).toBeLessThanOrEqual(LIMITS.listRowTitle);
  });

  it('trailing quick-reply buttons fit (20)', () => {
    const btns = faqAnswer('faq_fees')[1].interactive.action.buttons
      .concat(faqAnswer('faq_delivery')[1].interactive.action.buttons);
    for (const b of btns) expect(cp(b.reply.title)).toBeLessThanOrEqual(LIMITS.buttonTitle);
  });
});
