/**
 * src/messages.js — EVERY user-facing string (Malayalam only) and every
 * WhatsApp payload builder. Nothing else in the codebase contains an inline
 * reply string; stateMachine.js only calls the builders exported here.
 *
 * Two reasons for this hard boundary:
 *   1. The banned-word scan (bannedWords.test.js) only has to audit one file
 *      of strings, not hunt through logic.
 *   2. Copy edits happen in one place — a receptionist can be handed this file
 *      (and src/content/faq.ml.js) without touching the state machine.
 *
 * Language: Malayalam only. The old English switch was removed in the FAQ-list
 * rebuild (feature/faq-list-flow); `lang` no longer exists as a concept. Legacy
 * builders (menu/interestList/patientMenu/appt*) are kept intact but unreachable
 * so the legacy state handlers still compile; they read the same ML table.
 *
 * Register: everyday spoken Malappuram, the way a clinic receptionist actually
 * texts on WhatsApp — code-mixed with English words, warm, short.
 */

import {
  FAQ_ROWS,
  FAQ_LIST_TITLE,
  FAQ_LIST_INTRO,
  FAQ_ANSWERS,
  FAQ_LOCATION,
  FAQ_TIMING,
  TIMING_FOOTER,
} from './content/faq.ml.js';

// ── Contact + call line ──────────────────────────────────────────────────────

export const TEAM_PHONE = '+91 79948 84799';

/**
 * Appended to EVERY reply that resolves an intent (all FAQ answers, booking +
 * medicine confirmations, the doctor redirect, the fallback handoff). NOT
 * appended to the welcome menu, the doubt-list prompt, or the clinic-picker
 * prompt — those are mid-flow and carry no resolved CTA yet.
 */
export const CALL_LINE = '\n📞 ക്ലിനിക്കിലേക്കു വിളിക്കൂ: +91 79948 84799';

/** Append CALL_LINE to a plain string (used by every resolving-reply builder). */
const withCall = (body) => `${body}${CALL_LINE}`;

// ── Clinics ──────────────────────────────────────────────────────────────────

// The 7 SugarCARE clinics — used across booking, medicine, and the two-step
// location/timing FAQs. Order here is the order rows appear in every picker.
export const CLINICS = [
  { id: 'padinjarangadi', ml: 'പടിഞ്ഞാറങ്ങാടി' },
  { id: 'edappal', ml: 'എടപ്പാൾ' },
  { id: 'chemmad', ml: 'ചെമ്മാട്' },
  { id: 'areekode', ml: 'അരീക്കോട്' },
  { id: 'kondotty', ml: 'കൊണ്ടോട്ടി' },
  { id: 'punnayurkulam', ml: 'പുന്നയൂർക്കുളം' },
  { id: 'kanjirathani', ml: 'കാഞ്ഞിരത്താണി' },
];

export const clinicRowId = (id) => `clinic_${id}`;
export const clinicById = (id) => CLINICS.find((c) => c.id === id) || null;
export const clinicFromRowId = (rowId) =>
  CLINICS.find((c) => clinicRowId(c.id) === rowId) || null;
export const clinicLabel = (id) => {
  const c = clinicById(id);
  return c ? c.ml : '';
};

// ── Stable ids (identifiers, not user-facing text) ───────────────────────────

export const IDS = {
  // Legacy (unreachable, kept so legacy handlers compile)
  BTN_NEW: 'btn_new',
  BTN_EXISTING: 'btn_existing',
  BTN_ENGLISH: 'btn_english',
  INTEREST_DIABETES: 'interest_diabetes',
  INTEREST_BPCHOL: 'interest_bpcholesterol',
  INTEREST_CGM: 'interest_cgm',
  INTEREST_PRICE: 'interest_price',
  BTN_APPT: 'btn_appt',
  BTN_REPORT: 'btn_report',
  BTN_TEAM: 'btn_team',
  BTN_TALK_TO_TEAM: 'btn_talk_to_team',

  // WELCOME (3-row list)
  BTN_BOOK: 'book_appt',
  BTN_DOUBT: 'ask_doubt',
  BTN_MEDS: 'order_meds',

  // FAQ answer trailing buttons
  BTN_BOOK_SHORT: 'book_appt_short',
  BTN_ORDER_MEDS_SHORT: 'order_meds_short',
  BTN_ASK_ANOTHER: 'ask_another',

  // Closing loop (legacy booking-first, kept for BOOKING_COMPLETE path)
  BTN_CLOSING_YES: 'btn_closing_yes',
  BTN_CLOSING_NO: 'btn_closing_no',
};

export const INTEREST_IDS = new Set([
  IDS.INTEREST_DIABETES,
  IDS.INTEREST_BPCHOL,
  IDS.INTEREST_CGM,
  IDS.INTEREST_PRICE,
]);

// FAQ row ids the state machine dispatches on.
export const FAQ_IDS = new Set(FAQ_ROWS.map((r) => r.id));

// ── String table (Malayalam only) ────────────────────────────────────────────

const ML = {
  // Legacy MENU branch (unreachable)
  menu_greeting:
    'നമസ്കാരം! 🙏 SugarCARE Clinics-ലേക്ക് സ്വാഗതം. ഞാൻ ഇവിടത്തെ അസിസ്റ്റന്റ് ആണ്. എന്താ വേണ്ടേ? താഴെ ഒന്ന് തിരഞ്ഞെടുക്കൂ 👇',
  btn_new: 'പുതിയ രോഗി',
  btn_existing: 'നിലവിലെ രോഗി',
  btn_english: 'English',
  lead_interest_body: 'എന്ത് കാര്യത്തിനാ? താഴെ നിന്ന് ഒന്ന് തിരഞ്ഞെടുക്കൂ 👇',
  interest_diabetes: 'പ്രമേഹ ചികിത്സ',
  interest_bpcholesterol: 'BP / കൊളസ്ട്രോൾ',
  interest_cgm: 'CGM സെൻസർ',
  interest_price: 'ഫീ അറിയണം',
  clinic_body: 'ഏത് ക്ലിനിക് ആണ് അടുത്തുള്ളത്? താഴെ നിന്ന് തിരഞ്ഞെടുക്കൂ 👇',
  clinic_button: 'ക്ലിനിക് തിരഞ്ഞെടുക്കൂ',
  clinic_section: 'SugarCARE ക്ലിനിക്കുകൾ',
  lead_name_body: 'നിങ്ങളുടെ പേര് ഒന്ന് പറയാമോ? 🙂',
  lead_close: `ഞങ്ങളുടെ ടീം ഉടൻ വിളിക്കും 🙏 നേരിട്ട് വിളിക്കാൻ: ${TEAM_PHONE}`,
  patient_menu_body: 'വീണ്ടും സ്വാഗതം! 😊 എന്ത് സഹായമാ വേണ്ടേ?',
  btn_appt: 'അപ്പോ. ബുക്ക്',
  btn_report: 'റിപ്പോർട്ട്/Rx',
  btn_team: 'ടീം',
  appt_clinic_body: 'ഏത് ക്ലിനിക്കിൽ ആണ് അപ്പോയിന്റ്മെന്റ് വേണ്ടത്? 👇',
  appt_day_body: 'ഏത് ദിവസം? ഉദാ: ചൊവ്വ, ബുധൻ',
  appt_close: 'ശരി, ഞങ്ങൾ confirm ചെയ്ത് വിളിക്കാം 🙏',
  team_handoff: `ടീം 9am–6pm-ക്ക് ഉള്ളിൽ reply ചെയ്യും. Urgent ആണെങ്കിൽ: ${TEAM_PHONE}`,
  clinical_handoff: `ഇത് ഡോക്ടറോട് നേരിട്ട് ചോദിക്കേണ്ട കാര്യമാ 🙏 ഞങ്ങളുടെ ടീം ഉടൻ വിളിക്കും. Urgent ആണെങ്കിൽ: ${TEAM_PHONE}`,

  // ── WELCOME (3-row list) ──────────────────────────────────────────────────
  welcome_greeting:
    'നമസ്കാരം! 🙏 SugarCARE Clinics-ലേക്ക് സ്വാഗതം. ഞാൻ എങ്ങനെയാണ് നിങ്ങളെ സഹായിക്കേണ്ടത്?',
  // WhatsApp list-row titles ≤ 24 code points. Full phrasing lives in the row
  // description (welcome_*_desc); these are the short scannable titles.
  welcome_book: '📅 ബുക്ക് ചെയ്യാം',
  welcome_doubt: '❓ സംശയങ്ങൾ',
  welcome_meds: '💊 മരുന്ന് ഓർഡർ',
  welcome_book_desc: 'അപ്പോയിന്റ്മെന്റ് ബുക്ക് ചെയ്യാം',
  welcome_doubt_desc: 'സംശയങ്ങൾ ചോദിക്കാം',
  welcome_meds_desc: 'മരുന്നുകൾ ഓർഡർ ചെയ്യാം',
  welcome_button: 'തിരഞ്ഞെടുക്കൂ',

  // ── Shared clinic picker (booking / medicine / two-step FAQ) ──────────────
  clinic_prompt: 'നിങ്ങളുടെ അടുത്തുള്ള ക്ലിനിക് ഏതാണ്?',
  // List "open" button ≤ 20 code points. Context (the prompt above) already
  // names the clinic, so a plain "select" reads fine and fits.
  clinic_pick_button: 'തിരഞ്ഞെടുക്കൂ',
  clinic_pick_section: 'SugarCARE ക്ലിനിക്കുകൾ',

  // ── Booking confirmation (no name step) ───────────────────────────────────
  // `{clinic}` is interpolated with the chosen clinic's Malayalam label.
  booking_confirm:
    "നന്ദി, '{clinic}' ക്ലിനിക്കിലേക്ക് ബുക്കിംഗ് റിക്വസ്റ്റ് ചെയ്തിട്ടുണ്ട്. സമയവും തീയതിയും തീരുമാനിക്കാൻ ഞങ്ങളുടെ ടീം നിങ്ങളെ വിളിക്കും 🙏",

  // ── Medicine confirmation (no name step) ──────────────────────────────────
  medicine_confirm:
    'നന്ദി, മരുന്ന് ഓർഡർ രേഖപ്പെടുത്തിയിട്ടുണ്ട്. വിവരങ്ങൾ അറിയാൻ ഞങ്ങളുടെ ടീം നിങ്ങളെ വിളിക്കും 🙏',

  // ── Doubt list ────────────────────────────────────────────────────────────
  faq_list_intro: FAQ_LIST_INTRO,
  faq_list_title: FAQ_LIST_TITLE,
  faq_list_button: 'തിരഞ്ഞെടുക്കൂ',

  // ── FAQ trailing buttons (reply buttons ≤ 20 code points) ─────────────────
  btn_book_short: '📅 ബുക്ക് ചെയ്യാം',
  btn_order_meds_short: '💊 മരുന്ന് ഓർഡർ',
  btn_ask_another: 'വേറെ സംശയം?',

  // ── Safety redirect (personal-medical + recovery-outcome) ─────────────────────
  doctor_redirect:
    'ഇത് നിങ്ങളുടെ അവസ്ഥ അനുസരിച്ച് വ്യത്യാസപ്പെടും. ഡോക്ടറോട് നേരിട്ട് ചോദിക്കുന്നതാണ് നല്ലത് 🙏',

  // ── Fallback ──────────────────────────────────────────────────────────────
  fallback_reprompt: 'ക്ഷമിക്കണം, മനസ്സിലായില്ല 🙏 താഴെ നിന്ന് ഒന്ന് തിരഞ്ഞെടുക്കൂ 👇',
  fallback_final: 'ഞങ്ങളുടെ ടീം ഉടൻ വിളിക്കും 🙏',

  // ── Closing loop (legacy BOOKING_COMPLETE path, kept intact) ──────────────
  closing_prompt: 'വേറെ എന്തെങ്കിലും സഹായം വേണോ?',
  btn_yes: 'Yes',
  btn_no: 'No',
  closing_bye: 'നന്ദി! 🙏 SugarCARE-ൽ കാണാം.',
};

/** Look up a Malayalam string. `lang` param is accepted-and-ignored so legacy
 * builders that still pass it keep working; there is only one table now. */
export function t(_lang, key) {
  return ML[key] ?? '';
}

// ── Low-level WhatsApp payload builders ──────────────────────────────────────
// These return the message body Meta expects, minus messaging_product/to,
// which whatsapp.js adds at send time. Shapes mirror the Meta Cloud API exactly.

export function textMsg(body) {
  return { type: 'text', text: { preview_url: false, body } };
}

export function buttonsMsg(body, buttons) {
  return {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: {
        buttons: buttons.map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: b.title },
        })),
      },
    },
  };
}

export function listMsg(body, buttonLabel, rows, sectionTitle) {
  const section = { rows };
  if (sectionTitle) section.title = sectionTitle;
  return {
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: body },
      action: { button: buttonLabel, sections: [section] },
    },
  };
}

// ── Shared clinic picker ─────────────────────────────────────────────────────

/** The 7-clinic interactive list, used by booking, medicine, and the two-step
 * FAQs. `body` is the prompt text (no CALL_LINE — this is a mid-flow prompt). */
export function clinicPicker(body = ML.clinic_prompt) {
  const rows = CLINICS.map((c) => ({ id: clinicRowId(c.id), title: c.ml }));
  return listMsg(body, ML.clinic_pick_button, rows, ML.clinic_pick_section);
}

// ── WELCOME (3-row list) ─────────────────────────────────────────────────────

export function welcome() {
  const rows = [
    { id: IDS.BTN_BOOK, title: ML.welcome_book, description: ML.welcome_book_desc },
    { id: IDS.BTN_DOUBT, title: ML.welcome_doubt, description: ML.welcome_doubt_desc },
    { id: IDS.BTN_MEDS, title: ML.welcome_meds, description: ML.welcome_meds_desc },
  ];
  return listMsg(ML.welcome_greeting, ML.welcome_button, rows);
}

// ── Booking flow (no name step) ──────────────────────────────────────────────

export function bookingClinicList() {
  return clinicPicker(ML.clinic_prompt);
}

/** Booking confirmation + CALL_LINE. `{clinic}` → chosen clinic's ML label. */
export function bookingConfirm(clinicId) {
  const body = ML.booking_confirm.replace('{clinic}', clinicLabel(clinicId));
  return textMsg(withCall(body));
}

// ── Medicine flow (no name step, mirrors booking) ────────────────────────────

export function medicineClinicList() {
  return clinicPicker(ML.clinic_prompt);
}

export function medicineConfirm() {
  return textMsg(withCall(ML.medicine_confirm));
}

// ── Doubt flow ───────────────────────────────────────────────────────────────

/** The 8-row FAQ interactive list. Short title (≤24 cp) + the full question as
 * the row description (≤72 cp) — WhatsApp rejects over-length titles outright. */
export function faqList() {
  const rows = FAQ_ROWS.map((r) => ({ id: r.id, title: r.title, description: r.description }));
  return listMsg(ML.faq_list_intro, ML.faq_list_button, rows, ML.faq_list_title);
}

/** The trailing buttons after a FAQ answer. `faq_delivery` gets the medicine
 * button instead of the book button; every other answer gets the book button.
 * Both always carry "വേറെ സംശയം ഉണ്ടോ?". */
export function faqTrailingButtons(faqId) {
  const first =
    faqId === 'faq_delivery'
      ? { id: IDS.BTN_ORDER_MEDS_SHORT, title: ML.btn_order_meds_short }
      : { id: IDS.BTN_BOOK_SHORT, title: ML.btn_book_short };
  return buttonsMsg(ML.faq_list_intro, [
    first,
    { id: IDS.BTN_ASK_ANOTHER, title: ML.btn_ask_another },
  ]);
}

/** A one-step FAQ answer (text + CALL_LINE) followed by its trailing buttons.
 * Two payloads — WhatsApp cannot attach buttons to a plain text bubble. */
export function faqAnswer(faqId) {
  const body = FAQ_ANSWERS[faqId] ?? '';
  return [textMsg(withCall(body)), faqTrailingButtons(faqId)];
}

/** The clinic picker shown for the two-step location/timing FAQs (no CALL_LINE
 * — still a mid-flow prompt). */
export function faqClinicPicker() {
  return clinicPicker(ML.clinic_prompt);
}

/** Two-step LOCATION answer for a clinic (text + CALL_LINE) + trailing buttons. */
export function faqLocationAnswer(clinicId) {
  const body = FAQ_LOCATION[clinicId] ?? '';
  return [textMsg(withCall(body)), faqTrailingButtons('faq_location')];
}

/** Two-step TIMING answer for a clinic (timing + footer + CALL_LINE) + buttons. */
export function faqTimingAnswer(clinicId) {
  const timing = FAQ_TIMING[clinicId] ?? '';
  const body = `${timing}\n${TIMING_FOOTER}`;
  return [textMsg(withCall(body)), faqTrailingButtons('faq_timing')];
}

// ── Safety redirect ──────────────────────────────────────────────────────────

/** Doctor redirect (text + CALL_LINE) + a single [📅 ബുക്ക് ചെയ്യാം] button. */
export function doctorRedirect() {
  return [
    textMsg(withCall(ML.doctor_redirect)),
    buttonsMsg(ML.faq_list_intro, [{ id: IDS.BTN_BOOK_SHORT, title: ML.btn_book_short }]),
  ];
}

/** Doctor redirect used mid-booking: text + CALL_LINE, then the pending booking
 * prompt is re-shown by the caller (no button here — booking resumes). */
export function doctorRedirectText() {
  return textMsg(withCall(ML.doctor_redirect));
}

// ── Fallback ─────────────────────────────────────────────────────────────────

/** 1st unrecognised text → apology + the 8-row FAQ list (2 payloads). */
export function fallbackReprompt() {
  return [textMsg(ML.fallback_reprompt), faqList()];
}

/** 2nd consecutive miss → team-will-call handoff (text + CALL_LINE) + book
 * button (2 payloads). */
export function fallbackHandoff() {
  return [
    textMsg(withCall(ML.fallback_final)),
    buttonsMsg(ML.faq_list_intro, [{ id: IDS.BTN_BOOK_SHORT, title: ML.btn_book_short }]),
  ];
}

// ── Legacy builders (unreachable, kept so legacy handlers compile) ───────────

export function menu() {
  return buttonsMsg(ML.menu_greeting, [
    { id: IDS.BTN_NEW, title: ML.btn_new },
    { id: IDS.BTN_EXISTING, title: ML.btn_existing },
  ]);
}

export function interestList() {
  const rows = [
    { id: IDS.INTEREST_DIABETES, title: ML.interest_diabetes },
    { id: IDS.INTEREST_BPCHOL, title: ML.interest_bpcholesterol },
    { id: IDS.INTEREST_CGM, title: ML.interest_cgm },
    { id: IDS.INTEREST_PRICE, title: ML.interest_price },
  ];
  return listMsg(ML.lead_interest_body, ML.clinic_button, rows);
}

function legacyClinicList(body) {
  const rows = CLINICS.map((c) => ({ id: clinicRowId(c.id), title: c.ml }));
  return listMsg(body, ML.clinic_button, rows, ML.clinic_section);
}

export function leadClinicList() {
  return legacyClinicList(ML.clinic_body);
}

export function apptClinicList() {
  return legacyClinicList(ML.appt_clinic_body);
}

export function askName() {
  return textMsg(ML.lead_name_body);
}

export function leadClose() {
  return textMsg(ML.lead_close);
}

export function patientMenu() {
  return buttonsMsg(ML.patient_menu_body, [
    { id: IDS.BTN_APPT, title: ML.btn_appt },
    { id: IDS.BTN_REPORT, title: ML.btn_report },
    { id: IDS.BTN_TEAM, title: ML.btn_team },
  ]);
}

export function apptDay() {
  return textMsg(ML.appt_day_body);
}

export function apptClose() {
  return textMsg(ML.appt_close);
}

export function teamHandoff() {
  return textMsg(ML.team_handoff);
}

export function clinicalHandoff() {
  return textMsg(ML.clinical_handoff);
}

// ── Closing loop (legacy BOOKING_COMPLETE path) ──────────────────────────────

export function closingLoop() {
  return buttonsMsg(ML.closing_prompt, [
    { id: IDS.BTN_CLOSING_YES, title: ML.btn_yes },
    { id: IDS.BTN_CLOSING_NO, title: ML.btn_no },
  ]);
}

export function closingBye() {
  return textMsg(ML.closing_bye);
}

// ── Introspection helpers (used by tests + button-length validation) ─────────

/** Every reply string — the banned-word scan target. Includes the FAQ content
 * strings (imported from content/faq.ml.js), the clinic labels, and the row
 * titles, so the scan covers everything that can reach a patient. */
export function allStrings() {
  const out = [...Object.values(ML)];
  out.push(CALL_LINE, TEAM_PHONE);
  out.push(...CLINICS.map((c) => c.ml));
  out.push(...FAQ_ROWS.map((r) => r.title));
  out.push(...Object.values(FAQ_ANSWERS));
  out.push(...Object.values(FAQ_LOCATION));
  out.push(...Object.values(FAQ_TIMING));
  out.push(TIMING_FOOTER);
  return out;
}

/** Button titles that must obey WhatsApp's 20-char limit. */
export function buttonLabels() {
  return [
    ML.btn_book_short,
    ML.btn_order_meds_short,
    ML.btn_ask_another,
    ML.btn_yes,
    ML.btn_no,
  ];
}
