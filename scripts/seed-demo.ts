/**
 * Seed a demo athlete.
 *
 * The demo data is the *same* fixture athlete the test suite validates against,
 * not a separate hand-written set. That matters for two reasons: the demo cannot
 * drift away from what the tests prove, and anyone poking at the deployed
 * RunCoach server can check the numbers they get back against the assertions in
 * the repo.
 *
 * The fixture used is `gpsGlitchRunner` — a consistent club runner whose history
 * contains one GPS glitch — because the interesting thing to demonstrate is not
 * that the numbers exist, but that a bad activity gets caught and reported
 * instead of silently poisoning a prediction.
 *
 * Usage: node --experimental-strip-types scripts/seed-demo.ts
 */

import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { gpsGlitchRunner } from '../packages/core/test/fixtures.ts';

const DEMO_ATHLETE_ID = 'demo-athlete';

function loadEnv(): void {
  try {
    for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match && !process.env[match[1]!]) process.env[match[1]!] = match[2]!;
    }
  } catch {
    // Environment may already be populated by the shell; that is fine.
  }
}

async function main(): Promise<void> {
  loadEnv();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { activities, profile } = gpsGlitchRunner();

  // Fixture dates are relative to a fixed clock so tests never drift. Shift them
  // onto today so the demo athlete looks like someone who trained up to now
  // rather than someone who stopped months ago.
  const fixtureNow = new Date('2026-08-17T12:00:00.000Z');
  const offsetMs = Date.now() - fixtureNow.getTime();

  const { error: athleteError } = await supabase.from('athletes').upsert({
    id: DEMO_ATHLETE_ID,
    username: 'demo',
    firstname: 'Demo',
    lastname: 'Athlete',
    sex: profile.sex ?? 'unspecified',
    max_heart_rate: profile.maxHeartRate ?? null,
    resting_heart_rate: profile.restingHeartRate ?? null,
    birth_year: profile.age ? new Date().getUTCFullYear() - profile.age : null,
  });
  if (athleteError) throw new Error(`athlete upsert failed: ${athleteError.message}`);

  const rows = activities.map((activity) => ({
    id: `demo-${activity.id}`,
    athlete_id: DEMO_ATHLETE_ID,
    name: activity.name,
    type: activity.type,
    start_date: new Date(new Date(activity.startDate).getTime() + offsetMs).toISOString(),
    distance_m: activity.distanceMeters,
    moving_time_s: activity.movingTimeSeconds,
    elapsed_time_s: activity.elapsedTimeSeconds,
    elevation_gain_m: activity.totalElevationGainMeters,
    average_heartrate: activity.averageHeartrate,
    max_heartrate: activity.maxHeartrate,
    average_speed_mps: activity.averageSpeedMps,
    is_race: activity.isRace ?? false,
  }));

  // Chunked so a large history does not exceed the request size limit.
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from('activities').upsert(rows.slice(i, i + 200), { onConflict: 'id' });
    if (error) throw new Error(`activity upsert failed: ${error.message}`);
  }

  const latest = rows.reduce((newest, row) => (row.start_date > newest ? row.start_date : newest), rows[0]!.start_date);
  const { error: syncError } = await supabase.from('sync_state').upsert({
    athlete_id: DEMO_ATHLETE_ID,
    last_synced_at: new Date().toISOString(),
    last_activity_date: latest,
    activity_count: rows.length,
  });
  if (syncError) throw new Error(`sync_state upsert failed: ${syncError.message}`);

  // Issue a demo API key, replacing any previous one so re-running the seed does
  // not leave a trail of live credentials behind.
  await supabase.from('api_keys').delete().eq('athlete_id', DEMO_ATHLETE_ID);
  const apiKey = `rc_live_${randomBytes(32).toString('base64url')}`;
  const { error: keyError } = await supabase.from('api_keys').insert({
    athlete_id: DEMO_ATHLETE_ID,
    name: 'Demo key',
    key_hash: createHash('sha256').update(apiKey).digest('hex'),
    key_prefix: apiKey.slice(0, 14),
    scopes: ['read'],
  });
  if (keyError) throw new Error(`api key insert failed: ${keyError.message}`);

  console.log(`Seeded ${rows.length} activities for "${DEMO_ATHLETE_ID}".`);
  console.log(`Demo API key (shown once): ${apiKey}`);
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
