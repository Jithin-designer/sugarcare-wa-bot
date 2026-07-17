/**
 * admin/auth.js — session auth for the telecaller panel.
 *
 * Non-negotiables (from the brief):
 *   - Session-based login (express-session + bcrypt hashes). No query-string
 *     keys, no tokens in URLs — the session cookie is the only credential.
 *   - Three seeded users: nithin, aleena (telecallers) + jithin (admin).
 *     Default password is "1234", stored only as a bcrypt hash.
 *   - 12h session timeout; login endpoint is rate-limited.
 */

import session from 'express-session';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

const isMock = () => String(process.env.MOCK_MODE ?? 'true').toLowerCase() !== 'false';

// The three default accounts. Role drives nothing today beyond display, but is
// stored so an admin-only surface can be added later without a migration.
const SEED_USERS = [
  { username: 'nithin', role: 'telecaller' },
  { username: 'aleena', role: 'telecaller' },
  { username: 'jithin', role: 'admin' },
];

const DEFAULT_PASSWORD = '1234';
const DEFAULT_PASSWORD_MIGRATION = 'default-password-v2-1234';

/**
 * Ensure the three default accounts use the documented default password.
 * Existing rows are repaired as well as new rows so deployments created by the
 * old env-driven seeder do not remain permanently locked to an unknown hash.
 */
export function seedUsers(db) {
  const repairLegacyHashes = db.getAdminMeta(DEFAULT_PASSWORD_MIGRATION) !== 'complete';

  for (const user of SEED_USERS) {
    const existing = db.getUser(user.username);
    if (existing && (!repairLegacyHashes || bcrypt.compareSync(DEFAULT_PASSWORD, existing.password_hash))) {
      continue;
    }

    const password_hash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);
    if (existing) {
      db.updateUserPassword(user.username, password_hash);
      console.log(`admin: reset default password for "${user.username}" (${user.role})`);
    } else {
      const created = db.insertUser({ username: user.username, password_hash, role: user.role });
      if (created) console.log(`admin: seeded user "${user.username}" (${user.role})`);
    }
  }

  db.setAdminMeta(DEFAULT_PASSWORD_MIGRATION, 'complete');
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
