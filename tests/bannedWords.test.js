/**
 * bannedWords.test.js — HARD RULE #2.
 * 1. Every reply string in messages.js is clean.
 * 2. No src/ file (except the checker itself) contains a banned word.
 * 3. The checker behaves: catches standalone words, ignores innocent substrings.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findBannedWords, BANNED_WORDS } from '../src/bannedWords.js';
import {
  allStrings, welcome, bookingClinicList, bookingConfirm, medicineClinicList, medicineConfirm,
  faqList, faqAnswer, faqClinicPicker, faqLocationAnswer, faqTimingAnswer,
  doctorRedirect, fallbackReprompt, fallbackHandoff,
  CLINICS,
} from '../src/messages.js';
import { FAQ_ROWS } from '../src/content/faq.ml.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__dirname, '../src');

describe('messages.js reply strings', () => {
  it('has no banned words in any string (both languages)', () => {
    const offenders = [];
    for (const s of allStrings()) {
      const hits = findBannedWords(s);
      if (hits.length) offenders.push({ s, hits });
    }
    expect(offenders).toEqual([]);
  });

  it('has no banned words in any rendered payload (FAQ-list flow)', () => {
    // Render every screen builder and scan the flattened text.
    const payloads = [
      welcome(),
      bookingClinicList(), bookingConfirm('edappal'),
      medicineClinicList(), medicineConfirm(),
      faqList(),
      faqClinicPicker(),
      ...doctorRedirect(),
      ...fallbackReprompt(),
      ...fallbackHandoff(),
    ];
    // Every one-step FAQ answer.
    for (const row of FAQ_ROWS) {
      if (row.id === 'faq_location' || row.id === 'faq_timing') continue;
      payloads.push(...faqAnswer(row.id));
    }
    // Every per-clinic location + timing answer.
    for (const c of CLINICS) {
      payloads.push(...faqLocationAnswer(c.id));
      payloads.push(...faqTimingAnswer(c.id));
    }
    const texts = JSON.stringify(payloads);
    expect(findBannedWords(texts)).toEqual([]);
  });
});

describe('src/ files', () => {
  it('contain no banned words (excluding the checker definition file)', () => {
    const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.js') && f !== 'bannedWords.js');
    const offenders = [];
    for (const f of files) {
      const content = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
      const hits = findBannedWords(content);
      if (hits.length) offenders.push({ file: f, hits });
    }
    expect(offenders).toEqual([]);
  });
});

describe('the checker itself', () => {
  it('flags a standalone banned word', () => {
    expect(findBannedWords('this promises a cure')).toContain('cure');
    expect(findBannedWords('complete reversal of diabetes')).toContain('reversal');
    expect(findBannedWords('പ്രമേഹത്തിൽ നിന്ന് മുക്തി')).toContain('മുക്തി');
  });

  it('does NOT flag innocent substrings (word boundary)', () => {
    expect(findBannedWords('please keep it secure and accurate')).toEqual([]);
    expect(findBannedWords('SugarCARE Clinics')).toEqual([]);
  });

  it('exposes the exact banned list', () => {
    expect(BANNED_WORDS).toEqual(['reversal', 'cure', 'മുക്തി', 'മാറ്റിയെടുക്കാം']);
  });
});
