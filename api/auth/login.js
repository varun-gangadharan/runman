/**
 * Start the Strava OAuth flow.
 *
 * The browser never sees the client secret — it only follows a redirect to
 * Strava carrying the public client id. The CSRF `state` is signed with the same
 * session secret, so a callback carrying a state we did not issue is rejected.
 */

import { createHmac, randomBytes } from 'node:crypto';
import { config } from '../_lib/env.js';
import { authorizeUrl } from '../_lib/strava.js';
import { cookieAttributes } from '../_lib/session.js';

export default function handler(req, res) {
  try {
    const nonce = randomBytes(16).toString('base64url');
    const signature = createHmac('sha256', config.sessionSecret()).update(nonce).digest('base64url');
    const state = `${nonce}.${signature}`;

    const redirectUri = `${config.appUrl()}/api/auth/callback`;

    // The state cookie is short-lived and exists only to survive the round trip
    // to Strava and back.
    res.setHeader('Set-Cookie', `runman_oauth_state=${state}; ${cookieAttributes({ maxAgeSeconds: 600 })}`);
    res.redirect(302, authorizeUrl(redirectUri, state));
  } catch (error) {
    res.status(500).json({ error: 'configuration_error', message: error.message });
  }
}
