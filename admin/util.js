/**
 * admin/util.js — small pure view helpers shared by routes + EJS templates.
 * No DB, no I/O — trivially testable.
 */

export const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * WhatsApp 24h customer-service window, evaluated from the patient's LAST
 * inbound. `open` = a free-form reply is allowed right now.
 *
 * Note the admin semantics differ from the bot's isWithinSessionWindow: here a
 * conversation with NO inbound at all is CLOSED (the patient must message first),
 * whereas the bot treats "no record" as "this very turn just opened it".
 */
export function windowInfo(lastInboundAt, now = Date.now()) {
  if (!lastInboundAt) return { open: false, msLeft: 0 };
  const elapsed = now - lastInboundAt;
  const open = elapsed <= TWENTY_FOUR_HOURS_MS;
  return { open, msLeft: open ? TWENTY_FOUR_HOURS_MS - elapsed : 0 };
}

/** "just now" / "2m ago" / "3h ago" / "5d ago" from a ms timestamp. */
export function relativeTime(ts, now = Date.now()) {
  if (!ts) return '';
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** Wall-clock HH:MM (24h) for a ms timestamp — used on message bubbles. */
export function clock(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Truncate a preview string to n chars with an ellipsis. */
export function truncate(str, n = 48) {
  const s = String(str || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
