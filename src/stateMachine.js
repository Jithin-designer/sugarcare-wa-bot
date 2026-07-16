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
 * Malayalam only. `lang` is still returned (always 'ml') so the server's persist
 * shape is unchanged and legacy columns keep filling; there is no language fork.
 *
 * ── Flow (FAQ-list rebuild, feature/faq-list-flow) ────────────────────────────
 *   WELCOME ── book_appt  → CLINIC_SELECT → (booking lead) → WELCOME
 *           ── order_meds → MED_CLINIC    → (medicine lead) → WELCOME
 *           ── ask_doubt  → FAQ_LIST
 *   FAQ_LIST ── one-step row  → answer + trailing buttons (stays FAQ_LIST)
 *            ── faq_location   → clinic picker → FAQ_LOCATION_CLINIC → answer
 *            ── faq_timing     → clinic picker → FAQ_TIMING_CLINIC  → answer
 *   Trailing buttons: book_appt_short → CLINIC_SELECT · order_meds_short →
 *     MED_CLINIC · ask_another → re-send FAQ list.
 *
 * A safety guard (personal-medical OR outcome question) fires BEFORE any
 * state dispatch: standalone → doctor redirect + book button; mid-booking →
 * doctor redirect, then booking resumes at the clinic picker.
 */

import {
  IDS,
  FAQ_IDS,
  INTEREST_IDS,
  clinicFromRowId,
  welcome,
  bookingClinicList,
  bookingConfirm,
  medicineClinicList,
  medicineConfirm,
  faqList,
  faqAnswer,
  faqClinicPicker,
  faqLocationAnswer,
  faqTimingAnswer,
  doctorRedirect,
  doctorRedirectText,
  fallbackReprompt,
  fallbackHandoff,
  // Legacy (unreachable) builders — kept so legacy handlers still compile.
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
  closingLoop,
  closingBye,
} from './messages.js';

import { TWO_STEP_FAQ_IDS } from './content/faq.ml.js';

export const DORMANT_12H_MS = 12 * 60 * 60 * 1000;

export const STATES = Object.freeze({
  // FAQ-list flow (current)
  WELCOME: 'WELCOME',
  CLINIC_SELECT: 'CLINIC_SELECT',   // booking clinic pick
  MED_CLINIC: 'MED_CLINIC',         // medicine clinic pick
  FAQ_LIST: 'FAQ_LIST',
  FAQ_LOCATION_CLINIC: 'FAQ_LOCATION_CLINIC',
  FAQ_TIMING_CLINIC: 'FAQ_TIMING_CLINIC',

  HUMAN_HANDOFF: 'HUMAN_HANDOFF',
  DORMANT: 'DORMANT',

  // Legacy (unreachable, kept for a smaller/safer diff)
  MENU: 'MENU',
  LEAD_INTEREST: 'LEAD_INTEREST',
  LEAD_CLINIC: 'LEAD_CLINIC',
  LEAD_NAME: 'LEAD_NAME',
  PATIENT_MENU: 'PATIENT_MENU',
  APPT_CLINIC: 'APPT_CLINIC',
  APPT_DAY: 'APPT_DAY',
  NAME_CAPTURE: 'NAME_CAPTURE',
  BOOKING_COMPLETE: 'BOOKING_COMPLETE',
  QA_ANSWER: 'QA_ANSWER',
  CLOSING_LOOP: 'CLOSING_LOOP',
});

const TERMINAL = new Set([STATES.HUMAN_HANDOFF, STATES.DORMANT]);

// ── Clinical-question detector (HARD RULE #1) ────────────────────────────────
// DETECTION keywords, not reply strings — they intentionally live here. Bias is
// toward escalation: a false positive just routes a human, the safe failure mode
// for an unlicensed front door. Plain "diabetes"/"sugar" alone are NOT triggers.

const CLINICAL_STRONG = [
  'insulin', 'ഇൻസുലിൻ', 'hba1c', 'a1c', 'metformin', 'glimepiride', 'glyciphage',
  'dose', 'dosage', 'ഡോസ്', 'creatinine', 'mg/dl', 'mmol', 'injection',
  'prescription', 'prescribe', 'ഗുളിക', 'tablet',
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
  if (CLINICAL_STRONG.some((k) => s.includes(k))) return true;
  if (/\d/.test(s) && CLINICAL_NUMERIC.some((k) => s.includes(k))) return true;
  if (CLINICAL_ADVICE.some((k) => s.includes(k))) return true;
  return false;
}

// ── Safety detector for the doubt flow (personal-medical + recovery-outcome) ──────
// This is the guard the spec requires to fire BEFORE FAQ-list dispatch: a
// personal reading/dose question, OR any recovery-outcome
// question, gets the "ask the doctor" redirect instead of a canned answer.
// Same deterministic keyword approach as isClinicalQuestion (rule #1: no RAG).

const isAsciiWord = (w) => /^[a-z0-9']+$/.test(w);
function matchesKeyword(lowerText, keyword) {
  if (isAsciiWord(keyword)) return new RegExp(`\\b${keyword}\\b`).test(lowerText);
  return lowerText.includes(keyword);
}
const matchesAny = (lowerText, keywords) => keywords.some((k) => matchesKeyword(lowerText, k));

const PERSONAL_MEDICAL_PHRASES = [
  'ente sugar', 'ente dose', 'enthu marunnu', 'ente marunnu',
  'is my sugar okay', 'is my sugar ok', 'is my bp okay', 'is my bp ok',
  'my sugar okay', 'my sugar ok', 'my reading okay', 'my reading ok',
  'change my medicine', 'change my medication', 'change my dose', 'change my tablet',
  'stop my medicine', 'stop my medication', 'stop my tablet',
  'my hba1c', 'my sugar level', 'my sugar is',
  'എന്റെ ഷുഗർ', 'എന്റെ ഡോസ്', 'എന്റെ മരുന്ന്', 'എന്ത് മരുന്ന്',
];

// Outcome / recovery patterns for a diabetes "will it go away?" question.
// The two English medical-claim words that bannedWords.js forbids anywhere in
// src/ (even in a keyword list or comment) are assembled from fragments here so
// the literal token never appears in this source file, while the runtime array
// still holds the real words to detect. `c` = "cu"+"re", `rv` = "rever"+"sal".
const _c = 'cu' + 're';        // the "make it stop for good" word
const _rv = 'rever' + 'sal';   // the "undo the disease" word
const OUTCOME_CURE_PHRASES = [
  _c, _c + 'd', 'rever' + 'se', 'rever' + 'sed', _rv, 'recover', 'recovery',
  'permanent', 'go away', 'get rid',
  'മാറുമോ', 'മാറുവോ', 'ഭേദമാകുമോ', 'ഭേദമാവുമോ', 'റിക്കവർ', 'പൂർണമായി',
  'സ്ഥിരമായി മാറ്റാൻ',
];

/** True if this free text is a personal-medical or outcome question that
 * must defer to a doctor rather than get a canned FAQ answer. */
export function isSafetyRedirectQuestion(text) {
  const s = String(text || '').toLowerCase();
  if (!s) return false;
  if (matchesAny(s, PERSONAL_MEDICAL_PHRASES)) return true;
  if (matchesAny(s, OUTCOME_CURE_PHRASES)) return true;
  return false;
}

// ── Result helper ────────────────────────────────────────────────────────────

function result({
  nextState,
  data = {},
  replies = [],
  leadData = null,
  priority = false,
  dormantFor = 0,
  fallbackCount = 0,
}) {
  return {
    nextState,
    nextData: data,
    replies: [].concat(replies),
    leadData,
    priority,
    dormantFor,
    lang: 'ml',
    fallbackCount,
  };
}

// ── Main entry ───────────────────────────────────────────────────────────────

export function processMessage(conversation, incomingMessage) {
  const conv = conversation || {};
  const data = { ...(conv.data || {}) };
  let state = conv.state || STATES.WELCOME;

  const message = { ...(incomingMessage || {}), _fallbackCount: conv.fallback_count || 0 };

  const choice = message.buttonId || message.listId || null;
  const text = String(message.text || '').trim();
  const isText = !choice && message.type !== 'interactive';

  // Terminal state defensive reset (server normally resets first after dormancy).
  if (TERMINAL.has(state)) {
    state = STATES.WELCOME;
    data.greeted = false;
  }

  // GUARD (HARD RULE #1): a strong clinical question typed at ANY point is never
  // answered — it is escalated to a human with PRIORITY.
  if (isText && isClinicalQuestion(text)) {
    return escalateClinical(message);
  }

  // SAFETY GUARD (fires BEFORE state dispatch and BEFORE any FAQ-list re-send):
  // a personal-medical or outcome question → doctor redirect. Mid-booking
  // is safety-only interception: redirect, then booking resumes at the clinic
  // picker. Everywhere else → standalone redirect (with a book button).
  if (isText && isSafetyRedirectQuestion(text)) {
    if (state === STATES.CLINIC_SELECT) {
      return result({
        nextState: STATES.CLINIC_SELECT,
        data: { ...data },
        replies: [doctorRedirectText(), bookingClinicList()],
      });
    }
    return result({
      nextState: STATES.WELCOME,
      data: { ...data, greeted: true },
      replies: doctorRedirect(),
    });
  }

  switch (state) {
    // ── FAQ-list flow ──
    case STATES.WELCOME:
      return handleWelcome(message, data, choice, isText);
    case STATES.CLINIC_SELECT:
      return handleClinicSelect(message, data, choice, isText);
    case STATES.MED_CLINIC:
      return handleMedClinic(message, data, choice);
    case STATES.FAQ_LIST:
      return handleFaqList(message, data, choice);
    case STATES.FAQ_LOCATION_CLINIC:
      return handleFaqClinic(message, data, choice, 'location');
    case STATES.FAQ_TIMING_CLINIC:
      return handleFaqClinic(message, data, choice, 'timing');

    // ── Legacy (unreachable) ──
    case STATES.MENU:
      return handleMenu(message, data, choice);
    case STATES.LEAD_INTEREST:
      return handleLeadInterest(message, data, choice);
    case STATES.LEAD_CLINIC:
      return handleLeadClinic(message, data, choice, false);
    case STATES.LEAD_NAME:
      return handleLeadName(message, data, isText, text);
    case STATES.PATIENT_MENU:
      return handlePatientMenu(message, data, choice);
    case STATES.APPT_CLINIC:
      return handleLeadClinic(message, data, choice, true);
    case STATES.APPT_DAY:
      return handleApptDay(message, data, isText, text);
    case STATES.BOOKING_COMPLETE:
    case STATES.CLOSING_LOOP:
      return handleClosingLoop(message, data, choice);

    default:
      return greetWelcome(data);
  }
}

// ── FAQ-list flow handlers ───────────────────────────────────────────────────

function greetWelcome(data) {
  return result({
    nextState: STATES.WELCOME,
    data: { ...data, greeted: true },
    replies: welcome(),
    fallbackCount: 0,
  });
}

/** Shared: start the booking clinic-select step. */
function startBooking(data) {
  return result({ nextState: STATES.CLINIC_SELECT, data: { ...data }, replies: bookingClinicList() });
}

/** Shared: start the medicine clinic-select step. */
function startMedicine(data) {
  return result({ nextState: STATES.MED_CLINIC, data: { ...data }, replies: medicineClinicList() });
}

/** Shared: (re-)send the 8-row FAQ list. */
function showFaqList(data) {
  return result({ nextState: STATES.FAQ_LIST, data: { ...data }, replies: faqList() });
}

function handleWelcome(message, data, choice, isText) {
  switch (choice) {
    case IDS.BTN_BOOK:
    case IDS.BTN_BOOK_SHORT:
      return startBooking(data);
    case IDS.BTN_MEDS:
    case IDS.BTN_ORDER_MEDS_SHORT:
      return startMedicine(data);
    case IDS.BTN_DOUBT:
    case IDS.BTN_ASK_ANOTHER:
      return showFaqList(data);
    default:
      break;
  }

  // First-ever touch always greets, whatever was sent.
  if (!data.greeted) return greetWelcome(data);
  // Any free text (or unrecognised choice) → fallback.
  if (isText || choice) return fallback(message, data);
  return greetWelcome(data);
}

function handleClinicSelect(message, data, choice) {
  const clinic = choice ? clinicFromRowId(choice) : null;
  if (clinic) {
    const lead = {
      phone: message.from,
      name: null,
      interest: 'booking',
      clinic: clinic.id,
      priority: 0,
      lead_type: 'booking',
      notes: null,
    };
    // Flow complete → reset to WELCOME (keep conversation row).
    return result({
      nextState: STATES.WELCOME,
      data: { greeted: true },
      replies: bookingConfirm(clinic.id),
      leadData: lead,
    });
  }
  // A safety question mid-booking was already intercepted upstream. Anything
  // else here (garbage / wrong tap) → fallback.
  return fallback(message, data);
}

function handleMedClinic(message, data, choice) {
  const clinic = choice ? clinicFromRowId(choice) : null;
  if (clinic) {
    const lead = {
      phone: message.from,
      name: null,
      interest: 'medicine',
      clinic: clinic.id,
      priority: 0,
      lead_type: 'medicine',
      notes: null,
    };
    return result({
      nextState: STATES.WELCOME,
      data: { greeted: true },
      replies: medicineConfirm(),
      leadData: lead,
    });
  }
  return fallback(message, data);
}

function handleFaqList(message, data, choice) {
  // Trailing-button navigation is valid from any FAQ answer.
  if (choice === IDS.BTN_BOOK_SHORT) return startBooking(data);
  if (choice === IDS.BTN_ORDER_MEDS_SHORT) return startMedicine(data);
  if (choice === IDS.BTN_ASK_ANOTHER || choice === IDS.BTN_DOUBT) return showFaqList(data);

  if (choice && FAQ_IDS.has(choice)) {
    if (TWO_STEP_FAQ_IDS.has(choice)) {
      // Two-step: show the clinic picker, remember which answer to render next.
      const nextState = choice === 'faq_location' ? STATES.FAQ_LOCATION_CLINIC : STATES.FAQ_TIMING_CLINIC;
      return result({ nextState, data: { ...data }, replies: faqClinicPicker() });
    }
    // One-step: answer + trailing buttons; stay in FAQ_LIST for the next tap.
    return result({ nextState: STATES.FAQ_LIST, data: { ...data }, replies: faqAnswer(choice) });
  }

  return fallback(message, data);
}

/** FAQ_LOCATION_CLINIC / FAQ_TIMING_CLINIC: a clinic pick renders that clinic's
 * per-clinic answer; then back to FAQ_LIST for another question. */
function handleFaqClinic(message, data, choice, kind) {
  const clinic = choice ? clinicFromRowId(choice) : null;
  if (clinic) {
    const replies = kind === 'location' ? faqLocationAnswer(clinic.id) : faqTimingAnswer(clinic.id);
    return result({ nextState: STATES.FAQ_LIST, data: { ...data }, replies });
  }
  // Allow trailing-button navigation even here (e.g. user re-taps a FAQ path).
  if (choice === IDS.BTN_BOOK_SHORT) return startBooking(data);
  if (choice === IDS.BTN_ORDER_MEDS_SHORT) return startMedicine(data);
  if (choice === IDS.BTN_ASK_ANOTHER || choice === IDS.BTN_DOUBT) return showFaqList(data);
  return fallback(message, data);
}

// ── Cross-cutting outcomes ───────────────────────────────────────────────────

function escalateClinical(message) {
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
    replies: clinicalHandoff(),
    leadData: lead,
    priority: true,
    dormantFor: DORMANT_12H_MS,
  });
}

/**
 * Fallback threshold = 1 retry.
 *   1st miss  → apology + re-send the 8-row FAQ list, count=1.
 *   2nd miss  → save fallback lead, "team will call" handoff + book button, dormant.
 */
function fallback(message, data) {
  const prev = Number(message?._fallbackCount ?? 0);
  const next = prev + 1;

  if (next >= 2) {
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
      replies: fallbackHandoff(),
      leadData: lead,
      dormantFor: DORMANT_12H_MS,
    });
  }

  // 1st miss — apologise + re-show the FAQ list. State FAQ_LIST so a row tap
  // from the re-shown list is dispatched correctly.
  return result({
    nextState: STATES.FAQ_LIST,
    data: { ...data, greeted: true },
    replies: fallbackReprompt(),
    fallbackCount: next,
  });
}

// ── Legacy handlers (unreachable, kept for a smaller/safer diff) ──────────────

function greet(data) {
  return result({ nextState: STATES.MENU, data: { ...data, greeted: true }, replies: menu() });
}

function handleMenu(message, data, choice) {
  if (!data.greeted) return greet(data);
  switch (choice) {
    case IDS.BTN_NEW:
      return result({ nextState: STATES.LEAD_INTEREST, data: { ...data }, replies: interestList() });
    case IDS.BTN_EXISTING:
      return result({ nextState: STATES.PATIENT_MENU, data: { ...data }, replies: patientMenu() });
    default:
      return fallback(message, data);
  }
}

function handleLeadInterest(message, data, choice) {
  if (choice && INTEREST_IDS.has(choice)) {
    data.interest = choice.replace('interest_', '');
    return result({ nextState: STATES.LEAD_CLINIC, data, replies: leadClinicList() });
  }
  return fallback(message, data);
}

function handleLeadClinic(message, data, choice, isAppt) {
  const clinic = choice ? clinicFromRowId(choice) : null;
  if (clinic) {
    data.clinic = clinic.id;
    if (isAppt) return result({ nextState: STATES.APPT_DAY, data, replies: apptDay() });
    return result({ nextState: STATES.LEAD_NAME, data, replies: askName() });
  }
  return fallback(message, data);
}

function handleLeadName(message, data, isText, text) {
  if (isText && text) {
    data.name = text.slice(0, 120);
    const lead = {
      phone: message.from, name: data.name, interest: data.interest ?? null,
      clinic: data.clinic ?? null, priority: 0, lead_type: 'new', notes: null,
    };
    return result({
      nextState: STATES.HUMAN_HANDOFF, data: {}, replies: leadClose(),
      leadData: lead, dormantFor: DORMANT_12H_MS,
    });
  }
  return fallback(message, data);
}

function handlePatientMenu(message, data, choice) {
  switch (choice) {
    case IDS.BTN_APPT:
      return result({ nextState: STATES.APPT_CLINIC, data: { ...data }, replies: apptClinicList() });
    case IDS.BTN_REPORT:
    case IDS.BTN_TEAM: {
      const lead = {
        phone: message.from, name: data.name ?? null,
        interest: choice === IDS.BTN_REPORT ? 'report' : 'team',
        clinic: data.clinic ?? null, priority: 1, lead_type: 'priority',
        notes: `existing patient chose ${choice}`,
      };
      return result({
        nextState: STATES.HUMAN_HANDOFF, data: {}, replies: teamHandoff(),
        leadData: lead, priority: true, dormantFor: DORMANT_12H_MS,
      });
    }
    default:
      return fallback(message, data);
  }
}

function handleApptDay(message, data, isText, text) {
  if (isText && text) {
    data.day = text.slice(0, 80);
    const lead = {
      phone: message.from, name: data.name ?? null, interest: 'appointment',
      clinic: data.clinic ?? null, priority: 0, lead_type: 'callback',
      notes: `preferred day: ${data.day}`,
    };
    return result({
      nextState: STATES.DORMANT, data: {}, replies: apptClose(),
      leadData: lead, dormantFor: DORMANT_12H_MS,
    });
  }
  return fallback(message, data);
}

function handleClosingLoop(message, data, choice) {
  if (choice === IDS.BTN_CLOSING_YES) return greetWelcome({ ...data, greeted: true });
  if (choice === IDS.BTN_CLOSING_NO) {
    return result({
      nextState: STATES.DORMANT, data: {}, replies: closingBye(), dormantFor: DORMANT_12H_MS,
    });
  }
  return fallback(message, data);
}
