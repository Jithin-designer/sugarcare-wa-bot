/**
 * admin/auth.js — session auth for the telecaller panel.
 *
 * Non-negotiables (from the brief):
 *   - Session-based login (express-session + bcrypt hashes). No query-string
 *     keys, no tokens in URLs — the session cookie is the only credential.
 *   - Three seeded users: nithin, aleena (telecallers) + jithin (admin).
 *     Passwords come from .env on FIRST seed only, stored bcrypt-hashed.
 *   - 12h session timeout; login endpoint is rate-limited.
 */

import session from 'express-session';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

const isMock = () => String(process.env.MOCK_MODE ?? 'true').toLowerCase() !== 'false';

// The three seeded accounts. Password ENV var per user; role drives nothing
// today beyond display, but is stored so an admin-only surface can be added
// later without a migration.
const SEED_USERS = [
  { username: 'nithin', role: 'telecaller', envKey: 'ADMIN_SEED_PASSWORD_NITHIN' },
  { username: 'aleena', role: 'telecaller', envKey: 'ADMIN_SEED_PASSWORD_ALEENA' },
  { username: 'jithin', role: 'admin', envKey: 'ADMIN_SEED_PASSWORD_JITHIN' },
];

/**
 * Resolve the plaintext seed password for a user. Uses the env var; in MOCK_MODE
 * falls back to a loud dev default so the panel is testable locally without a
 * fully-populated .env. In production a missing password is fatal for that user
 * (we skip seeding it rather than create a guessable login).
 */
function seedPasswordFor(user) {
  const fromEnv = process.env[user.envKey];
  if (fromEnv) return fromEnv;
  if (isMock()) {
    console.warn(`⚠️  ${user.envKey} unset — seeding "${user.username}" with dev password "changeme" (MOCK_MODE only).`);
    return 'changeme';
  }
  console.error(`✖  ${user.envKey} unset in production — NOT seeding "${user.username}".`);
  return null;
}

/**
 * Seed the three users if they don't exist yet. Safe to call on every boot.
 * NEVER overwrites an existing row — an operator who has rotated a password (or
 * whose hash predates a change here) keeps their credential untouched.
 */
export function seedUsers(db) {
  for (const user of SEED_USERS) {
    if (db.getUser(user.username)) continue;      // already seeded — never overwrite
    const password = seedPasswordFor(user);
    if (!password) continue;
    const password_hash = bcrypt.hashSync(password, 10);
    const created = db.insertUser({ username: user.username, password_hash, role: user.role });
    if (created) console.log(`admin: seeded user "${user.username}" (${user.role})`);
  }
}

/** Verify a username/password pair against the stored hash. Returns the user row or null. */
export function verifyLogin(db, username, password) {
  const row = db.getUser(String(username || '').trim().toLowerCase());
  if (!row) return null;
  if (!bcrypt.compareSync(String(password || ''), row.password_hash)) return null;
  return { username: row.username, role: row.role };
}

/** express-session middleware, configured for a 12h rolling timeout. */
export function sessionMiddleware() {
  const secret = process.env.ADMIN_SESSION_SECRET
    || (isMock() ? 'dev_admin_session_secret_change_me' : '');
  if (!secret) {
    console.error('✖  ADMIN_SESSION_SECRET unset in production — sessions are insecure.');
  }
  return session({
    name: 'sugarcare.sid',
    secret: secret || 'insecure-fallback',
    resave: false,
    saveUninitialized: false,
    // rolling: each authenticated request refreshes the 12h clock, so a
    // telecaller working a full shift is not logged out mid-conversation, while
    // an idle session still expires 12h after the last activity.
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: !isMock(),     // require HTTPS in production (behind nginx TLS)
      maxAge: TWELVE_HOURS_MS,
    },
  });
}

/** Route guard: redirect unauthenticated requests to the login page. */
export function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/admin/login');
}

/** Rate limiter for the login POST — blunts brute-force / credential stuffing. */
export function loginLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,   // 15 min
    max: 20,                    // 20 attempts per IP per window
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many login attempts. Please wait a few minutes and try again.',
  });
}
