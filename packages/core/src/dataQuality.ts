/**
 * Plausibility screening for individual activities.
 *
 * GPS drift, tunnels, treadmill mis-calibration and forgotten auto-pause all
 * produce activities whose pace is physically impossible. A single one of these
 * used to be enough to poison a race prediction, because the old selector took
 * whichever activity had the fastest pace. Anything used as a *reference effort*
 * has to clear these checks first.
 */

import type { Activity } from './types.ts';

/**
 * Speed of the men's world record at each distance, m/s. Used as a hard ceiling:
 * no recreational runner's real activity sits above this curve, so anything that
 * does is a data error rather than a performance.
 */
const WORLD_RECORD_SPEED_ANCHORS: ReadonlyArray<readonly [meters: number, mps: number]> = [
  [100, 10.44],
  [400, 9.26],
  [800, 7.92],
  [1500, 7.28],
  [1609.34, 7.2],
  [5000, 6.61],
  [10000, 6.36],
  [21097.5, 6.11],
  [42195, 5.83],
  [100000, 5.1],
];

/**
 * Fastest speed physically credible over `meters`, log-interpolated between the
 * world-record anchors. Beyond the anchor range the nearest anchor is held.
 */
export function worldRecordSpeedMps(meters: number): number {
  const first = WORLD_RECORD_SPEED_ANCHORS[0]!;
  const last = WORLD_RECORD_SPEED_ANCHORS[WORLD_RECORD_SPEED_ANCHORS.length - 1]!;
  if (meters <= first[0]) return first[1];
  if (meters >= last[0]) return last[1];

  for (let i = 1; i < WORLD_RECORD_SPEED_ANCHORS.length; i++) {
    const lo = WORLD_RECORD_SPEED_ANCHORS[i - 1]!;
    const hi = WORLD_RECORD_SPEED_ANCHORS[i]!;
    if (meters <= hi[0]) {
      const t = (Math.log(meters) - Math.log(lo[0])) / (Math.log(hi[0]) - Math.log(lo[0]));
      return lo[1] + t * (hi[1] - lo[1]);
    }
  }
  return last[1];
}

export type QualityFlag =
  | 'ok'
  | 'too_short'
  | 'zero_duration'
  | 'faster_than_world_record'
  | 'implausibly_slow'
  | 'heavy_autopause';

export interface QualityAssessment {
  usableAsReference: boolean;
  flags: QualityFlag[];
  speedMps: number;
  /** Activity speed as a fraction of the world record at the same distance. */
  worldRecordFraction: number;
}

/** Under this the distance is too short for pace to mean anything. */
const MIN_REFERENCE_DISTANCE_M = 800;
/** Slower than roughly a brisk walk — almost always a hike logged as a run. */
const MIN_PLAUSIBLE_SPEED_MPS = 1.6;

export function assessActivity(activity: Activity): QualityAssessment {
  const flags: QualityFlag[] = [];
  const { distanceMeters, movingTimeSeconds, elapsedTimeSeconds } = activity;

  if (movingTimeSeconds <= 0) {
    return { usableAsReference: false, flags: ['zero_duration'], speedMps: 0, worldRecordFraction: 0 };
  }

  const speedMps = distanceMeters / movingTimeSeconds;
  const wr = worldRecordSpeedMps(Math.max(distanceMeters, 1));
  const worldRecordFraction = speedMps / wr;

  if (distanceMeters < MIN_REFERENCE_DISTANCE_M) flags.push('too_short');
  if (speedMps > wr) flags.push('faster_than_world_record');
  if (speedMps < MIN_PLAUSIBLE_SPEED_MPS) flags.push('implausibly_slow');

  // Auto-pause that swallowed most of the run makes `movingTime` a fiction:
  // the recorded pace describes a handful of fast segments, not the effort.
  if (elapsedTimeSeconds > 0 && movingTimeSeconds / elapsedTimeSeconds < 0.6) {
    flags.push('heavy_autopause');
  }

  if (flags.length === 0) flags.push('ok');

  return {
    usableAsReference: flags.length === 1 && flags[0] === 'ok',
    flags,
    speedMps,
    worldRecordFraction,
  };
}

export interface ScreenResult {
  usable: Activity[];
  rejected: Array<{ activity: Activity; flags: QualityFlag[] }>;
}

/** Split activities into those fit to serve as reference efforts and those not. */
export function screenActivities(activities: readonly Activity[]): ScreenResult {
  const usable: Activity[] = [];
  const rejected: ScreenResult['rejected'] = [];
  for (const activity of activities) {
    const assessment = assessActivity(activity);
    if (assessment.usableAsReference) usable.push(activity);
    else rejected.push({ activity, flags: assessment.flags });
  }
  return { usable, rejected };
}

export function describeFlag(flag: QualityFlag): string {
  switch (flag) {
    case 'ok':
      return 'no issues detected';
    case 'too_short':
      return 'shorter than 800m, too short for a meaningful pace';
    case 'zero_duration':
      return 'no recorded moving time';
    case 'faster_than_world_record':
      return 'recorded pace is faster than the world record at that distance (GPS or device error)';
    case 'implausibly_slow':
      return 'slower than a brisk walk, likely a hike or a stopped watch';
    case 'heavy_autopause':
      return 'auto-pause removed more than 40% of elapsed time, so the pace is not representative';
  }
}
