/**
 * src/content/faq.ml.js — VERBATIM Malayalam FAQ content for the doubt flow.
 *
 * This file holds the *answer text* only. Payload builders (the interactive
 * list, trailing buttons, CALL_LINE append) live in messages.js, which imports
 * from here. Keeping the copy in its own file means a clinic staffer can edit
 * an answer without touching any WhatsApp-payload plumbing, and the banned-word
 * scan (bannedWords.test.js) still sees every string via messages.allStrings().
 *
 * Register: everyday spoken Malappuram Malayalam, code-mixed with English
 * medical/English loan words the way the clinic actually writes on WhatsApp.
 *
 * DO NOT paraphrase any string here — every line is signed off by the clinic.
 */

// ── The 8 doubt-list rows ────────────────────────────────────────────────────
// Row ids are the WhatsApp list_reply ids the state machine dispatches on.

export const FAQ_ROWS = [
  { id: 'faq_location', title: '📍 സ്ഥലം / ലാൻഡ്മാർക്ക്' },
  { id: 'faq_treatment', title: '🩺 എന്ത് തരം ചികിത്സയാണ് ?' },
  { id: 'faq_fees', title: '💰 ഫീസ് എത്രയാണ്?' },
  { id: 'faq_timing', title: '🕐 ക്ലിനിക് സമയം എങ്ങനെ ആണ്?' },
  { id: 'faq_reports', title: '📋 ഏതൊക്കെ റിപ്പോർട്ട് ആണ് കൊണ്ടുവരേണ്ടത്?' },
  { id: 'faq_diet', title: '🍚 ഭക്ഷണക്രമം എങ്ങനെ?' },
  { id: 'faq_multi', title: '❤️ മറ്റ് അസുഖങ്ങൾക്കും ചികിത്സ ഉണ്ടോ?' },
  { id: 'faq_delivery', title: '🚚 മരുന്ന് ഡെലിവറി ഉണ്ടോ?' },
];

// The two rows that need a clinic to be picked before their answer.
export const TWO_STEP_FAQ_IDS = new Set(['faq_location', 'faq_timing']);

export const FAQ_LIST_TITLE = 'സംശയങ്ങൾ';
export const FAQ_LIST_INTRO = 'എന്ത് സംശയമാണ്? താഴെ നിന്ന് തിരഞ്ഞെടുക്കൂ 👇';

// ── One-step answers ─────────────────────────────────────────────────────────

export const FAQ_ANSWERS = {
  faq_treatment:
    'ഞങ്ങളുടേത് മോഡേൺ മെഡിക്കൽ ട്രീറ്റ്മെന്റ് ആണ് — അലോപ്പതി (ഇംഗ്ലീഷ് മെഡിസിൻ), ആയുർവേദമല്ല. മരുന്ന് മാത്രമല്ല — പ്രമേഹം ഒരു ജീവിതശൈലീ രോഗമായതിനാൽ കൃത്യമായ ഫോളോ-അപ്പ്, ശാസ്ത്രീയമായ ഭക്ഷണക്രമീകരണം, ശരിയായ വ്യായാമം — ഈ മൂന്നും ചേർന്നാണ് ചികിത്സ. ഒപ്പം ആവശ്യമായ മരുന്ന് സപ്പോർട്ടും ഉണ്ടാകും.',

  faq_fees: 'ഡോക്ടർ കൺസൾട്ടേഷൻ ഫീസ് ₹300 ആണ്.',

  faq_reports:
    'മുൻപ് ചെയ്തിട്ടുള്ള പരിശോധനാ ഫലങ്ങൾ (റിപ്പോർട്ടുകൾ) ഉണ്ടെങ്കിൽ അതുമായി വന്നാൽ മതി. നിലവിൽ കഴിക്കുന്ന മരുന്നുകളും കൂടെ കരുതുക. കൂടുതൽ ടെസ്റ്റുകൾ വേണമെങ്കിൽ അതിനുള്ള എല്ലാ സൗകര്യങ്ങളും ക്ലിനിക്കിൽ തന്നെയുണ്ട്.',

  faq_diet:
    'ഭക്ഷണക്രമീകരണം എല്ലാവർക്കും ഒരുപോലെയല്ല. ഓരോ രോഗിയുടെയും BMI, ബോഡി കോമ്പോസിഷൻ സ്കാൻ തുടങ്ങിയ പരിശോധനകൾ നടത്തി, ഓരോരുത്തർക്കും അനുയോജ്യമായ ഡയറ്റ് ഞങ്ങളുടെ ഡയറ്റീഷ്യൻമാർ വ്യക്തിഗതമായി തയ്യാറാക്കി തരും.',

  faq_multi:
    'ഉണ്ട്. ഇത് ഷുഗറിന്റെ മാത്രം ചികിത്സയല്ല. പ്രമേഹത്തോടൊപ്പം വരുന്ന ബി.പി., കൊളസ്ട്രോൾ, കിഡ്നി-ഹൃദയ സംബന്ധമായ പ്രശ്നങ്ങൾ എന്നിവയും ചേർത്താണ് ചികിത്സ. ഹാർട്ട് അറ്റാക്ക്, സ്ട്രോക്ക് വന്നിട്ടുള്ളവർക്ക് അവ വീണ്ടും വരാതിരിക്കാനുള്ള തുടർ പരിചരണവും നൽകുന്നു. ആവശ്യമെങ്കിൽ ഡോക്ടറുടെ റഫറൻസിൽ വിദഗ്ധ ചികിത്സയും ലഭ്യമാക്കും.',

  faq_delivery:
    'ഉണ്ട്. ക്ലിനിക്കിന് അടുത്തുള്ള സ്ഥലങ്ങളിലേക്ക് നേരിട്ടും, ദൂരെയുള്ള സ്ഥലങ്ങളിലേക്ക് കൊറിയർ വഴിയും മരുന്നുകൾ എത്തിച്ചു നൽകും.',
};

// ── Two-step: per-clinic LOCATION ────────────────────────────────────────────
// Keyed by clinic id (see CLINICS in messages.js). `{maps_link}` is a
// placeholder — the Google Maps URLs get filled in later. The state machine
// resolves clinic id → answer; a missing key must never crash (messages.js
// guards with a fallback).

export const FAQ_LOCATION = {
  padinjarangadi: 'പടിഞ്ഞാറങ്ങാടി: പറക്കുളം റോഡിലാണ് ഞങ്ങളുടെ ക്ലിനിക്. {maps_link}',
  edappal: 'എടപ്പാൾ: പട്ടാമ്പി റോഡിൽ എച്ച്.പി. പെട്രോൾ പമ്പിന് എതിർവശം, പ്രിവന്റിഫയ് ക്ലിനിക്. {maps_link}',
  chemmad: 'ചെമ്മാട്: താലൂക്ക് ഹോസ്പിറ്റലിന് തൊട്ടടുത്ത്, അൽ റയ്ഹാൻ കണ്ണാശുപത്രി. {maps_link}',
  areekode: 'അരീക്കോട്: താഴത്തേങ്ങാടി പെട്രോൾ പമ്പിന് എതിർവശം, അൽ റയ്ഹാൻ ഹോസ്പിറ്റൽ. {maps_link}',
  kondotty: 'കൊണ്ടോട്ടി: റിലീഫ് ഹോസ്പിറ്റലിന് അടുത്ത്, അൽ റയ്ഹാൻ കണ്ണാശുപത്രി. {maps_link}',
  punnayurkulam: 'പുന്നയൂർക്കുളം: ശാന്തി ഹോസ്പിറ്റലിന് എതിർവശം, ഫാമിലി ലാബ്. {maps_link}',
  kanjirathani: 'കാഞ്ഞിരത്താണി: കാഞ്ഞിരത്താണി സെന്റർ. {maps_link}',
};

// ── Two-step: per-clinic TIMING ──────────────────────────────────────────────
// `timing_footer` is appended after whichever clinic's timing is shown.

export const FAQ_TIMING = {
  padinjarangadi: 'പടിഞ്ഞാറങ്ങാടി: തിങ്കൾ–ശനി · രാവിലെ 10:00–1:00, വൈകീട്ട് 2:00–6:00',
  edappal: 'എടപ്പാൾ: തിങ്കൾ–ശനി · രാവിലെ 10:00–1:00, വൈകീട്ട് 3:00–6:00',
  chemmad: 'ചെമ്മാട്: തിങ്കൾ–ബുധൻ രാവിലെ 10:00–12:00 · വ്യാഴം–ശനി വൈകീട്ട് 3:00–5:00',
  areekode: 'അരീക്കോട്: തിങ്കൾ–ശനി · രാവിലെ 11:00–1:00',
  kondotty: 'കൊണ്ടോട്ടി: തിങ്കൾ–ശനി · വൈകീട്ട് 3:00–5:00',
  punnayurkulam: 'പുന്നയൂർക്കുളം: ചൊവ്വ, വെള്ളി · വൈകീട്ട് 3:30–5:30',
  kanjirathani: 'കാഞ്ഞിരത്താണി: തിങ്കൾ–ശനി · വൈകീട്ട് 4:30–6:00',
};

export const TIMING_FOOTER =
  'ഡോക്ടർമാരുടെ ലഭ്യത അനുസരിച്ച് സമയം മാറാം. മാറ്റമുണ്ടെങ്കിൽ വാട്സ്ആപ്പിൽ അറിയിക്കും. ഞായറാഴ്ച അവധി.';
