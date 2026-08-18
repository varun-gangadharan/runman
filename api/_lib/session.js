/**
 * Session cookies.
 *
 * The previous design kept Strava access and refresh tokens in `localStorage`,
 * which means any XSS anywhere in the app hands an attacker permanent read
 * access to the athlete's Strava account. Tokens now live in Postgres and never
 * reach the browser; the browser holds only an HMAC-signed, httpOnly cookie
 * naming which athlete it is.
 */

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { config } from './env.js';

const COOKIE_NAME = 'runman_session';
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

/** @param {string} payload */
function sign(payload) {
  return createHmac('sha256', config.sessionSecret()).update(payload).digest('base64url');
}

/**
 * @param {{ athleteId: string }} session
 * @returns {string} cookie value: base64url(json).signature
 */
export function serializeSession(session) {
  const body = { athleteId: String(session.athleteId), issuedAt: Date.now(), nonce: randomBytes(8).toString('hex') };
  const payload = Buffer.from(JSON.stringify(body)).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/**
 * @param {string | undefined} value
 * @returns {{ athleteId: string, issuedAt: number } | null}
 */
export function verifySession(value) {
  if (!value) return null;
  const separator = value.lastIndexOf('.');
  if (separator <= 0) return null;

  const payload = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expected = sign(payload);

  // Constant-time comparison: a fast-exit compare leaks the signature one byte
  // at a time to anyone willing to measure.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!body.athleteId) return null;
    if (Date.now() - body.issuedAt > MAX_AGE_SECONDS * 1000) return null;
    return { athleteId: String(body.athleteId), issuedAt: body.issuedAt };
  } catch {
    return null;
  }
}

/** @param {import('node:http').IncomingMessage} req */
export function readSession(req) {
  const header = req.headers.cookie ?? '';
  const match = header.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE_NAME}=`));
  return verifySession(match?.slice(COOKIE_NAME.length + 1));
}

/**
 * Attributes every cookie this app sets must carry.
 *
 * Exported so the OAuth state cookie uses the same rules as the session cookie.
 * They were written separately once, and the state cookie — the one carrying
 * CSRF protection — silently shipped without `Secure`.
 */
export function cookieAttributes({ maxAgeSeconds }) {
  const secure = config.appUrl().startsWith('https') ? '; Secure' : '';
  return `HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function sessionCookie(session) {
  return `${COOKIE_NAME}=${serializeSession(session)}; ${cookieAttributes({ maxAgeSeconds: MAX_AGE_SECONDS })}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; ${cookieAttributes({ maxAgeSeconds: 0 })}`;
}

/**
 * Guard for any handler that needs an authenticated athlete.
 * @returns {{ athleteId: string } | null} null after having already sent a 401.
 */
export function requireSession(req, res) {
  const session = readSession(req);
  if (!session) {
    res.status(401).json({ error: 'not_authenticated', message: 'Sign in with Strava first.' });
    return null;
  }
  return session;
}
