/**
 * Stored activities for the signed-in athlete.
 *
 * Reads from Postgres, not from Strava. The old app re-fetched the athlete's
 * entire history from the Strava API on every page load, which burned the rate
 * limit, made every page slow, and meant nothing worked offline or could be
 * queried by anything other than the browser that held the token.
 */

import { requireSession } from './_lib/session.js';
import { getActivities, rowToActivity } from './_lib/supabase.js';

export default async function handler(req, res) {
  const session = requireSession(req, res);
  if (!session) return;

  try {
    const days = Number(req.query.days ?? 365);
    const limit = Math.min(Number(req.query.limit ?? 1000), 2000);
    const since = Number.isFinite(days) && days > 0
      ? new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      : undefined;

    const rows = await getActivities(session.athleteId, { since, limit });
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.json({ activities: rows.map(rowToActivity), count: rows.length });
  } catch (error) {
    console.error('Failed to load activities:', error);
    res.status(500).json({ error: 'server_error', message: error.message });
  }
}
