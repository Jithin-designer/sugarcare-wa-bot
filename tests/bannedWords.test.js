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
import { allStrings, menu, interestList, leadClinicList, patientMenu, apptClinicList, fallbackReprompt } from '../src/messages.js';

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

  it('has no banned words in any rendered payload', () => {
    // Render every screen builder in both languages and scan the flattened text.
    const payloads = [];
    for (const lang of ['ml', 'en']) {
      payloads.push(menu(lang), interestList(lang), leadClinicList(lang), patientMenu(lang), apptClinicList(lang), ...fallbackReprompt(lang));
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
