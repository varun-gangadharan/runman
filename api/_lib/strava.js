/**
 * Strava API client. Server-side only — this module reads the client secret,
 * so importing it from anything that ends up in a browser bundle is a bug.
 */

import { config } from './env.js';
import { getTokens, saveTokens } from './supabase.js';

const STRAVA_API = 'https://www.strava.com/api/v3';
const STRAVA_OAUTH = 'https://www.strava.com/oauth/token';

/** Refresh a minute early so a request never races the expiry. */
const REFRESH_MARGIN_SECONDS = 60;

/**
 * Exchange an authorization code for tokens. Runs on the server so the code and
 * the client secret never appear in the same place as the browser.
 * @param {string} code
 */
export async function exchangeCode(code) {
  const response = await fetch(STRAVA_OAUTH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.stravaClientId(),
      client_secret: config.stravaClientSecret(),
      code,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Strava token exchange failed (${response.status}): ${body}`);
  }
  return response.json();
}

/** @param {string} refreshToken */
async function refresh(refreshToken) {
  const response = await fetch(STRAVA_OAUTH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.stravaClientId(),
      client_secret: config.stravaClientSecret(),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Strava token refresh failed (${response.status}): ${body}`);
  }
  return response.json();
}

/**
 * A currently-valid access token for an athlete, refreshing and persisting if
 * the stored one has expired.
 * @param {string} athleteId
 */
export async function accessTokenFor(athleteId) {
  const stored = await getTokens(athleteId);
  if (!stored) {
    const error = new Error('This athlete has not connected Strava.');
    error.code = 'not_connected';
    throw error;
  }

  const expiresAt = Math.floor(new Date(stored.expires_at).getTime() / 1000);
  const now = Math.floor(Date.now() / 1000);
  if (now < expiresAt - REFRESH_MARGIN_SECONDS) return stored.access_token;

  const refreshed = await refresh(stored.refresh_token);
  await saveTokens(athleteId, refreshed);
  return refreshed.access_token;
}

/**
 * @param {string} athleteId
 * @param {string} path
 * @param {Record<string, string | number>} params
 */
async function authorizedGet(athleteId, path, params = {}) {
  const token = await accessTokenFor(athleteId);
  const url = new URL(`${STRAVA_API}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (response.status === 429) {
    const error = new Error('Strava rate limit reached. Try again in a few minutes.');
    error.code = 'rate_limited';
    throw error;
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Strava request to ${path} failed (${response.status}): ${body}`);
  }
  return response.json();
}

/** @param {string} athleteId */
export function fetchAthlete(athleteId) {
  return authorizedGet(athleteId, '/athlete');
}

/**
 * One page of the athlete's activities.
 * @param {string} athleteId
 * @param {{ page?: number, perPage?: number, after?: number }} options
 */
export function fetchActivities(athleteId, options = {}) {
  /** @type {Record<string, string|number>} */
  const params = { page: options.page ?? 1, per_page: options.perPage ?? 100 };
  // `after` is an epoch-seconds cursor, which makes incremental syncs cheap:
  // only activities newer than the last sync come back.
  if (options.after) params.after = options.after;
  return authorizedGet(athleteId, '/athlete/activities', params);
}

/** The URL a browser is sent to in order to start the OAuth flow. */
export function authorizeUrl(redirectUri, state) {
  const url = new URL('https://www.strava.com/oauth/authorize');
  url.searchParams.set('client_id', config.stravaClientId());
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('approval_prompt', 'auto');
  url.searchParams.set('scope', 'read,activity:read_all,profile:read_all');
  url.searchParams.set('state', state);
  return url.toString();
}
