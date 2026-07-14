/**
 * src/messages.js — EVERY user-facing string (Malayalam + English) and every
 * WhatsApp payload builder. Nothing else in the codebase contains an inline
 * reply string; stateMachine.js only calls the builders exported here.
 *
 * Two reasons for this hard boundary:
 *   1. The banned-word scan (bannedWords.test.js) only has to audit one file
 *      of strings, not hunt through logic.
 *   2. Register/translation edits happen in one place — a receptionist can be
 *      handed this file without touching the state machine.
 *
 * Malayalam register: everyday spoken Malappuram, the way a clinic receptionist
 * actually texts on WhatsApp — code-mixed with English words (appointment,
 * confirm, report), warm, short. Not formal/literary Malayalam.
 */

// ── Contact + clinics ────────────────────────────────────────────────────────

export const TEAM_PHONE = '+91 79948 84799';

// The 7 SugarCARE clinics. Malayalam names carried over from the existing repo's
// config/clinics.json so both bots read the same.
export const CLINICS = [
  { id: 'areekode', en: 'Areekode', ml: 'ആരിക്കോട്' },
  { id: 'kondotty', en: 'Kondotty', ml: 'കൊണ്ടോട്ടി' },
  { id: 'chemmad', en: 'Chemmad', ml: 'ചെമ്മാട്' },
  { id: 'padinjarangadi', en: 'Padinjarangadi', ml: 'പടിഞ്ഞാറങ്ങാടി' },
  { id: 'kanjirathani', en: 'Kanjirathani', ml: 'കാഞ്ഞിരത്താണി' },
  { id: 'punnayurkulam', en: 'Punnayurkulam', ml: 'പുന്നയൂർക്കുളം' },
  { id: 'edappal', en: 'Edappal', ml: 'എടപ്പാൾ' },
];

export const clinicRowId = (id) => `clinic_${id}`;
export const clinicById = (id) => CLINICS.find((c) => c.id === id) || null;
export const clinicFromRowId = (rowId) =>
  CLINICS.find((c) => clinicRowId(c.id) === rowId) || null;

// ── Stable ids (identifiers, not user-facing text) ───────────────────────────

export const IDS = {
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
};

export const INTEREST_IDS = new Set([
  IDS.INTEREST_DIABETES,
  IDS.INTEREST_BPCHOL,
  IDS.INTEREST_CGM,
  IDS.INTEREST_PRICE,
]);

// ── String tables ────────────────────────────────────────────────────────────
// One object per language. Button/list *labels* live here too.

const ML = {
  // Menu
  menu_greeting:
    'നമസ്കാരം! 🙏 SugarCARE Clinics-ലേക്ക് സ്വാഗതം. ഞാൻ ഇവിടത്തെ അസിസ്റ്റന്റ് ആണ്. എന്താ വേണ്ടേ? താഴെ ഒന്ന് തിരഞ്ഞെടുക്കൂ 👇',
  btn_new: 'പുതിയ രോഗി',
  btn_existing: 'നിലവിലെ രോഗി',
  btn_english: 'English',

  // New-lead branch
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

  // Existing-patient branch
  patient_menu_body: 'വീണ്ടും സ്വാഗതം! 😊 എന്ത് സഹായമാ വേണ്ടേ?',
  btn_appt: 'അപ്പോ. ബുക്ക്',
  btn_report: 'റിപ്പോർട്ട്/Rx',
  btn_team: 'ടീം',

  appt_clinic_body: 'ഏത് ക്ലിനിക്കിൽ ആണ് അപ്പോയിന്റ്മെന്റ് വേണ്ടത്? 👇',
  appt_day_body: 'ഏത് ദിവസം? ഉദാ: ചൊവ്വ, ബുധൻ',
  appt_close: 'ശരി, ഞങ്ങൾ confirm ചെയ്ത് വിളിക്കാം 🙏',

  team_handoff: `ടീം 9am–6pm-ക്ക് ഉള്ളിൽ reply ചെയ്യും. Urgent ആണെങ്കിൽ: ${TEAM_PHONE}`,

  // Clinical question guard (never answered by the bot)
  clinical_handoff: `ഇത് ഡോക്ടറോട് നേരിട്ട് ചോദിക്കേണ്ട കാര്യമാ 🙏 ഞങ്ങളുടെ ടീം ഉടൻ വിളിക്കും. Urgent ആണെങ്കിൽ: ${TEAM_PHONE}`,

  // Fallback
  fallback_reprompt: 'ക്ഷമിക്കണം, മനസ്സിലായില്ല 🙏 താഴെ നിന്ന് ഒന്ന് തിരഞ്ഞെടുക്കൂ:',
  fallback_final: 'ഞങ്ങളുടെ ടീം നേരിട്ട് മറുപടി തരും 🙏',
};

const EN = {
  menu_greeting:
    'Hello! 🙏 Welcome to SugarCARE Clinics. I am the assistant here. How can I help? Please pick one below 👇',
  btn_new: 'New patient',
  btn_existing: 'Existing patient',
  btn_english: 'English',

  lead_interest_body: 'What is it about? Please pick one below 👇',
  interest_diabetes: 'Diabetes care',
  interest_bpcholesterol: 'BP / Cholesterol',
  interest_cgm: 'CGM sensor',
  interest_price: 'Know the fees',

  clinic_body: 'Which clinic is nearest to you? Please pick one below 👇',
  clinic_button: 'Choose clinic',
  clinic_section: 'SugarCARE clinics',

  lead_name_body: 'May I have your name please? 🙂',
  lead_close: `Our team will call you shortly 🙏 To call us directly: ${TEAM_PHONE}`,

  patient_menu_body: 'Welcome back! 😊 What do you need help with?',
  btn_appt: 'Book appt.',
  btn_report: 'Report/Rx',
  btn_team: 'Team',

  appt_clinic_body: 'Which clinic would you like the appointment at? 👇',
  appt_day_body: 'Which day? e.g. Tuesday, Wednesday',
  appt_close: 'Okay, we will confirm and call you back 🙏',

  team_handoff: `The team will reply within 9am–6pm. If it is urgent: ${TEAM_PHONE}`,

  clinical_handoff: `This is something to ask the doctor directly 🙏 Our team will call you shortly. If it is urgent: ${TEAM_PHONE}`,

  fallback_reprompt: 'Sorry, I did not follow that 🙏 Please pick one below:',
  fallback_final: 'Our team will reply to you directly 🙏',
};

const TABLES = { ml: ML, en: EN };

/** Look up a string in the given language, falling back to Malayalam. */
export function t(lang, key) {
  const table = TABLES[lang] || ML;
  return table[key] ?? ML[key] ?? '';
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

// ── High-level per-screen builders (what stateMachine.js calls) ──────────────

export function menu(lang) {
  return buttonsMsg(t(lang, 'menu_greeting'), [
    { id: IDS.BTN_NEW, title: t(lang, 'btn_new') },
    { id: IDS.BTN_EXISTING, title: t(lang, 'btn_existing') },
    // English button only shown while still in Malayalam.
    ...(lang === 'ml' ? [{ id: IDS.BTN_ENGLISH, title: t('ml', 'btn_english') }] : []),
  ]);
}

export function interestList(lang) {
  const rows = [
    { id: IDS.INTEREST_DIABETES, title: t(lang, 'interest_diabetes') },
    { id: IDS.INTEREST_BPCHOL, title: t(lang, 'interest_bpcholesterol') },
    { id: IDS.INTEREST_CGM, title: t(lang, 'interest_cgm') },
    { id: IDS.INTEREST_PRICE, title: t(lang, 'interest_price') },
  ];
  return listMsg(t(lang, 'lead_interest_body'), t(lang, 'clinic_button'), rows);
}

function clinicList(lang, body) {
  const rows = CLINICS.map((c) => ({
    id: clinicRowId(c.id),
    title: lang === 'en' ? c.en : c.ml,
  }));
  return listMsg(body, t(lang, 'clinic_button'), rows, t(lang, 'clinic_section'));
}

export function leadClinicList(lang) {
  return clinicList(lang, t(lang, 'clinic_body'));
}

export function apptClinicList(lang) {
  return clinicList(lang, t(lang, 'appt_clinic_body'));
}

export function askName(lang) {
  return textMsg(t(lang, 'lead_name_body'));
}

export function leadClose(lang) {
  return textMsg(t(lang, 'lead_close'));
}

export function patientMenu(lang) {
  return buttonsMsg(t(lang, 'patient_menu_body'), [
    { id: IDS.BTN_APPT, title: t(lang, 'btn_appt') },
    { id: IDS.BTN_REPORT, title: t(lang, 'btn_report') },
    { id: IDS.BTN_TEAM, title: t(lang, 'btn_team') },
  ]);
}

export function apptDay(lang) {
  return textMsg(t(lang, 'appt_day_body'));
}

export function apptClose(lang) {
  return textMsg(t(lang, 'appt_close'));
}

export function teamHandoff(lang) {
  return textMsg(t(lang, 'team_handoff'));
}

export function clinicalHandoff(lang) {
  return textMsg(t(lang, 'clinical_handoff'));
}

export function fallbackReprompt(lang) {
  // Re-prompt = apology line + the main menu buttons (two payloads).
  return [textMsg(t(lang, 'fallback_reprompt')), menu(lang)];
}

export function fallbackFinal(lang) {
  return textMsg(t(lang, 'fallback_final'));
}

// ── Introspection helpers (used by tests + button-length validation) ─────────

/** Every reply string across both languages — the banned-word scan target. */
export function allStrings() {
  const out = [];
  for (const table of [ML, EN]) out.push(...Object.values(table));
  out.push(...CLINICS.map((c) => c.en), ...CLINICS.map((c) => c.ml));
  return out;
}

/** Button titles that must obey WhatsApp's 20-char limit. */
export function buttonLabels(lang) {
  return [
    t(lang, 'btn_new'),
    t(lang, 'btn_existing'),
    t(lang, 'btn_english'),
    t(lang, 'btn_appt'),
    t(lang, 'btn_report'),
    t(lang, 'btn_team'),
  ];
}
