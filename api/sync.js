/**
 * Pull activities from Strava into Postgres.
 *
 * Incremental by default: it asks Strava only for activities newer than the last
 * one stored, which keeps a routine sync to a single API call. `?full=1` walks
 * the whole history, which is what a first connection needs.
 */

import { normalizeStravaActivities } from '@runman/core';
import { requireSession } from './_lib/session.js';
import { fetchActivities } from './_lib/strava.js';
import { getSyncState, saveActivities, saveSyncState } from './_lib/supabase.js';

const PER_PAGE = 100;
/** Ceiling on pages per invocation, so one sync cannot run past the function timeout. */
const MAX_PAGES = 20;

export default async function handler(req, res) {
  const session = requireSession(req, res);
  if (!session) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed', message: 'Use POST to trigger a sync.' });
  }

  try {
    const full = req.query.full === '1';
    const state = await getSyncState(session.athleteId);

    // Re-fetch the last stored day as well as everything after it: an activity
    // uploaded late would otherwise fall in the gap between syncs. Upserts make
    // the overlap harmless.
    const after = !full && state?.last_activity_date
      ? Math.floor(new Date(state.last_activity_date).getTime() / 1000) - 86400
      : undefined;

    let page = 1;
    let saved = 0;
    let newest = state?.last_activity_date ?? null;

    while (page <= MAX_PAGES) {
      const raw = await fetchActivities(session.athleteId, { page, perPage: PER_PAGE, after });
      if (!Array.isArray(raw) || raw.length === 0) break;

      const activities = normalizeStravaActivities(raw);
      saved += await saveActivities(session.athleteId, activities);

      for (const activity of activities) {
        if (!newest || activity.startDate > newest) newest = activity.startDate;
      }

      if (raw.length < PER_PAGE) break;
      page += 1;
    }

    const total = (state?.activity_count ?? 0) + saved;
    await saveSyncState(session.athleteId, { lastActivityDate: newest, activityCount: total });

    res.json({
      ok: true,
      synced: saved,
      pagesFetched: page,
      mode: full ? 'full' : 'incremental',
      reachedPageLimit: page > MAX_PAGES,
      lastActivityDate: newest,
    });
  } catch (error) {
    if (error.code === 'rate_limited') {
      return res.status(429).json({ error: 'rate_limited', message: error.message });
    }
    if (error.code === 'not_connected') {
      return res.status(409).json({ error: 'not_connected', message: error.message });
    }
    console.error('Sync failed:', error);
    res.status(500).json({ error: 'server_error', message: error.message });
  }
}
