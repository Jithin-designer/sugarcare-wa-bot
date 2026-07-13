/**
 * src/bannedWords.js — HARD RULE #2 enforcement.
 *
 * These words imply a medical claim (or a cure/"reversal" promise) that an
 * unlicensed WhatsApp front door must never make. They must never appear in a
 * reply string. A test scans messages.js and the rest of src/ to prove it.
 *
 * Matching strategy:
 *   - ASCII words use a word-boundary regex, so legitimate substrings never
 *     false-positive (e.g. "secure"/"accurate" do NOT trip the "cure" rule).
 *   - Malayalam words use substring matching, because JavaScript's \b word
 *     boundary is ASCII-only and would never fire on Malayalam script.
 */

export const BANNED_WORDS = ['reversal', 'cure', 'മുക്തി', 'മാറ്റിയെടുക്കാം'];

const isAscii = (w) => /^[\x00-\x7F]+$/.test(w);

/**
 * Return the list of banned words found in `text` (empty if clean).
 * @param {string} text
 * @returns {string[]}
 */
export function findBannedWords(text) {
  const hay = String(text ?? '');
  const hits = [];
  for (const word of BANNED_WORDS) {
    if (isAscii(word)) {
      // eslint-disable-next-line security/detect-non-literal-regexp
      const re = new RegExp(`\\b${word}\\b`, 'i');
      if (re.test(hay)) hits.push(word);
    } else if (hay.includes(word)) {
      hits.push(word);
    }
  }
  return hits;
}

/** True if the text contains no banned words. */
export function isClean(text) {
  return findBannedWords(text).length === 0;
}

/**
 * Throw if `text` contains a banned word. Used as a defensive guard right
 * before dispatch so a bad string can never reach a patient, even if a future
 * edit slips one past the test.
 */
export function assertClean(text, context = 'reply') {
  const hits = findBannedWords(text);
  if (hits.length > 0) {
    throw new Error(`banned word(s) in ${context}: ${hits.join(', ')}`);
  }
  return text;
}
