/**
 * Import activities from a Strava bulk export.
 *
 * The CSV is parsed in the browser, using the same `@runman/core` parser that
 * would run here, and posted as normalized activities in batches. Two reasons.
 * A serverless request body is capped at a few megabytes and a long history
 * exceeds that, so the file has to be chunked somewhere regardless. And parsing
 * client-side keeps the upload to the fields that matter rather than shipping
 * every column of a file that also contains the athlete's descriptions,
 * equipment and private notes.
 *
 * Because the payload is therefore client-supplied, every activity is validated
 * here before it reaches the database. It is the athlete's own data, scoped to
 * their own session, so the threat is malformed input rather than a malicious
 * peer — but a NaN distance would corrupt every calculation downstream just as
 * effectively either way.
 */

import { requireSession } from './_lib/session.js';
import { saveActivities, saveSyncState, supabase } from './_lib/supabase.js';

/** Kept below the serverless body limit with room to spare. */
const MAX_BATCH = 500;

const VALID_TYPES = new Set(['Run', 'TrailRun', 'VirtualRun', 'Ride', 'Swim', 'Walk', 'Hike', 'Other']);

/**
 * @param {unknown} value
 * @returns {{ ok: true, activity: object } | { ok: false, reason: string }}
 */
export function validateActivity(value) {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'not an object' };
  const a = /** @type {Record<string, unknown>} */ (value);

  const id = typeof a.id === 'string' ? a.id.trim() : '';
  if (!id || id.length > 128) return { ok: false, reason: 'missing or oversized id' };

  const startDate = typeof a.startDate === 'string' ? new Date(a.startDate) : new Date(NaN);
  if (Number.isNaN(startDate.getTime())) return { ok: false, reason: 'invalid startDate' };
  // A date far in the future is a parsing failure, not a planned run.
  if (startDate.getTime() > Date.now() + 86400000) return { ok: false, reason: 'startDate is in the future' };

  const number = (key, { min, max, required }) => {
    const raw = a[key];
    if (raw === null || raw === undefined) return required ? null : 0;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
    return parsed;
  };

  const distanceMeters = number('distanceMeters', { min: 0, max: 1_000_000, required: true });
  const movingTimeSeconds = number('movingTimeSeconds', { min: 1, max: 604_800, required: true });
  if (distanceMeters === null || movingTimeSeconds === null) {
    return { ok: false, reason: 'distance or duration out of range' };
  }

  const elapsed = number('elapsedTimeSeconds', { min: 0, max: 604_800, required: false });
  const elevation = number('totalElevationGainMeters', { min: -1000, max: 100_000, required: false });

  const heartRate = (key) => {
    const raw = a[key];
    if (raw === null || raw === undefined) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 30 && parsed <= 230 ? parsed : null;
  };

  const type = typeof a.type === 'string' && VALID_TYPES.has(a.type) ? a.type : 'Other';

  return {
    ok: true,
    activity: {
      id,
      name: typeof a.name === 'string' && a.name.trim() ? a.name.trim().slice(0, 300) : 'Untitled activity',
      type,
      startDate: startDate.toISOString(),
      distanceMeters,
      movingTimeSeconds,
      elapsedTimeSeconds: elapsed ?? movingTimeSeconds,
      totalElevationGainMeters: elevation ?? 0,
      averageHeartrate: heartRate('averageHeartrate'),
      maxHeartrate: heartRate('maxHeartrate'),
      averageSpeedMps: movingTimeSeconds > 0 ? distanceMeters / movingTimeSeconds : null,
      isRace: a.isRace === true,
    },
  };
}

export default async function handler(req, res) {
  const session = requireSession(req, res);
  if (!session) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed', message: 'Use POST.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
    const incoming = Array.isArray(body.activities) ? body.activities : null;

    if (!incoming) {
      return res.status(400).json({ error: 'invalid_request', message: 'Expected an "activities" array.' });
    }
    if (incoming.length > MAX_BATCH) {
      return res.status(413).json({
        error: 'batch_too_large',
        message: `Send at most ${MAX_BATCH} activities per request.`,
      });
    }

    const valid = [];
    const rejected = [];
    for (const candidate of incoming) {
      const result = validateActivity(candidate);
      if (result.ok) valid.push(result.activity);
      else rejected.push({ id: candidate?.id ?? null, reason: result.reason });
    }

    const saved = await saveActivities(session.athleteId, valid);

    // Only the final batch settles the sync state, so a multi-batch import does
    // not report a partial count as the total.
    if (body.final === true) {
      const { count } = await supabase()
        .from('activities')
        .select('*', { count: 'exact', head: true })
        .eq('athlete_id', session.athleteId);

      const newest = valid.reduce(
        (latest, activity) => (!latest || activity.startDate > latest ? activity.startDate : latest),
        body.lastActivityDate ?? null,
      );
      await saveSyncState(session.athleteId, {
        lastActivityDate: newest,
        activityCount: count ?? valid.length,
      });
    }

    res.json({ ok: true, saved, rejected });
  } catch (error) {
    console.error('Import failed:', error);
    res.status(500).json({ error: 'server_error', message: error.message });
  }
}
