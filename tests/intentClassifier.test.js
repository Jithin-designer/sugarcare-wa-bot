/**
 * intentClassifier.test.js
 *
 * Pure unit tests for src/intentClassifier.js — no SQLite, no network, no
 * filesystem. Safe to run on any platform (Linux CI or macOS).
 *
 * Covers:
 *  - Each intent from Malayalam script, Manglish, and English
 *  - Safety guard must win (server.js responsibility, tested in integration)
 *  - Affirmation at WELCOME vs in-flow (server.js responsibility)
 *  - Case + punctuation normalisation
 *  - UNKNOWN passthrough
 */

import { describe, it, expect } from 'vitest';
import { classifyIntent, INTENTS } from '../src/intentClassifier.js';

// ── BOOKING ──────────────────────────────────────────────────────────────────

describe('BOOKING intent', () => {
  // Malayalam script
  it('ബുക്ക്', () => expect(classifyIntent('ബുക്ക്').intent).toBe(INTENTS.BOOKING));
  it('അപ്പോയിന്റ്മന്റ്', () => expect(classifyIntent('അപ്പോയിന്റ്മന്റ്').intent).toBe(INTENTS.BOOKING));
  it('കൺസൾട്ടേഷൻ', () => expect(classifyIntent('കൺസൾട്ടേഷൻ').intent).toBe(INTENTS.BOOKING));

  // Manglish (real production examples)
  it('appointment venam', () => expect(classifyIntent('appointment venam').intent).toBe(INTENTS.BOOKING));
  it('apointment venam (typo)', () => expect(classifyIntent('apointment venam').intent).toBe(INTENTS.BOOKING));
  it('consultation venam', () => expect(classifyIntent('consultation venam').intent).toBe(INTENTS.BOOKING));
  it('book cheyyam', () => expect(classifyIntent('book cheyyam').intent).toBe(INTENTS.BOOKING));
  it('doctor venam', () => expect(classifyIntent('doctor venam').intent).toBe(INTENTS.BOOKING));

  // English
  it('need consultation', () => expect(classifyIntent('Need consultation').intent).toBe(INTENTS.BOOKING));
  it('book appointment', () => expect(classifyIntent('Book appointment').intent).toBe(INTENTS.BOOKING));
  it('book', () => expect(classifyIntent('book').intent).toBe(INTENTS.BOOKING));
  it('appointment (standalone)', () => expect(classifyIntent('appointment').intent).toBe(INTENTS.BOOKING));

  // Case-insensitive
  it('APPOINTMENT (uppercase)', () => expect(classifyIntent('APPOINTMENT').intent).toBe(INTENTS.BOOKING));
  it('Appointment (mixed)', () => expect(classifyIntent('Appointment').intent).toBe(INTENTS.BOOKING));
});

// ── RESCHEDULE ───────────────────────────────────────────────────────────────

describe('RESCHEDULE intent', () => {
  // Malayalam script
  it('റീഷഡ്യൂൾ', () => expect(classifyIntent('റീഷഡ്യൂൾ').intent).toBe(INTENTS.RESCHEDULE));
  it('സമയ മാറ്റണം', () => expect(classifyIntent('സമയ മാറ്റണം').intent).toBe(INTENTS.RESCHEDULE));

  // Manglish
  it('reschedule cheyyanam', () => expect(classifyIntent('reschedule cheyyanam').intent).toBe(INTENTS.RESCHEDULE));
  it('time maaty', () => expect(classifyIntent('time maaty').intent).toBe(INTENTS.RESCHEDULE));
  it('change appointment', () => expect(classifyIntent('change appointment').intent).toBe(INTENTS.RESCHEDULE));
  it('appointment maatan', () => expect(classifyIntent('appointment maatan').intent).toBe(INTENTS.RESCHEDULE));
  it('date maatan', () => expect(classifyIntent('date maatan').intent).toBe(INTENTS.RESCHEDULE));

  // English
  it('reschedule appointment', () => expect(classifyIntent('reschedule appointment').intent).toBe(INTENTS.RESCHEDULE));
  it('reschedule my appointment', () => expect(classifyIntent('reschedule my appointment').intent).toBe(INTENTS.RESCHEDULE));
  it('reschedule (standalone)', () => expect(classifyIntent('reschedule').intent).toBe(INTENTS.RESCHEDULE));

  // RESCHEDULE beats BOOKING when both could match (e.g. "change appointment")
  it('change appointment — RESCHEDULE wins over BOOKING', () => {
    expect(classifyIntent('change appointment').intent).toBe(INTENTS.RESCHEDULE);
  });
});

// ── MEDICINE ─────────────────────────────────────────────────────────────────

describe('MEDICINE intent', () => {
  // Malayalam script
  it('മരുന്ന്', () => expect(classifyIntent('മരുന്ന്').intent).toBe(INTENTS.MEDICINE));
  it('മരന്ന്', () => expect(classifyIntent('മരന്ന്').intent).toBe(INTENTS.MEDICINE));
  it('മരുന്ന് വേണം', () => expect(classifyIntent('മരുന്ന് വേണം').intent).toBe(INTENTS.MEDICINE));

  // Manglish
  it('marunnu venam', () => expect(classifyIntent('marunnu venam').intent).toBe(INTENTS.MEDICINE));
  it('marunnu (standalone)', () => expect(classifyIntent('marunnu').intent).toBe(INTENTS.MEDICINE));
  it('medicine venam', () => expect(classifyIntent('medicine venam').intent).toBe(INTENTS.MEDICINE));
  it('tablet venam', () => expect(classifyIntent('tablet venam').intent).toBe(INTENTS.MEDICINE));

  // English
  it('medicine refill', () => expect(classifyIntent('medicine refill').intent).toBe(INTENTS.MEDICINE));
  it('order medicine', () => expect(classifyIntent('order medicine').intent).toBe(INTENTS.MEDICINE));
  it('refill', () => expect(classifyIntent('refill').intent).toBe(INTENTS.MEDICINE));
  it('medicine (standalone)', () => expect(classifyIntent('medicine').intent).toBe(INTENTS.MEDICINE));
});

// ── FAQ ──────────────────────────────────────────────────────────────────────

describe('FAQ intent', () => {
  // Malayalam script
  it('സംശയം', () => expect(classifyIntent('സംശയം').intent).toBe(INTENTS.FAQ));
  it('ഡൗട്ട്', () => expect(classifyIntent('ഡൗട്ട്').intent).toBe(INTENTS.FAQ));
  it('ഫീസ്', () => expect(classifyIntent('ഫീസ്').intent).toBe(INTENTS.FAQ));

  // Manglish
  it('doubt und', () => expect(classifyIntent('doubt und').intent).toBe(INTENTS.FAQ));
  it('oru doubt', () => expect(classifyIntent('oru doubt').intent).toBe(INTENTS.FAQ));
  it('fee ethra', () => expect(classifyIntent('fee ethra').intent).toBe(INTENTS.FAQ));
  it('timing und', () => expect(classifyIntent('timing und').intent).toBe(INTENTS.FAQ));
  it('clinic evide', () => expect(classifyIntent('clinic evide').intent).toBe(INTENTS.FAQ));
  it('chodyam', () => expect(classifyIntent('chodyam').intent).toBe(INTENTS.FAQ));

  // English
  it('what is the fee', () => expect(classifyIntent('what is the fee').intent).toBe(INTENTS.FAQ));
  it('location', () => expect(classifyIntent('location').intent).toBe(INTENTS.FAQ));
  it('timing', () => expect(classifyIntent('timing').intent).toBe(INTENTS.FAQ));
  it('doubt (standalone)', () => expect(classifyIntent('doubt').intent).toBe(INTENTS.FAQ));
  it('question', () => expect(classifyIntent('question').intent).toBe(INTENTS.FAQ));
  it('fees', () => expect(classifyIntent('fees').intent).toBe(INTENTS.FAQ));
  it('cost', () => expect(classifyIntent('cost').intent).toBe(INTENTS.FAQ));
});

// ── AFFIRMATION ───────────────────────────────────────────────────────────────

describe('AFFIRMATION intent', () => {
  // Malayalam script
  it('ശരി', () => expect(classifyIntent('ശരി').intent).toBe(INTENTS.AFFIRMATION));
  it('അതെ', () => expect(classifyIntent('അതെ').intent).toBe(INTENTS.AFFIRMATION));

  // Manglish
  it('ok', () => expect(classifyIntent('ok').intent).toBe(INTENTS.AFFIRMATION));
  it('okay', () => expect(classifyIntent('okay').intent).toBe(INTENTS.AFFIRMATION));
  it('shari', () => expect(classifyIntent('shari').intent).toBe(INTENTS.AFFIRMATION));
  it('athe', () => expect(classifyIntent('athe').intent).toBe(INTENTS.AFFIRMATION));
  it('yesu', () => expect(classifyIntent('yesu').intent).toBe(INTENTS.AFFIRMATION));
  it('yas', () => expect(classifyIntent('yas').intent).toBe(INTENTS.AFFIRMATION));

  // English
  it('yes', () => expect(classifyIntent('yes').intent).toBe(INTENTS.AFFIRMATION));
  it('yep', () => expect(classifyIntent('yep').intent).toBe(INTENTS.AFFIRMATION));
  it('yeah', () => expect(classifyIntent('yeah').intent).toBe(INTENTS.AFFIRMATION));
  it('sure', () => expect(classifyIntent('sure').intent).toBe(INTENTS.AFFIRMATION));

  // Trailing punctuation / mixed case
  it('yes.', () => expect(classifyIntent('yes.').intent).toBe(INTENTS.AFFIRMATION));
  it('YES', () => expect(classifyIntent('YES').intent).toBe(INTENTS.AFFIRMATION));
  it('ok!', () => expect(classifyIntent('ok!').intent).toBe(INTENTS.AFFIRMATION));
});

// ── UNKNOWN (passthrough) ────────────────────────────────────────────────────

describe('UNKNOWN intent — should not match anything', () => {
  it('hello', () => expect(classifyIntent('hello').intent).toBe(INTENTS.UNKNOWN));
  it('same phone number', () => expect(classifyIntent('same phone number').intent).toBe(INTENTS.UNKNOWN));
  it('ente phone number same aanu', () => expect(classifyIntent('ente phone number same aanu').intent).toBe(INTENTS.UNKNOWN));
  it('hi', () => expect(classifyIntent('hi').intent).toBe(INTENTS.UNKNOWN));
  it('empty string', () => expect(classifyIntent('').intent).toBe(INTENTS.UNKNOWN));
  it('null', () => expect(classifyIntent(null).intent).toBe(INTENTS.UNKNOWN));
  it('undefined', () => expect(classifyIntent(undefined).intent).toBe(INTENTS.UNKNOWN));
  it('random Malayalam', () => expect(classifyIntent('ഇത് ഒരു random message ആണ്').intent).toBe(INTENTS.UNKNOWN));
});

// ── Priority: RESCHEDULE beats BOOKING when both trigger words appear ─────────

describe('Intent priority ordering', () => {
  it('"reschedule appointment" → RESCHEDULE (not BOOKING)', () => {
    expect(classifyIntent('reschedule appointment').intent).toBe(INTENTS.RESCHEDULE);
  });
  it('"appointment maatan" → RESCHEDULE (not BOOKING)', () => {
    expect(classifyIntent('appointment maatan').intent).toBe(INTENTS.RESCHEDULE);
  });
});

// ── Confidence contract ('high' | 'low') ─────────────────────────────────────

describe('confidence field', () => {
  it("is 'high' when a trigger fires", () => {
    expect(classifyIntent('appointment venam').confidence).toBe('high');
    expect(classifyIntent('reschedule').confidence).toBe('high');
    expect(classifyIntent('yes').confidence).toBe('high');
  });
  it("is 'low' for UNKNOWN / empty input", () => {
    expect(classifyIntent('hello').confidence).toBe('low');
    expect(classifyIntent('').confidence).toBe('low');
    expect(classifyIntent(null).confidence).toBe('low');
  });
});

// ── Note on safety guard ─────────────────────────────────────────────────────
// The safety guard (isClinicalQuestion / isSafetyRedirectQuestion) fires BEFORE
// classifyIntent in server.js. A message like "ente sugar 300, appointment venam"
// is caught by the safety guard and redirected to a doctor — the classifier's
// booking match is never acted on. This is enforced in server.js, not here,
// because classifyIntent is a pure classifier with no knowledge of clinical
// phrases. The server-level test tests/intentRouter.test.js asserts that end to
// end (safety wins over booking) alongside the other routing scenarios.
