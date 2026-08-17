/**
 * Strava → domain normalization.
 *
 * Vendor field names stop here. Everything downstream works on `Activity`, which
 * means adding a second data source later (Garmin, a manual import) is a new
 * mapper rather than a change to the science code.
 */

import type { Activity, ActivityType } from './types.ts';

/** The subset of Strava's SummaryActivity this project actually uses. */
export interface StravaSummaryActivity {
  id: number | string;
  name?: string;
  type?: string;
  sport_type?: string;
  start_date?: string;
  start_date_local?: string;
  distance?: number;
  moving_time?: number;
  elapsed_time?: number;
  total_elevation_gain?: number;
  average_heartrate?: number | null;
  max_heartrate?: number | null;
  average_speed?: number | null;
  workout_type?: number | null;
}

const TYPE_MAP: Record<string, ActivityType> = {
  Run: 'Run',
  TrailRun: 'TrailRun',
  VirtualRun: 'VirtualRun',
  Ride: 'Ride',
  VirtualRide: 'Ride',
  Swim: 'Swim',
  Walk: 'Walk',
  Hike: 'Hike',
};

/** Strava encodes "this was a race" as workout_type 1 for runs. */
const RACE_WORKOUT_TYPE = 1;

export function normalizeStravaActivity(raw: StravaSummaryActivity): Activity {
  const sportType = raw.sport_type ?? raw.type ?? 'Other';
  const distanceMeters = raw.distance ?? 0;
  const movingTimeSeconds = raw.moving_time ?? 0;

  return {
    id: String(raw.id),
    name: raw.name ?? 'Untitled activity',
    type: TYPE_MAP[sportType] ?? 'Other',
    // `start_date` is the UTC instant; `start_date_local` has no offset and would
    // silently shift every calendar bucket by the athlete's timezone.
    startDate: raw.start_date ?? raw.start_date_local ?? new Date(0).toISOString(),
    distanceMeters,
    movingTimeSeconds,
    elapsedTimeSeconds: raw.elapsed_time ?? movingTimeSeconds,
    totalElevationGainMeters: raw.total_elevation_gain ?? 0,
    averageHeartrate: raw.average_heartrate ?? null,
    maxHeartrate: raw.max_heartrate ?? null,
    averageSpeedMps: raw.average_speed ?? (movingTimeSeconds > 0 ? distanceMeters / movingTimeSeconds : null),
    isRace: raw.workout_type === RACE_WORKOUT_TYPE,
  };
}

export function normalizeStravaActivities(raw: readonly StravaSummaryActivity[]): Activity[] {
  return raw.map(normalizeStravaActivity);
}
