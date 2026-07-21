/**
 * src/intentClassifier.js — deterministic free-text intent classifier.
 *
 * HARD RULE #1 (no RAG/LLM on the message path) applies here too: this is pure
 * keyword / pattern matching, exactly like `isClinicalQuestion` in
 * stateMachine.js. Given a typed message it returns which existing flow the
 * text most likely wants, so server.js can route a typed sentence into a flow
 * the bot previously only reached via button/list taps.
 *
 * Contract:
 *   classifyIntent(text) → { intent, confidence, matched }
 *     intent     — one of INTENTS (BOOKING | RESCHEDULE | MEDICINE | FAQ |
 *                  AFFIRMATION | UNKNOWN)
 *     confidence — 'high' when a trigger fired, 'low' for UNKNOWN.
 *     matched    — the trigger phrase that fired (drives the audit log / the
 *                  BUILD-NOTES table); '' for UNKNOWN.
 *
 * PURE: no state, no clock, no DB, no I/O. It does NOT decide safety —
 * clinical / personal-medical / outcome questions are detected separately
 * (stateMachine.js: isClinicalQuestion, isSafetyRedirectQuestion) and server.js
 * runs those guards BEFORE ever consulting this classifier, so a
 * "sugar 300, appointment venam" message is escalated to a human, never booked.
 *
 * Every trigger phrase below is auditable by Dr. Rakesh (table in BUILD-NOTES.md).
 * The referenced python branch (Jithin-designer/preventify-diabetes-ai
 * feature/intent-router) was NOT available — no such branch exists on that repo
 * (only `main`, a RAG project) — so these triggers were authored from the
 * SugarCARE brief plus the existing Manglish/Malayalam detector patterns in
 * stateMachine.js.
 */

export const INTENTS = Object.freeze({
  BOOKING: 'BOOKING',
  RESCHEDULE: 'RESCHEDULE',
  MEDICINE: 'MEDICINE',
  FAQ: 'FAQ',
  AFFIRMATION: 'AFFIRMATION',
  UNKNOWN: 'UNKNOWN',
});

// ── Trigger tables (English + Manglish + Malayalam) ──────────────────────────
// Matching rules (mirror stateMachine.js matchesKeyword):
//   • an ASCII single word matches on a \b word boundary  ("ok" ≠ "book")
//   • anything containing a space, or any Malayalam token, matches as a substring
// Priority is set by ORDER below (first hit wins), so the MORE SPECIFIC intent
// is listed first: RESCHEDULE before BOOKING (both mention "appointment"), and
// AFFIRMATION last (so "ok, book" books rather than merely affirms).

// Exported so an audit script (and the BUILD-NOTES trigger table) can be
// generated FROM the source of truth, never drifting from the live classifier.
export const KEYWORDS = {
  // Change an EXISTING appointment. Must precede BOOKING.
  [INTENTS.RESCHEDULE]: [
    // English
    'reschedule', 'change appointment', 'change my appointment', 'change the appointment',
    'reschedule appointment', 'reschedule my appointment', 'change time', 'change my time',
    'different time', 'another time', 'another day', 'postpone', 'prepone', 'move my appointment',
    'date change',
    // Manglish
    'reschedule cheyyanam', 'reschedule cheyyam', 'time maat', 'time maaty', 'time maathanam',
    'samayam maat', 'appointment maat', 'appointment maaty', 'date maatan',
    // Malayalam
    'റീഷ', 'സമയം മാറ്റ', 'സമയ മാറ്റ', 'സമയമാറ്റ', 'ടൈം മാറ്റ',
    'അപ്പോയിന്റ്മെന്റ് മാറ്റ', 'അപ്പോയിന്റ്മന്റ് മാറ്റ', 'മാറ്റണം', 'മാറ്റണോ', 'മാറ്റിവെക്ക',
  ],

  // Book a NEW appointment / consultation.
  [INTENTS.BOOKING]: [
    // English
    'book', 'booking', 'appointment', 'appointments', 'appt', 'consultation', 'consult',
    'book appointment', 'book a consultation', 'need appointment', 'need consultation',
    'schedule appointment', 'book slot',
    // Manglish
    'appointment venam', 'apointment venam', 'appointment veno', 'book cheyyam', 'book cheyyanam',
    'book tharam', 'consultation venam', 'doctor kaananam', 'doctor venam', 'doctore kaanam',
    // Malayalam
    'ബുക്ക്', 'അപ്പോയിന്റ്മെന്റ്', 'അപ്പോയിന്റ്മന്റ്', 'ബുക്ക് ചെയ്യണം', 'കൺസൾട്ടേഷൻ',
    'ഡോക്ടറെ കാണണം',
  ],

  // Medicine refill / order.
  [INTENTS.MEDICINE]: [
    // English
    'medicine', 'medicines', 'meds', 'refill', 'refil', 'medicine refill', 'medicine order',
    'order medicine', 'refill prescription', 'need medicine',
    // Manglish
    'marunnu', 'marunn', 'marunnu venam', 'marunnu order', 'marunnu orden', 'medicine venam',
    'meds venam', 'tablet venam', 'tablet veno',
    // Malayalam
    'മരുന്ന്', 'മരുന്നു', 'മരന്ന്', 'മരുന്ന് വേണം', 'മരുന്ന് ഓർഡർ', 'മരുന്ന് തീർന്നു',
  ],

  // General question → the 8-row FAQ list. "timing"/"timings" (not bare "time",
  // which collides with RESCHEDULE) plus location / fee / cost / doubt.
  [INTENTS.FAQ]: [
    // English
    'doubt', 'question', 'query', 'timing', 'timings', 'location', 'address', 'fee', 'fees',
    'cost', 'charge', 'charges', 'price', 'how much', 'where is', 'have a doubt', 'have a question',
    'quick question', 'opening hours', 'working hours',
    // Manglish
    'sandham', 'sandheham', 'chodyam', 'doubt undu', 'fee ethra', 'fee evvalavu', 'charge ethra',
    'timing ethu', 'timing engane', 'clinic evide', 'evide aanu',
    // Malayalam
    'സംശയം', 'സംശയ', 'ചോദ്യം', 'ഡൗട്ട്', 'ഫീസ്', 'വില', 'സ്ഥലം', 'എവിടെ', 'സമയം', 'ചെലവ്', 'ടൈമിംഗ്',
  ],

  // Bare confirmation ("yes" / "ok" / "ശരി"). Tested LAST so an affirmative word
  // inside an actionable sentence does not pre-empt the real intent.
  [INTENTS.AFFIRMATION]: [
    // English
    'yes', 'yeah', 'yep', 'yup', 'yess', 'yes please', 'ok', 'okay', 'okey', 'okk', 'sure',
    // Manglish
    'yesu', 'yas', 'sari', 'seri', 'shari', 'adhe', 'athe', 'aah',
    // Malayalam
    'ശരി', 'അതെ', 'ഉവ്വ്', 'ആകാം', 'ഓക്കേ', 'ഓക്കെ',
  ],
};

// Priority order (first matching intent wins).
const ORDER = [
  INTENTS.RESCHEDULE,
  INTENTS.BOOKING,
  INTENTS.MEDICINE,
  INTENTS.FAQ,
  INTENTS.AFFIRMATION,
];

// ── Matching primitives (same approach as stateMachine.js) ───────────────────

/** Lower-case, strip meaningless punctuation, collapse whitespace. Malayalam is
 * preserved. Word-boundary matching then works cleanly on the result. */
function normalise(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[.,!?;:"'(){}\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const isAsciiWord = (w) => /^[a-z0-9']+$/.test(w);

function matchesKeyword(text, keyword) {
  if (isAsciiWord(keyword)) {
    return new RegExp(`\\b${keyword}\\b`).test(text);
  }
  // multi-word phrase or Malayalam token → substring
  return text.includes(keyword);
}

/** A more specific keyword scores higher: a multi-word phrase (0.95) beats a
 * lone Malayalam token (0.9) beats a lone ASCII word (0.85). */
function scoreFor(keyword) {
  if (keyword.includes(' ')) return 0.95;
  return isAsciiWord(keyword) ? 0.85 : 0.9;
}

/**
 * Classify one free-text message into an existing-flow intent.
 * @param {string} text  raw message text (not yet normalised)
 * @returns {{ intent: string, confidence: 'high'|'low', matched: string }}
 *   confidence is 'high' when a trigger fired, 'low' for UNKNOWN. (server.js
 *   routes on `intent`; `confidence` is exposed for future gating and audit.)
 *   The internal specificity score still picks the MOST specific matched
 *   keyword for `matched`, so the audit log names the phrase that actually fired.
 */
export function classifyIntent(text) {
  const s = normalise(text);
  if (!s) return { intent: INTENTS.UNKNOWN, confidence: 'low', matched: '' };

  for (const intent of ORDER) {
    let best = null;
    for (const kw of KEYWORDS[intent]) {
      if (matchesKeyword(s, kw)) {
        const score = scoreFor(kw);
        if (!best || score > best.score) best = { kw, score };
      }
    }
    if (best) return { intent, confidence: 'high', matched: best.kw };
  }

  return { intent: INTENTS.UNKNOWN, confidence: 'low', matched: '' };
}
