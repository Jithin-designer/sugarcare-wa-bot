/**
 * src/stateMachine.js — the deterministic conversation engine.
 *
 * This is a PURE function: no DB, no clock, no network, no console. Given the
 * current conversation row and one incoming message, it returns the next state,
 * the payloads to send, and any side-effect *intentions* (save this lead, go
 * dormant for N ms). server.js turns those intentions into real I/O. Purity is
 * what makes every path in this file unit-testable without a running server.
 *
 * Contract:
 *   processMessage(conversation, incomingMessage)
 *     → { nextState, nextData, replies, leadData, priority, dormantFor,
 *         lang, fallbackCount }
 *
 *   (`lang` and `fallbackCount` are two extra conversation-column values the
 *    server persists — beyond the six documented in the brief — because the
 *    English switch and the fallback counter live in columns, not in data_json.)
 *
 * incomingMessage:
 *   { type:'text'|'interactive', text, buttonId, listId, messageId, from, timestamp }
 */

import {
  IDS,
  INTEREST_IDS,
  clinicFromRowId,
  menu,
  interestList,
  leadClinicList,
  apptClinicList,
  askName,
  leadClose,
  patientMenu,
  apptDay,
  apptClose,
  teamHandoff,
  clinicalHandoff,
  fallbackReprompt,
  fallbackFinal,
  fallbackHandoffNumber,
  welcome,
  bookingClinicList,
  bookingNameBody,
  bookingConfirm,
  qaPrompt,
  qaAnswer,
  qaRedirectPersonal,
  midBookingBriefAnswer,
  closingLoop,
  closingBye,
} from './messages.js';

export const DORMANT_12H_MS = 12 * 60 * 60 * 1000;

export const STATES = Object.freeze({
  MENU: 'MENU',
  LEAD_INTEREST: 'LEAD_INTEREST',
  LEAD_CLINIC: 'LEAD_CLINIC',
  LEAD_NAME: 'LEAD_NAME',
  PATIENT_MENU: 'PATIENT_MENU',
  APPT_CLINIC: 'APPT_CLINIC',
  APPT_DAY: 'APPT_DAY',
  HUMAN_HANDOFF: 'HUMAN_HANDOFF',
  DORMANT: 'DORMANT',

  // Booking-first flow (WELCOME entry point) — see feature/booking-first-flow.
  WELCOME: 'WELCOME',
  CLINIC_SELECT: 'CLINIC_SELECT',
  NAME_CAPTURE: 'NAME_CAPTURE',
  BOOKING_COMPLETE: 'BOOKING_COMPLETE',
  QA_ANSWER: 'QA_ANSWER',
  CLOSING_LOOP: 'CLOSING_LOOP',
});

const TERMINAL = new Set([STATES.HUMAN_HANDOFF, STATES.DORMANT]);

// ── Clinical-question detector (HARD RULE #1) ────────────────────────────────
// These are DETECTION keywords, not reply strings, so they intentionally live
// here and not in messages.js. Bias is toward escalation: a false positive just
// routes a human, which is the safe failure mode for an unlicensed front door.
// Note: plain "diabetes"/"sugar" alone are NOT triggers — the whole clinic is
// about diabetes, and a lead saying "I want diabetes care" must not be escalated.

const CLINICAL_STRONG = [
  'insulin', 'ഇൻസുലിൻ', 'hba1c', 'a1c', 'metformin', 'glimepiride', 'glyciphage',
  'dose', 'dosage', 'ഡോസ്', 'creatinine', 'mg/dl', 'mmol', 'injection',
  'prescription', 'prescribe', 'മരുന്ന്', 'marunnu', 'ഗുളിക', 'tablet',
  'diagnos', 'hypo', 'hyper', 'ketone', 'neuropathy',
];
const CLINICAL_NUMERIC = ['sugar', 'glucose', 'പഞ്ചസാര', 'ഷുഗർ', 'bp', 'pressure', 'reading'];
const CLINICAL_ADVICE = [
  'what should i', 'should i take', 'should i stop', 'is it safe', 'can i take',
  'എന്ത് ചെയ്യണം', 'എന്ത് ചെയ്യും', 'കഴിക്കാമോ', 'കഴിക്കാൻ പറ്റുമോ', 'നിർത്താമോ',
];

export function isClinicalQuestion(text) {
  const s = String(text || '').toLowerCase();
  if (!s) return false;
  // Pure "what is HbA1c" definition questions and generic diet-education
  // phrasings ("what should i eat") are allowed Q&A education topics (see
  // BOOKING-FLOW-CHANGES.md) — carved out BEFORE the broad keywords below,
  // which otherwise (correctly) escalate any hba1c mention / "what should i"
  // phrase. Both carve-outs are narrow whole-phrase allow-lists, not a
  // keyword-minus-a-digit heuristic: "hba1c 9.2 aanu" and "what should i do
  // about my sugar" must keep escalating exactly as before.
  if (isHba1cDefinitionQuestion(s)) return false;
  if (isDietEducationQuestion(s)) return false;
  if (CLINICAL_STRONG.some((k) => s.includes(k))) return true;
  if (/\d/.test(s) && CLINICAL_NUMERIC.some((k) => s.includes(k))) return true;
  if (CLINICAL_ADVICE.some((k) => s.includes(k))) return true;
  return false;
}

const HBA1C_DEFINITION_PHRASES = [
  'what is hba1c', 'what is a1c', 'whats hba1c', "what's hba1c",
  'hba1c means', 'hba1c enthanu', 'hba1c ennal enthanu', 'hba1c aanu enthu',
  'define hba1c', 'meaning of hba1c',
];

// NOTE: "hba1c" itself contains a digit ("1"), so a naive "any digit anywhere
// → not a definition ask" guard would defeat itself on every match. Instead,
// strip the matched phrase out and check for a digit in what's LEFT — that
// catches a real personal reading tacked on ("what is hba1c, mine is 9.2")
// without misfiring on the digit inside "hba1c"/"a1c" itself.
function isHba1cDefinitionQuestion(lowerText) {
  const phrase = HBA1C_DEFINITION_PHRASES.find((p) => lowerText.includes(p));
  if (!phrase) return false;
  const remainder = lowerText.replace(phrase, '');
  return !/\d/.test(remainder);
}

const DIET_EDUCATION_PHRASES = [
  'what should i eat', 'what can i eat', 'what food should i eat',
  'what should i eat for diabetes', 'diet for diabetes', 'diet plan for diabetes',
];

function isDietEducationQuestion(lowerText) {
  const phrase = DIET_EDUCATION_PHRASES.find((p) => lowerText.includes(p));
  if (!phrase) return false;
  const remainder = lowerText.replace(phrase, '');
  return !/\d/.test(remainder); // a number elsewhere in the sentence → treat as personal, not generic education
}

// ── Q&A topic classifier (booking-first flow, secondary path) ───────────────
// Deterministic keyword matching — same pattern as isClinicalQuestion, NOT an
// LLM (this project's founding rule is "no RAG, ever"). The STRONG clinical
// terms (dose, insulin, a numeric sugar/BP reading, "should I take/stop") are
// already caught by isClinicalQuestion above, which runs unconditionally
// before this ever sees the text. But softer "about ME" phrasings without a
// number or a strong keyword ("is my sugar okay", "should I change my
// medicine") do NOT trip that guard — isPersonalMedicalQuestion below is a
// second, QA-scoped detector for exactly those, checked before topic
// classification. Anything neither personal nor topic-matched safely defers
// to a human via qa_redirect_unknown.

// Word-boundary matching for single ASCII words (same technique as
// bannedWords.js's isAscii/\b check) — a plain .includes() on a short word
// like "ask" or "eat" false-positives inside unrelated words ("namaskaram"
// contains "ask", "cheating" would contain "eat"). Multi-word ASCII phrases
// (already space-delimited, so inherently boundary-safe) and Malayalam
// script (whose \b is meaningless — JS word boundaries are ASCII-only, per
// bannedWords.js) both fall back to substring matching.
const isAsciiWord = (w) => /^[a-z0-9']+$/.test(w);
function matchesKeyword(lowerText, keyword) {
  if (isAsciiWord(keyword)) {
    return new RegExp(`\\b${keyword}\\b`).test(lowerText);
  }
  return lowerText.includes(keyword);
}
const matchesAny = (lowerText, keywords) => keywords.some((k) => matchesKeyword(lowerText, k));

const PERSONAL_MEDICAL_PHRASES = [
  'is my sugar okay', 'is my sugar ok', 'is my bp okay', 'is my bp ok',
  'my sugar okay', 'my sugar ok', 'my reading okay', 'my reading ok',
  'change my medicine', 'change my medication', 'change my dose', 'change my tablet',
  'stop my medicine', 'stop my medication', 'stop my tablet',
  'my hba1c', 'my sugar level', 'my sugar is',
  'എന്റെ ഷുഗർ ശരിയാണോ', 'എന്റെ മരുന്ന് മാറ്റണോ',
];

/** A "personal" medical question (about the patient's own readings/meds) that
 * the top-level isClinicalQuestion guard doesn't catch on its own — these must
 * ALSO always defer to a doctor within the Q&A flow, never get a canned
 * educational answer. */
export function isPersonalMedicalQuestion(text) {
  const s = String(text || '').toLowerCase();
  if (!s) return false;
  return matchesAny(s, PERSONAL_MEDICAL_PHRASES);
}

const QA_TOPIC_KEYWORDS = {
  diet: ['diet', 'food', 'ഭക്ഷണം', 'ഡയറ്റ്', 'kazhikkam', 'kazhikkan', 'eat', 'rice', 'chapati', 'ചോറ്'],
  exercise: ['exercise', 'walk', 'walking', 'വ്യായാമം', 'നടത്തം', 'gym', 'yoga'],
  monitoring: ['monitor', 'check cheyyendathu', 'glucometer', 'ഗ്ലൂക്കോമീറ്റർ', 'test cheyyendath', 'how often', 'എത്ര തവണ'],
  hba1c: ['hba1c', 'a1c'], // reached only via the definition carve-out above
};

/** Which allowed Q&A topic (if any) this free text is asking about. */
export function classifyQaTopic(text) {
  const s = String(text || '').toLowerCase();
  if (!s) return null;
  for (const [topic, keywords] of Object.entries(QA_TOPIC_KEYWORDS)) {
    if (matchesAny(s, keywords)) return topic;
  }
  return null;
}

// ── WELCOME free-text intent (Manglish/English understood, no forced Malayalam) ──

const BOOK_INTENT_WORDS = ['book', 'booking', 'appointment', 'appoinment', 'ബുക്ക്', 'അപ്പോയിന്റ്മെന്റ്', 'cheyyam'];
const DOUBT_INTENT_WORDS = ['doubt', 'question', 'സംശയം', 'doubt undu', 'ask'];

function classifyWelcomeIntent(text) {
  const s = String(text || '').toLowerCase();
  if (!s) return null;
  if (matchesAny(s, BOOK_INTENT_WORDS)) return 'book';
  if (matchesAny(s, DOUBT_INTENT_WORDS)) return 'doubt';
  return null;
}

// ── Result helper ────────────────────────────────────────────────────────────

function result({
  nextState,
  data = {},
  replies = [],
  leadData = null,
  priority = false,
  dormantFor = 0,
  lang = 'ml',
  fallbackCount = 0,
}) {
  return {
    nextState,
    nextData: data,
    replies: [].concat(replies),
    leadData,
    priority,
    dormantFor,
    lang,
    fallbackCount,
  };
}

// ── Main entry ───────────────────────────────────────────────────────────────

export function processMessage(conversation, incomingMessage) {
  const conv = conversation || {};
  const lang = conv.lang || 'ml';
  const data = { ...(conv.data || {}) };
  let state = conv.state || STATES.WELCOME;

  // Work on a shallow copy that also carries the current fallback counter, so
  // the fallback handler can read it without a separate parameter and without
  // mutating the caller's message object.
  const message = { ...(incomingMessage || {}), _fallbackCount: conv.fallback_count || 0 };

  const choice = message.buttonId || message.listId || null;
  const text = String(message.text || '').trim();
  const isText = !choice && message.type !== 'interactive';

  // A terminal state means a human already owns the thread; the server normally
  // resets this before we ever see it (after dormancy expires). Defensive reset.
  if (TERMINAL.has(state)) {
    state = STATES.WELCOME;
    data.greeted = false;
  }

  // GUARD (HARD RULE #1): a clinical question typed at ANY point is never
  // answered — it is escalated to a human with PRIORITY.
  if (isText && isClinicalQuestion(text)) {
    return escalateClinical(message, lang);
  }

  switch (state) {
    case STATES.MENU:
      return handleMenu(message, lang, data, choice);
    case STATES.LEAD_INTEREST:
      return handleLeadInterest(message, lang, data, choice);
    case STATES.LEAD_CLINIC:
      return handleLeadClinic(message, lang, data, choice, false);
    case STATES.LEAD_NAME:
      return handleLeadName(message, lang, data, isText, text);
    case STATES.PATIENT_MENU:
      return handlePatientMenu(message, lang, data, choice);
    case STATES.APPT_CLINIC:
      return handleLeadClinic(message, lang, data, choice, true);
    case STATES.APPT_DAY:
      return handleApptDay(message, lang, data, isText, text);
    case STATES.WELCOME:
      return handleWelcome(message, lang, data, choice, isText, text);
    case STATES.CLINIC_SELECT:
      return handleClinicSelect(message, lang, data, choice, isText, text);
    case STATES.NAME_CAPTURE:
      return handleNameCapture(message, lang, data, isText, text);
    case STATES.BOOKING_COMPLETE:
      return handleClosingLoop(message, lang, data, choice);
    case STATES.QA_ANSWER:
      return handleQaAnswer(message, lang, data, choice, isText, text);
    case STATES.CLOSING_LOOP:
      return handleClosingLoop(message, lang, data, choice);
    default:
      // Unknown state → treat as a fresh greeting.
      return greetWelcome(lang, {});
  }
}

// ── State handlers ───────────────────────────────────────────────────────────

function greet(lang, data) {
  return result({
    nextState: STATES.MENU,
    data: { ...data, greeted: true },
    replies: menu(lang),
    lang,
    fallbackCount: 0,
  });
}

function greetWelcome(lang, data) {
  return result({
    nextState: STATES.WELCOME,
    data: { ...data, greeted: true },
    replies: welcome(lang),
    lang,
    fallbackCount: 0,
  });
}

function handleMenu(message, lang, data, choice) {
  // First ever touch — always greet warmly, whatever they sent.
  if (!data.greeted) {
    return greet(lang, data);
  }

  switch (choice) {
    case IDS.BTN_NEW:
      return result({
        nextState: STATES.LEAD_INTEREST,
        data: { ...data },
        replies: interestList(lang),
        lang,
        fallbackCount: 0,
      });
    case IDS.BTN_EXISTING:
      return result({
        nextState: STATES.PATIENT_MENU,
        data: { ...data },
        replies: patientMenu(lang),
        lang,
        fallbackCount: 0,
      });
    case IDS.BTN_ENGLISH:
      // Switch language and re-render the menu in English.
      return result({
        nextState: STATES.MENU,
        data: { ...data, greeted: true },
        replies: menu('en'),
        lang: 'en',
        fallbackCount: 0,
      });
    default:
      return fallback(message, lang);
  }
}

function handleLeadInterest(message, lang, data, choice) {
  if (choice && INTEREST_IDS.has(choice)) {
    data.interest = choice.replace('interest_', '');
    return result({
      nextState: STATES.LEAD_CLINIC,
      data,
      replies: leadClinicList(lang),
      lang,
      fallbackCount: 0,
    });
  }
  return fallback(message, lang);
}

// Shared by LEAD_CLINIC and APPT_CLINIC — the clinic list is identical; only
// the follow-up differs (ask name vs ask day). `isAppt` picks the branch.
function handleLeadClinic(message, lang, data, choice, isAppt) {
  const clinic = choice ? clinicFromRowId(choice) : null;
  if (clinic) {
    data.clinic = clinic.id;
    if (isAppt) {
      return result({
        nextState: STATES.APPT_DAY,
        data,
        replies: apptDay(lang),
        lang,
        fallbackCount: 0,
      });
    }
    return result({
      nextState: STATES.LEAD_NAME,
      data,
      replies: askName(lang),
      lang,
      fallbackCount: 0,
    });
  }
  return fallback(message, lang);
}

function handleLeadName(message, lang, data, isText, text) {
  if (isText && text) {
    data.name = text.slice(0, 120);
    const lead = {
      phone: message.from,
      name: data.name,
      interest: data.interest ?? null,
      clinic: data.clinic ?? null,
      priority: 0,
      lead_type: 'new',
      notes: null,
    };
    return result({
      nextState: STATES.HUMAN_HANDOFF,
      data: {},
      replies: leadClose(lang),
      leadData: lead,
      lang,
      fallbackCount: 0,
      dormantFor: DORMANT_12H_MS,
    });
  }
  return fallback(message, lang);
}

function handlePatientMenu(message, lang, data, choice) {
  switch (choice) {
    case IDS.BTN_APPT:
      return result({
        nextState: STATES.APPT_CLINIC,
        data: { ...data },
        replies: apptClinicList(lang),
        lang,
        fallbackCount: 0,
      });
    case IDS.BTN_REPORT:
    case IDS.BTN_TEAM: {
      // Report/prescription requests and "talk to team" both go to a human,
      // flagged PRIORITY so the team surfaces them first.
      const lead = {
        phone: message.from,
        name: data.name ?? null,
        interest: choice === IDS.BTN_REPORT ? 'report' : 'team',
        clinic: data.clinic ?? null,
        priority: 1,
        lead_type: 'priority',
        notes: `existing patient chose ${choice}`,
      };
      return result({
        nextState: STATES.HUMAN_HANDOFF,
        data: {},
        replies: teamHandoff(lang),
        leadData: lead,
        priority: true,
        lang,
        fallbackCount: 0,
        dormantFor: DORMANT_12H_MS,
      });
    }
    default:
      return fallback(message, lang);
  }
}

function handleApptDay(message, lang, data, isText, text) {
  if (isText && text) {
    data.day = text.slice(0, 80);
    const lead = {
      phone: message.from,
      name: data.name ?? null,
      interest: 'appointment',
      clinic: data.clinic ?? null,
      priority: 0,
      lead_type: 'callback',
      notes: `preferred day: ${data.day}`,
    };
    return result({
      nextState: STATES.DORMANT,
      data: {},
      replies: apptClose(lang),
      leadData: lead,
      lang,
      fallbackCount: 0,
      dormantFor: DORMANT_12H_MS,
    });
  }
  return fallback(message, lang);
}

// ── Booking-first flow (WELCOME entry point, secondary Q&A path) ────────────
//
// WELCOME → CLINIC_SELECT → NAME_CAPTURE → BOOKING_COMPLETE → CLOSING_LOOP
//              ↕ (mid-booking Q&A, then resume)     ↕
//                        QA_ANSWER ("Doubt undu", stand-alone or resumed-into-booking)
//
// `data.resumeState` is the ONLY new conversational-memory field this flow
// needs: when a Q&A question interrupts CLINIC_SELECT or NAME_CAPTURE, we
// stash which step was pending so "answer briefly, then resume" can re-show
// the exact right prompt instead of guessing or restarting booking.

function handleWelcome(message, lang, data, choice, isText, text) {
  if (choice === IDS.BTN_BOOK) {
    return result({
      nextState: STATES.CLINIC_SELECT,
      data: { ...data },
      replies: bookingClinicList(lang),
      lang,
      fallbackCount: 0,
    });
  }
  if (choice === IDS.BTN_DOUBT) {
    return result({
      nextState: STATES.QA_ANSWER,
      data: { ...data },
      replies: qaPrompt(lang),
      lang,
      fallbackCount: 0,
    });
  }
  // Bridge into the pre-existing PATIENT_MENU (report/Rx, talk-to-team priority
  // handoff) — kept fully intact; WELCOME does not reimplement it.
  if (choice === IDS.BTN_TALK_TO_TEAM) {
    return result({
      nextState: STATES.PATIENT_MENU,
      data: { ...data },
      replies: patientMenu(lang),
      lang,
      fallbackCount: 0,
    });
  }

  // Manglish/English typed intent understood without forcing a button tap.
  if (isText && text) {
    const intent = classifyWelcomeIntent(text);
    if (intent === 'book') {
      return result({
        nextState: STATES.CLINIC_SELECT,
        data: { ...data },
        replies: bookingClinicList(lang),
        lang,
        fallbackCount: 0,
      });
    }
    if (intent === 'doubt') {
      return result({
        nextState: STATES.QA_ANSWER,
        data: { ...data },
        replies: qaPrompt(lang),
        lang,
        fallbackCount: 0,
      });
    }
  }

  // First-ever touch (no data yet) always greets, whatever was sent — matches
  // the original MENU behaviour. Anything else unrecognised → fallback.
  if (!data.greeted) {
    return greetWelcome(lang, data);
  }
  return fallback(message, lang);
}

/** Mid-booking interception shared by CLINIC_SELECT and NAME_CAPTURE: a
 * personal-medical question always defers to the doctor; a recognised
 * educational topic gets a brief canned answer; either way booking resumes
 * at the exact step it paused (`pendingPayloads`), never restarted. Returns
 * null if `text` isn't a question at all, so the caller falls through to its
 * normal fallback/garbage-input handling. */
function midBookingIntercept(lang, data, text, pendingState, pendingPayloads) {
  const topic = isPersonalMedicalQuestion(text) ? 'personal' : classifyQaTopic(text);
  if (!topic) return null;

  return result({
    nextState: pendingState,
    data: { ...data, resumeState: pendingState },
    replies: midBookingBriefAnswer(lang, topic, pendingPayloads),
    lang,
    fallbackCount: 0,
  });
}

function handleClinicSelect(message, lang, data, choice, isText, text) {
  const clinic = choice ? clinicFromRowId(choice) : null;
  if (clinic) {
    data.clinic = clinic.id;
    return result({
      nextState: STATES.NAME_CAPTURE,
      data,
      replies: bookingNameBody(lang),
      lang,
      fallbackCount: 0,
    });
  }
  if (isText && text) {
    const intercepted = midBookingIntercept(lang, data, text, STATES.CLINIC_SELECT, bookingClinicList(lang));
    if (intercepted) return intercepted;
  }
  return fallback(message, lang);
}

function handleNameCapture(message, lang, data, isText, text) {
  // A name never matches isPersonalMedicalQuestion/classifyQaTopic (those
  // keyword lists are diet/exercise/monitoring/medicine phrases, not
  // name-shaped text), so a plain name always falls through to booking here.
  if (isText && text) {
    const intercepted = midBookingIntercept(lang, data, text, STATES.NAME_CAPTURE, bookingNameBody(lang));
    if (intercepted) return intercepted;

    data.name = text.slice(0, 120);
    const lead = {
      phone: message.from,
      name: data.name,
      interest: 'booking',
      clinic: data.clinic ?? null,
      priority: 0,
      lead_type: 'booking',
      notes: null,
    };
    return result({
      nextState: STATES.BOOKING_COMPLETE,
      data: { clinic: data.clinic, name: data.name },
      replies: [bookingConfirm(lang, data.name, data.clinic), closingLoop(lang)],
      leadData: lead,
      lang,
      fallbackCount: 0,
    });
  }
  return fallback(message, lang);
}

function handleQaAnswer(message, lang, data, choice, isText, text) {
  if (choice === IDS.BTN_BOOK) {
    // "Do not restart the welcome" — jump straight into CLINIC_SELECT.
    return result({
      nextState: STATES.CLINIC_SELECT,
      data: { ...data },
      replies: bookingClinicList(lang),
      lang,
      fallbackCount: 0,
    });
  }
  if (choice === IDS.BTN_DOUBT) {
    return result({
      nextState: STATES.QA_ANSWER,
      data: { ...data },
      replies: qaPrompt(lang),
      lang,
      fallbackCount: 0,
    });
  }
  if (isText && text) {
    const replies = isPersonalMedicalQuestion(text)
      ? qaRedirectPersonal(lang)
      : qaAnswer(lang, classifyQaTopic(text));
    return result({
      nextState: STATES.QA_ANSWER,
      data: { ...data },
      replies,
      lang,
      fallbackCount: 0,
    });
  }
  return fallback(message, lang);
}

function handleClosingLoop(message, lang, data, choice) {
  if (choice === IDS.BTN_CLOSING_YES) {
    return greetWelcome(lang, { ...data, greeted: true });
  }
  if (choice === IDS.BTN_CLOSING_NO) {
    return result({
      nextState: STATES.DORMANT,
      data: {},
      replies: closingBye(lang),
      lang,
      fallbackCount: 0,
      dormantFor: DORMANT_12H_MS,
    });
  }
  return fallback(message, lang);
}

// ── Cross-cutting outcomes ───────────────────────────────────────────────────

function escalateClinical(message, lang) {
  // Intentionally does NOT store the raw clinical text (DPDP data-minimisation).
  const lead = {
    phone: message.from,
    name: null,
    interest: 'clinical',
    clinic: null,
    priority: 1,
    lead_type: 'clinical',
    notes: 'clinical question — auto-escalated to team',
  };
  return result({
    nextState: STATES.HUMAN_HANDOFF,
    data: {},
    replies: clinicalHandoff(lang),
    leadData: lead,
    priority: true,
    lang,
    fallbackCount: 0,
    dormantFor: DORMANT_12H_MS,
  });
}

function fallback(message, lang) {
  const prev = Number(message?._fallbackCount ?? 0);
  const next = prev + 1;

  if (next >= 2) {
    // Second miss — stop looping, hand to a human, go dormant. Includes the
    // team phone number directly (safety rule: garbage input twice → handoff
    // number + human handoff flag).
    const lead = {
      phone: message.from,
      name: null,
      interest: null,
      clinic: null,
      priority: 0,
      lead_type: 'fallback',
      notes: 'unrecognised input twice — handed to team',
    };
    return result({
      nextState: STATES.HUMAN_HANDOFF,
      data: {},
      replies: [fallbackFinal(lang), fallbackHandoffNumber(lang)],
      leadData: lead,
      lang,
      fallbackCount: 0,
      dormantFor: DORMANT_12H_MS,
    });
  }

  // First miss — apologise and re-show the WELCOME buttons (booking-first flow).
  return result({
    nextState: STATES.WELCOME,
    data: { greeted: true },
    replies: [fallbackReprompt(lang)[0], welcome(lang)],
    lang,
    fallbackCount: next,
  });
}
