/**
 * Strava OAuth callback.
 *
 * This is the endpoint that used to live in the browser. The code-for-token
 * exchange now happens here, the tokens go straight into Postgres, and the
 * browser receives only a signed session cookie.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../_lib/env.js';
import { exchangeCode } from '../_lib/strava.js';
import { saveAthlete, saveTokens } from '../_lib/supabase.js';
import { cookieAttributes, sessionCookie } from '../_lib/session.js';

/** @param {string | undefined} state */
function stateIsValid(state, cookieState) {
  if (!state || !cookieState || state !== cookieState) return false;
  const separator = state.lastIndexOf('.');
  if (separator <= 0) return false;

  const nonce = state.slice(0, separator);
  const provided = Buffer.from(state.slice(separator + 1));
  const expected = Buffer.from(createHmac('sha256', config.sessionSecret()).update(nonce).digest('base64url'));
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export default async function handler(req, res) {
  const { code, state, error: stravaError } = req.query;

  if (stravaError) {
    return res.redirect(302, `/login?error=${encodeURIComponent(String(stravaError))}`);
  }

  try {
    const cookieState = (req.headers.cookie ?? '')
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('runman_oauth_state='))
      ?.slice('runman_oauth_state='.length);

    if (!stateIsValid(String(state ?? ''), cookieState)) {
      return res.redirect(302, '/login?error=invalid_state');
    }
    if (!code) {
      return res.redirect(302, '/login?error=missing_code');
    }

    const tokens = await exchangeCode(String(code));
    const athleteId = String(tokens.athlete.id);

    await saveAthlete(tokens.athlete);
    await saveTokens(athleteId, tokens);

    res.setHeader('Set-Cookie', [
      sessionCookie({ athleteId }),
      `runman_oauth_state=; ${cookieAttributes({ maxAgeSeconds: 0 })}`,
    ]);
    // First sign-in has no activities stored yet, so land on the page that
    // offers to pull them in.
    res.redirect(302, '/dashboard?connected=1');
  } catch (error) {
    console.error('OAuth callback failed:', error);
    res.redirect(302, '/login?error=exchange_failed');
  }
}
