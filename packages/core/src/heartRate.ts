/**
 * Heart-rate zones, derived per athlete.
 *
 * The previous implementation bucketed every runner at the same fixed bpm
 * thresholds (<130 easy, <150 aerobic, <170 tempo, 170+ hard). Those numbers
 * describe one specific athlete. For a 25-year-old with a max of 199 they call
 * a genuine easy run "tempo"; for a 60-year-old with a max of 165 they never
 * register a hard effort at all. Zones only mean anything relative to the
 * individual's own maximum.
 */

import type { Activity, AthleteProfile, Confidence, Derived } from './types.ts';

export type ZoneName = 'Z1 Recovery' | 'Z2 Endurance' | 'Z3 Tempo' | 'Z4 Threshold' | 'Z5 VO2max';

export interface HeartRateZone {
  name: ZoneName;
  index: 1 | 2 | 3 | 4 | 5;
  minBpm: number;
  maxBpm: number;
  /** Lower bound as a fraction of max HR (or of heart-rate reserve, if Karvonen). */
  lowerFraction: number;
  upperFraction: number;
  description: string;
}

/**
 * Fractional bounds. Applied to heart-rate *reserve* when a resting HR is known
 * (Karvonen), otherwise to max HR directly — the two scales are not
 * interchangeable, which is why the basis is reported alongside the zones.
 */
const ZONE_BOUNDS: ReadonlyArray<{ name: ZoneName; index: 1 | 2 | 3 | 4 | 5; lower: number; upper: number; description: string }> = [
  { name: 'Z1 Recovery', index: 1, lower: 0.5, upper: 0.6, description: 'Active recovery. Conversational with no effort at all.' },
  { name: 'Z2 Endurance', index: 2, lower: 0.6, upper: 0.7, description: 'Aerobic base. Where the bulk of weekly volume belongs.' },
  { name: 'Z3 Tempo', index: 3, lower: 0.7, upper: 0.8, description: 'Steady/marathon effort. Comfortably hard.' },
  { name: 'Z4 Threshold', index: 4, lower: 0.8, upper: 0.9, description: 'Lactate threshold. Sustainable for roughly an hour.' },
  { name: 'Z5 VO2max', index: 5, lower: 0.9, upper: 1.0, description: 'Maximal aerobic effort. Intervals only.' },
];

export type MaxHrBasis = 'profile' | 'observed' | 'age_estimate';

/**
 * Establish the athlete's max HR, preferring evidence over estimation:
 *   1. a value they entered themselves,
 *   2. the highest plausible max HR their device has actually recorded,
 *   3. the Tanaka age formula (211 − 0.64 × age), which carries a standard
 *      deviation of about 7 bpm and is a last resort.
 * Returns null rather than inventing a number when there is nothing to go on.
 */
export function deriveMaxHeartRate(
  activities: readonly Activity[],
  profile: AthleteProfile = {},
): Derived<number> | null {
  if (profile.maxHeartRate && profile.maxHeartRate >= 120 && profile.maxHeartRate <= 230) {
    return {
      value: profile.maxHeartRate,
      method: 'profile',
      confidence: 'high',
      explanation: `Using the max heart rate of ${profile.maxHeartRate} bpm on the athlete profile.`,
    };
  }

  const observed = activities
    .map((a) => a.maxHeartrate ?? 0)
    .filter((hr) => hr >= 120 && hr <= 230)
    .sort((a, b) => b - a);

  if (observed.length > 0) {
    // The single highest sample is often a strap spike, so take the highest of
    // the top few readings that the rest of that group corroborates.
    const top = observed.slice(0, Math.min(5, observed.length));
    const median = top[Math.floor(top.length / 2)]!;
    const best = top.find((hr) => hr - median <= 10) ?? median;
    return {
      value: best,
      method: 'observed',
      confidence: observed.length >= 5 ? 'high' : 'medium',
      explanation:
        `Highest corroborated heart rate recorded across ${observed.length} activities: ${best} bpm. ` +
        `Enter a tested max HR on your profile to improve this.`,
    };
  }

  if (profile.age && profile.age > 0 && profile.age < 100) {
    const estimate = Math.round(211 - 0.64 * profile.age);
    return {
      value: estimate,
      method: 'age_estimate',
      confidence: 'low',
      explanation:
        `No heart-rate data available, so max HR is estimated from age ${profile.age} ` +
        `using the Tanaka formula (211 − 0.64 × age) = ${estimate} bpm. This is accurate to roughly ±7 bpm.`,
    };
  }

  return null;
}

export interface ZoneSet {
  zones: HeartRateZone[];
  maxHeartRate: number;
  restingHeartRate: number | null;
  /** `hrr` = Karvonen (heart-rate reserve); `pct_max` = percentage of max HR. */
  scale: 'hrr' | 'pct_max';
  confidence: Confidence;
  explanation: string;
}

export function heartRateZones(
  activities: readonly Activity[],
  profile: AthleteProfile = {},
): ZoneSet | null {
  const max = deriveMaxHeartRate(activities, profile);
  if (!max) return null;

  const rest = profile.restingHeartRate && profile.restingHeartRate >= 30 && profile.restingHeartRate < max.value
    ? profile.restingHeartRate
    : null;

  const scale: 'hrr' | 'pct_max' = rest ? 'hrr' : 'pct_max';
  const toBpm = (fraction: number): number =>
    rest ? Math.round(rest + fraction * (max.value - rest)) : Math.round(fraction * max.value);

  const zones = ZONE_BOUNDS.map((bound) => ({
    name: bound.name,
    index: bound.index,
    minBpm: toBpm(bound.lower),
    maxBpm: toBpm(bound.upper),
    lowerFraction: bound.lower,
    upperFraction: bound.upper,
    description: bound.description,
  }));

  return {
    zones,
    maxHeartRate: max.value,
    restingHeartRate: rest,
    scale,
    confidence: max.confidence,
    explanation:
      `${max.explanation} Zones are ${scale === 'hrr' ? `Karvonen heart-rate reserve bands against a resting HR of ${rest} bpm` : 'percentages of max HR'}.`,
  };
}

/** Which zone an activity's average heart rate falls in, or null without HR data. */
export function classifyActivity(activity: Activity, zoneSet: ZoneSet): HeartRateZone | null {
  const hr = activity.averageHeartrate;
  if (!hr || hr <= 0) return null;
  for (const zone of zoneSet.zones) {
    if (hr < zone.maxBpm) return zone;
  }
  return zoneSet.zones[zoneSet.zones.length - 1]!;
}

/**
 * Fraction of heart-rate reserve an activity sat at — the input to TRIMP.
 * Falls back to a plain fraction of max HR when no resting HR is known.
 */
export function heartRateReserveFraction(
  averageHeartrate: number,
  maxHeartRate: number,
  restingHeartRate: number | null,
): number {
  const rest = restingHeartRate ?? 0;
  const denominator = maxHeartRate - rest;
  if (denominator <= 0) return 0;
  return Math.min(1, Math.max(0, (averageHeartrate - rest) / denominator));
}
