/**
 * Shared domain types.
 *
 * Everything in this package works on `Activity` — a normalized, provider-agnostic
 * shape. Strava's raw payload is mapped into it by `normalizeStravaActivity`
 * (see `strava.ts`) so the science code never touches vendor field names.
 */

export type ActivityType = 'Run' | 'TrailRun' | 'VirtualRun' | 'Ride' | 'Swim' | 'Walk' | 'Hike' | 'Other';

export type Sex = 'male' | 'female' | 'unspecified';

export interface Activity {
  /** Stable provider id. */
  id: string;
  name: string;
  type: ActivityType;
  /** ISO-8601 instant the activity started. */
  startDate: string;
  distanceMeters: number;
  movingTimeSeconds: number;
  elapsedTimeSeconds: number;
  totalElevationGainMeters: number;
  averageHeartrate?: number | null;
  maxHeartrate?: number | null;
  /** Strava's `average_speed`, m/s. Derived from distance/time when absent. */
  averageSpeedMps?: number | null;
  /** True when the athlete flagged this as a race. Raises reference-effort quality. */
  isRace?: boolean;
}

export interface AthleteProfile {
  id?: string;
  sex?: Sex;
  /** Years. Only used as a last-resort fallback for max HR. */
  age?: number | null;
  /** Lab- or field-measured max HR, if the athlete supplied one. */
  maxHeartRate?: number | null;
  restingHeartRate?: number | null;
}

/**
 * How a number was arrived at. Every computation in this package reports one so
 * that a consumer (the web UI, or an LLM tool response) can say *why* it trusts
 * a number instead of presenting a guess as a measurement.
 */
export type Confidence = 'high' | 'medium' | 'low' | 'none';

export interface Provenance {
  /** Machine-readable identifier for the algorithm branch that produced the value. */
  method: string;
  confidence: Confidence;
  /** Human-readable justification, safe to surface directly to a user. */
  explanation: string;
}

/** A value that always carries the story of how it was computed. */
export interface Derived<T> extends Provenance {
  value: T;
}

export const RUN_TYPES: readonly ActivityType[] = ['Run', 'TrailRun', 'VirtualRun'];

export function isRun(activity: Activity): boolean {
  return RUN_TYPES.includes(activity.type);
}

/** Metres. Canonical race distances, used for reference-effort matching. */
export const STANDARD_DISTANCES = [
  { label: '800m', meters: 800 },
  { label: '1500m', meters: 1500 },
  { label: '1 mile', meters: 1609.34 },
  { label: '3K', meters: 3000 },
  { label: '5K', meters: 5000 },
  { label: '10K', meters: 10000 },
  { label: '15K', meters: 15000 },
  { label: '10 mile', meters: 16093.4 },
  { label: '20K', meters: 20000 },
  { label: 'Half Marathon', meters: 21097.5 },
  { label: '30K', meters: 30000 },
  { label: 'Marathon', meters: 42195 },
  { label: '50K', meters: 50000 },
] as const;
