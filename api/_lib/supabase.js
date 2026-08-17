/**
 * Supabase access, service-role only.
 *
 * Every table has RLS enabled with no permissive policy for the `anon` or
 * `authenticated` roles, so the database rejects direct reads from a browser
 * outright. All access runs through these serverless functions, which check the
 * session cookie first and scope every query to that athlete. The service-role
 * key never leaves the server.
 */

import { createClient } from '@supabase/supabase-js';
import { config } from './env.js';

let cached = null;

export function supabase() {
  if (!cached) {
    cached = createClient(config.supabaseUrl(), config.supabaseServiceKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

/**
 * Strava tokens for an athlete. Read only on the server, never serialized to a
 * response body.
 * @param {string} athleteId
 */
export async function getTokens(athleteId) {
  const { data, error } = await supabase()
    .from('strava_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('athlete_id', athleteId)
    .maybeSingle();
  if (error) throw new Error(`Failed to read tokens: ${error.message}`);
  return data;
}

/**
 * @param {string} athleteId
 * @param {{ access_token: string, refresh_token: string, expires_at: number }} tokens
 */
export async function saveTokens(athleteId, tokens) {
  const { error } = await supabase().from('strava_tokens').upsert({
    athlete_id: athleteId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: new Date(tokens.expires_at * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Failed to save tokens: ${error.message}`);
}

/** @param {object} athlete Strava athlete payload. */
export async function saveAthlete(athlete) {
  const { error } = await supabase().from('athletes').upsert({
    id: String(athlete.id),
    username: athlete.username ?? null,
    firstname: athlete.firstname ?? null,
    lastname: athlete.lastname ?? null,
    sex: athlete.sex === 'F' ? 'female' : athlete.sex === 'M' ? 'male' : 'unspecified',
    profile_image_url: athlete.profile ?? null,
    weight_kg: athlete.weight ?? null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Failed to save athlete: ${error.message}`);
}

/** @param {string} athleteId */
export async function getAthlete(athleteId) {
  const { data, error } = await supabase()
    .from('athletes')
    .select('id, username, firstname, lastname, sex, profile_image_url, max_heart_rate, resting_heart_rate, birth_year')
    .eq('id', athleteId)
    .maybeSingle();
  if (error) throw new Error(`Failed to read athlete: ${error.message}`);
  return data;
}

/**
 * Activities for an athlete, newest first.
 * @param {string} athleteId
 * @param {{ since?: Date, limit?: number }} options
 */
export async function getActivities(athleteId, options = {}) {
  let query = supabase()
    .from('activities')
    .select(
      'id, name, type, start_date, distance_m, moving_time_s, elapsed_time_s, elevation_gain_m, average_heartrate, max_heartrate, average_speed_mps, is_race',
    )
    .eq('athlete_id', athleteId)
    .order('start_date', { ascending: false })
    .limit(options.limit ?? 1000);

  if (options.since) query = query.gte('start_date', options.since.toISOString());

  const { data, error } = await query;
  if (error) throw new Error(`Failed to read activities: ${error.message}`);
  return data ?? [];
}

/**
 * Upsert a batch of activities. Idempotent on activity id, so a re-sync
 * overlapping previously stored data is safe.
 * @param {string} athleteId
 * @param {object[]} activities Already-normalized `Activity` objects.
 */
export async function saveActivities(athleteId, activities) {
  if (activities.length === 0) return 0;
  const rows = activities.map((a) => ({
    id: a.id,
    athlete_id: athleteId,
    name: a.name,
    type: a.type,
    start_date: a.startDate,
    distance_m: a.distanceMeters,
    moving_time_s: a.movingTimeSeconds,
    elapsed_time_s: a.elapsedTimeSeconds,
    elevation_gain_m: a.totalElevationGainMeters,
    average_heartrate: a.averageHeartrate,
    max_heartrate: a.maxHeartrate,
    average_speed_mps: a.averageSpeedMps,
    is_race: a.isRace ?? false,
    synced_at: new Date().toISOString(),
  }));

  const { error } = await supabase().from('activities').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`Failed to save activities: ${error.message}`);
  return rows.length;
}

/** @param {string} athleteId */
export async function getSyncState(athleteId) {
  const { data, error } = await supabase()
    .from('sync_state')
    .select('athlete_id, last_synced_at, last_activity_date, activity_count')
    .eq('athlete_id', athleteId)
    .maybeSingle();
  if (error) throw new Error(`Failed to read sync state: ${error.message}`);
  return data;
}

/** @param {string} athleteId @param {{ lastActivityDate?: string|null, activityCount: number }} state */
export async function saveSyncState(athleteId, state) {
  const { error } = await supabase().from('sync_state').upsert({
    athlete_id: athleteId,
    last_synced_at: new Date().toISOString(),
    last_activity_date: state.lastActivityDate ?? null,
    activity_count: state.activityCount,
  });
  if (error) throw new Error(`Failed to save sync state: ${error.message}`);
}

/**
 * Map a stored row back onto the `Activity` shape @runman/core expects.
 * @param {object} row
 */
export function rowToActivity(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    startDate: new Date(row.start_date).toISOString(),
    distanceMeters: Number(row.distance_m),
    movingTimeSeconds: Number(row.moving_time_s),
    elapsedTimeSeconds: Number(row.elapsed_time_s),
    totalElevationGainMeters: Number(row.elevation_gain_m ?? 0),
    averageHeartrate: row.average_heartrate === null ? null : Number(row.average_heartrate),
    maxHeartrate: row.max_heartrate === null ? null : Number(row.max_heartrate),
    averageSpeedMps: row.average_speed_mps === null ? null : Number(row.average_speed_mps),
    isRace: Boolean(row.is_race),
  };
}
