/**
 * Environment access.
 *
 * The pattern being replaced looked like this:
 *
 *   const CLIENT_SECRET = process.env.REACT_APP_STRAVA_CLIENT_SECRET || '42144b...';
 *
 * Two separate problems. The literal fallback put a live credential in public
 * source control and in every browser bundle. And the `||` meant a missing
 * environment variable failed *silently* — the app kept working against the
 * baked-in value, so nobody found out the deployment was misconfigured.
 *
 * Nothing here has a fallback. A missing variable throws at the first request
 * that needs it, loudly and by name.
 */

/** @param {string} name */
export function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable ${name}. Set it in the Vercel project settings ` +
        `(or in .env.local for local development) — there is deliberately no default.`,
    );
  }
  return value;
}

/** @param {string} name @param {string} fallback */
export function optionalEnv(name, fallback) {
  const value = process.env[name];
  return value && value.trim() !== '' ? value : fallback;
}

export const config = {
  /**
   * The client *id* is public by design — it travels in the OAuth redirect URL
   * that the browser follows. The secret never leaves the server.
   */
  stravaClientId: () => requireEnv('STRAVA_CLIENT_ID'),
  stravaClientSecret: () => requireEnv('STRAVA_CLIENT_SECRET'),
  supabaseUrl: () => requireEnv('SUPABASE_URL'),
  supabaseServiceKey: () => requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  sessionSecret: () => requireEnv('SESSION_SECRET'),
  appUrl: () => optionalEnv('APP_URL', 'http://localhost:3000'),
};
