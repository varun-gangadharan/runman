/**
 * Clear the session cookie.
 *
 * Deliberately does not delete the stored Strava tokens: signing out of this
 * browser is not the same as revoking access, and silently revoking would break
 * any API key the athlete has issued to RunCoach. Disconnecting Strava entirely
 * is a separate, explicit action.
 */

import { clearSessionCookie } from '../_lib/session.js';

export default function handler(req, res) {
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.json({ ok: true });
}
