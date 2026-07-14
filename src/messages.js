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

  // Booking-first flow (WELCOME entry point)
  BTN_BOOK: 'btn_book',
  BTN_DOUBT: 'btn_doubt',
  BTN_TALK_TO_TEAM: 'btn_talk_to_team', // WELCOME's bridge into the existing PATIENT_MENU
  BTN_CLOSING_YES: 'btn_closing_yes',
  BTN_CLOSING_NO: 'btn_closing_no',
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
  fallback_handoff_number: `ഞങ്ങളുടെ team-നെ ബന്ധപ്പെടാൻ: ${TEAM_PHONE}`,

  // ── Booking-first flow (WELCOME entry point) ──────────────────────────────
  welcome_greeting: 'നമസ്കാരം! 👋 SugarCARE Clinics-ലേക്ക് സ്വാഗതം. ഞങ്ങൾ എങ്ങനെ സഹായിക്കട്ടെ?',
  btn_book: '📅 Book cheyyam',
  btn_doubt: '❓ Doubt undu',
  btn_talk_to_team: 'ടീമിനോട് സംസാരിക്കണം',

  booking_clinic_body: 'ഏത് ക്ലിനിക്കിൽ ആണ് അപ്പോയിന്റ്മെന്റ് വേണ്ടത്? താഴെ നിന്ന് തിരഞ്ഞെടുക്കൂ 👇',
  booking_name_body: 'നിങ്ങളുടെ പേര്?',
  booking_confirm_prefix: 'നന്ദി',
  booking_confirm_suffix: 'ടീം ഉടൻ വിളിക്കും, സമയം fix ചെയ്യാം.',

  // Q&A path
  qa_prompt_body: 'എന്താ സംശയം? ചോദിച്ചോളൂ 🙂',
  qa_footer_body: 'വേറെ എന്തെങ്കിലും വേണോ?',
  qa_answer_diet: 'ഭക്ഷണത്തിൽ കാർബോഹൈഡ്രേറ്റ് (ചോറ്, ചപ്പാത്തി) കുറച്ച്, പച്ചക്കറികളും നാരുകൾ ഉള്ള ഭക്ഷണവും കൂട്ടുന്നത് sugar control-ന് നല്ലതാ. ഓരോരുത്തർക്കും വ്യത്യാസം ഉണ്ടാവും, കൃത്യമായ diet plan വേണമെങ്കിൽ ഡോക്ടറെ കാണുന്നതാ നല്ലത്.',
  qa_answer_exercise: 'ദിവസവും 30 മിനിറ്റ് നടത്തം (walking) പോലുള്ള light exercise sugar level control ചെയ്യാൻ സഹായിക്കും. പുതിയ exercise തുടങ്ങുന്നതിന് മുൻപ് ഡോക്ടറോട് ഒന്ന് ചോദിക്കുന്നതാ നല്ലത്.',
  qa_answer_monitoring: 'Sugar പതിവായി glucometer വച്ച് check ചെയ്യുന്നത് നല്ലതാ — ഡോക്ടർ പറഞ്ഞ frequency അനുസരിച്ച്. Reading-കൾ ഒരു diary-യിൽ എഴുതി വച്ചാൽ ഡോക്ടർക്ക് പെട്ടെന്ന് മനസ്സിലാക്കാൻ എളുപ്പമാവും.',
  qa_answer_hba1c: 'HbA1c എന്നത് കഴിഞ്ഞ 2-3 മാസത്തെ ശരാശരി sugar level കാണിക്കുന്ന ഒരു blood test ആണ്. ഇത് ഡോക്ടർ diabetes control എത്ര നല്ലതാ എന്ന് നോക്കാൻ ഉപയോഗിക്കുന്ന ഒരു പ്രധാന test ആണ്.',
  qa_redirect_personal: `ഇത് doctor-നോട് നേരിട്ട് ചോദിക്കുന്നതാണ് നല്ലത്.`,
  qa_redirect_unknown: 'ഇതിന് കൃത്യമായ ഉത്തരം തരാൻ ഞങ്ങൾക്ക് പറ്റില്ല 🙏 doctor-നോട് നേരിട്ട് ചോദിക്കുന്നതാണ് നല്ലത്.',

  // Mid-booking interruption + resume
  midbooking_answered_prefix: 'ശരി! Back to booking —',

  // Closing loop
  closing_prompt: 'വേറെ എന്തെങ്കിലും സഹായം വേണോ?',
  btn_yes: 'Yes',
  btn_no: 'No',
  closing_bye: 'നന്ദി! 🙏 SugarCARE-ൽ കാണാം.',
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
  fallback_handoff_number: `You can reach our team directly: ${TEAM_PHONE}`,

  // ── Booking-first flow (WELCOME entry point) ──────────────────────────────
  welcome_greeting: 'Hello! 👋 Welcome to SugarCARE Clinics. How can we help you today?',
  btn_book: '📅 Book cheyyam',
  btn_doubt: '❓ Doubt undu',
  btn_talk_to_team: 'Talk to our team',

  booking_clinic_body: 'Which clinic would you like the appointment at? Please pick one below 👇',
  booking_name_body: 'What is your name?',
  booking_confirm_prefix: 'Thank you',
  booking_confirm_suffix: 'team will call you shortly to fix a time.',

  // Q&A path
  qa_prompt_body: 'What is your question? Go ahead 🙂',
  qa_footer_body: 'Anything else?',
  qa_answer_diet: 'Cutting down on carbs (rice, chapati) and adding more vegetables and fibre helps with sugar control. Everyone is different, so for an exact diet plan it is best to check with your doctor.',
  qa_answer_exercise: 'Light exercise like a 30-minute walk every day can help control sugar levels. Before starting any new exercise, it is best to check with your doctor.',
  qa_answer_monitoring: 'Checking your sugar regularly with a glucometer, at the frequency your doctor recommends, is a good habit. Keeping a diary of your readings makes it easier for the doctor to review.',
  qa_answer_hba1c: 'HbA1c is a blood test that shows your average sugar level over the last 2-3 months. Doctors use it to see how well diabetes is being controlled overall.',
  qa_redirect_personal: 'This is best asked directly to the doctor.',
  qa_redirect_unknown: 'We are not able to give an exact answer to this 🙏 It is best to ask the doctor directly.',

  // Mid-booking interruption + resume
  midbooking_answered_prefix: 'Okay! Back to booking —',

  // Closing loop
  closing_prompt: 'Do you need any other help?',
  btn_yes: 'Yes',
  btn_no: 'No',
  closing_bye: 'Thank you! 🙏 See you at SugarCARE.',
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

export function fallbackHandoffNumber(lang) {
  return textMsg(t(lang, 'fallback_handoff_number'));
}

// ── Booking-first flow (WELCOME entry point) ─────────────────────────────────

export function welcome(lang) {
  return buttonsMsg(t(lang, 'welcome_greeting'), [
    { id: IDS.BTN_BOOK, title: t(lang, 'btn_book') },
    { id: IDS.BTN_DOUBT, title: t(lang, 'btn_doubt') },
  ]);
}

export function bookingClinicList(lang) {
  return clinicList(lang, t(lang, 'booking_clinic_body'));
}

export function bookingNameBody(lang) {
  return textMsg(t(lang, 'booking_name_body'));
}

/** Booking confirmation — interpolates the captured name + chosen clinic's label. */
export function bookingConfirm(lang, name, clinicId) {
  const clinic = clinicById(clinicId);
  const clinicLabel = clinic ? (lang === 'en' ? clinic.en : clinic.ml) : '';
  const safeName = String(name || '').trim();
  return textMsg(
    `${t(lang, 'booking_confirm_prefix')} ${safeName}! 🙏 ${clinicLabel} ${t(lang, 'booking_confirm_suffix')}`
  );
}

// ── Q&A path ──────────────────────────────────────────────────────────────────

/** Shown right after "Doubt undu" is tapped — invites the typed question. */
export function qaPrompt(lang) {
  return textMsg(t(lang, 'qa_prompt_body'));
}

/** The 2 buttons that must end EVERY Q&A reply (own interactive payload — WhatsApp
 * cannot attach buttons to a plain text bubble, same reason fallbackReprompt() is
 * two payloads). */
export function qaFooter(lang) {
  return buttonsMsg(t(lang, 'qa_footer_body'), [
    { id: IDS.BTN_BOOK, title: t(lang, 'btn_book') },
    { id: IDS.BTN_DOUBT, title: t(lang, 'btn_doubt') },
  ]);
}

const QA_ANSWER_KEYS = {
  diet: 'qa_answer_diet',
  exercise: 'qa_answer_exercise',
  monitoring: 'qa_answer_monitoring',
  hba1c: 'qa_answer_hba1c',
};

/** Plain educational-answer text for a topic (no footer) — used standalone by
 * qaAnswer() and folded into midBookingBriefAnswer() during a booking pause. */
function qaAnswerText(lang, topic) {
  const key = QA_ANSWER_KEYS[topic];
  return key ? t(lang, key) : t(lang, 'qa_redirect_unknown');
}

/** A canned educational answer + the mandatory [Book][Doubt] footer (2 payloads). */
export function qaAnswer(lang, topic) {
  return [textMsg(qaAnswerText(lang, topic)), qaFooter(lang)];
}

/** The "ask the doctor directly" deferral for personal-medical Q&A + footer. */
export function qaRedirectPersonal(lang) {
  return [textMsg(t(lang, 'qa_redirect_personal')), qaFooter(lang)];
}

// ── Mid-booking interruption + resume ────────────────────────────────────────

/**
 * A question interrupted booking (CLINIC_SELECT or NAME_CAPTURE). Answer it
 * briefly — a topic-education line, or the doctor-deferral if it was a
 * personal-medical question — then resume exactly where booking paused.
 * `pendingPayloads` is whatever prompt was pending (clinic list or name ask).
 * `topic` is null for a personal-medical question (deferral wins over any
 * topic match — see isPersonalMedicalQuestion in stateMachine.js).
 */
export function midBookingBriefAnswer(lang, topic, pendingPayloads) {
  const brief = topic === 'personal' ? t(lang, 'qa_redirect_personal') : qaAnswerText(lang, topic);
  return [
    textMsg(brief),
    textMsg(t(lang, 'midbooking_answered_prefix')),
    ...[].concat(pendingPayloads),
  ];
}

// ── Closing loop ──────────────────────────────────────────────────────────────

export function closingLoop(lang) {
  return buttonsMsg(t(lang, 'closing_prompt'), [
    { id: IDS.BTN_CLOSING_YES, title: t(lang, 'btn_yes') },
    { id: IDS.BTN_CLOSING_NO, title: t(lang, 'btn_no') },
  ]);
}

export function closingBye(lang) {
  return textMsg(t(lang, 'closing_bye'));
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
