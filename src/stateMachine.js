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
  if (CLINICAL_STRONG.some((k) => s.includes(k))) return true;
  if (/\d/.test(s) && CLINICAL_NUMERIC.some((k) => s.includes(k))) return true;
  if (CLINICAL_ADVICE.some((k) => s.includes(k))) return true;
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
  let state = conv.state || STATES.MENU;

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
    state = STATES.MENU;
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
    default:
      // Unknown state → treat as a fresh greeting.
      return greet(lang, {});
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
    // Second miss — stop looping, hand to a human, go dormant.
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
      replies: fallbackFinal(lang),
      leadData: lead,
      lang,
      fallbackCount: 0,
      dormantFor: DORMANT_12H_MS,
    });
  }

  // First miss — apologise and re-show the main menu.
  return result({
    nextState: STATES.MENU,
    data: { greeted: true },
    replies: fallbackReprompt(lang),
    lang,
    fallbackCount: next,
  });
}
