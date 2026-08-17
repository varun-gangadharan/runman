/** The signed-in athlete's profile, or 401. Never returns Strava tokens. */

import { requireSession } from '../_lib/session.js';
import { getAthlete, getSyncState } from '../_lib/supabase.js';

export default async function handler(req, res) {
  const session = requireSession(req, res);
  if (!session) return;

  try {
    const [athlete, sync] = await Promise.all([
      getAthlete(session.athleteId),
      getSyncState(session.athleteId),
    ]);

    if (!athlete) {
      return res.status(404).json({ error: 'not_found', message: 'No athlete record for this session.' });
    }

    res.json({
      athlete: {
        id: athlete.id,
        username: athlete.username,
        firstName: athlete.firstname,
        lastName: athlete.lastname,
        sex: athlete.sex,
        profileImageUrl: athlete.profile_image_url,
        maxHeartRate: athlete.max_heart_rate,
        restingHeartRate: athlete.resting_heart_rate,
        birthYear: athlete.birth_year,
      },
      sync: sync
        ? { lastSyncedAt: sync.last_synced_at, lastActivityDate: sync.last_activity_date, activityCount: sync.activity_count }
        : null,
    });
  } catch (error) {
    console.error('Failed to load athlete:', error);
    res.status(500).json({ error: 'server_error', message: error.message });
  }
}
