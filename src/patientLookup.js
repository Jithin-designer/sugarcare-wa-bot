/**
 * src/patientLookup.js — ⚠️ MOCK STUB. NOT WIRED TO ANY REAL DATA SOURCE. ⚠️
 *
 * In production this is where the bot would confirm an "existing patient" against
 * the clinic EMR / patient database (by WhatsApp phone number) and optionally
 * pull their name and home clinic to personalise the flow. That EMR integration
 * is still an open decision in the original repo (blocker B1 in the Python
 * project's CLAUDE.md), so this returns a hard-coded null: every caller is
 * treated as unknown, and the "existing patient" branch is entered purely by the
 * user tapping the button — never by a lookup result.
 *
 * When B1 lands, replace the body with a real EMR/DB call and keep the shape:
 *   { found: boolean, name?: string, homeClinicId?: string }
 */

export function lookupPatient(phone) {
  // TODO(B1): call the real EMR/patient DB here.
  void phone;
  return { found: false, name: null, homeClinicId: null };
}
