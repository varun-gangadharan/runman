/**
 * Training volume over real calendar windows.
 *
 * The bug this replaces: `activities.slice(0, 30).reduce(sum of distance) / 4`,
 * labelled "average weekly distance over the last 4 weeks". It is neither. The
 * most recent 30 activities might span six weeks or six months, and dividing by
 * a hardcoded 4 makes the answer wrong by exactly the amount the runner's
 * frequency deviates from 7.5 runs a week. A runner returning from injury with
 * 30 activities spread over a year was being told they average 40 km/week.
 *
 * Volume is only meaningful against elapsed calendar time.
 */

import { addDays, isoWeekKey, startOfIsoWeek, toDayKey, daysBetween } from './time.ts';
import { isRun, type Activity } from './types.ts';

export interface WeeklyVolume {
  /** ISO week key, e.g. `2026-W33`. */
  week: string;
  /** UTC midnight on the Monday starting the week. */
  weekStart: string;
  distanceMeters: number;
  movingTimeSeconds: number;
  elevationGainMeters: number;
  activityCount: number;
  longestRunMeters: number;
  /** False for the first and last weeks when the window cuts them short. */
  isComplete: boolean;
}

export interface VolumeOptions {
  endDate?: Date;
  /** Number of complete weeks to report. */
  weeks?: number;
  /** Restrict to running activities. Defaults to true. */
  runsOnly?: boolean;
}

/**
 * Per-ISO-week volume, including weeks in which the athlete did nothing.
 * A zero-volume week is a fact about training, not an absence of data.
 */
export function weeklyVolume(activities: readonly Activity[], options: VolumeOptions = {}): WeeklyVolume[] {
  const weeks = options.weeks ?? 12;
  const runsOnly = options.runsOnly ?? true;
  const pool = runsOnly ? activities.filter(isRun) : [...activities];
  if (pool.length === 0) return [];

  const endDate = options.endDate ?? new Date(
    Math.max(...pool.map((a) => new Date(a.startDate).getTime())),
  );
  const lastWeekStart = startOfIsoWeek(endDate);
  const firstWeekStart = addDays(lastWeekStart, -7 * (weeks - 1));

  const buckets = new Map<string, WeeklyVolume>();
  for (let i = 0; i < weeks; i++) {
    const weekStart = addDays(firstWeekStart, 7 * i);
    buckets.set(isoWeekKey(weekStart), {
      week: isoWeekKey(weekStart),
      weekStart: toDayKey(weekStart),
      distanceMeters: 0,
      movingTimeSeconds: 0,
      elevationGainMeters: 0,
      activityCount: 0,
      longestRunMeters: 0,
      // The final week is only complete once its Sunday has passed.
      isComplete: i < weeks - 1 || daysBetween(weekStart, endDate) >= 6,
    });
  }

  for (const activity of pool) {
    const key = isoWeekKey(activity.startDate);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.distanceMeters += activity.distanceMeters;
    bucket.movingTimeSeconds += activity.movingTimeSeconds;
    bucket.elevationGainMeters += activity.totalElevationGainMeters;
    bucket.activityCount += 1;
    bucket.longestRunMeters = Math.max(bucket.longestRunMeters, activity.distanceMeters);
  }

  return [...buckets.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

export interface RollingVolume {
  windowDays: number;
  startDate: string;
  endDate: string;
  distanceMeters: number;
  movingTimeSeconds: number;
  activityCount: number;
  /** Distance divided by the window length, scaled to seven days. */
  averageWeeklyDistanceMeters: number;
  /** Distinct days on which the athlete ran, out of `windowDays`. */
  runDays: number;
  longestRunMeters: number;
}

/**
 * Volume over the last `windowDays` calendar days ending at `endDate`.
 * This is the honest version of "current weekly mileage": it divides by elapsed
 * days, so a fortnight off drags the average down exactly as it should.
 */
export function rollingVolume(
  activities: readonly Activity[],
  options: { endDate?: Date; windowDays?: number; runsOnly?: boolean } = {},
): RollingVolume {
  const windowDays = options.windowDays ?? 28;
  const runsOnly = options.runsOnly ?? true;
  const pool = runsOnly ? activities.filter(isRun) : [...activities];

  const endDate = options.endDate ?? (pool.length > 0
    ? new Date(Math.max(...pool.map((a) => new Date(a.startDate).getTime())))
    : new Date());
  const startDate = addDays(endDate, -(windowDays - 1));
  const startKey = toDayKey(startDate);
  const endKey = toDayKey(endDate);

  const inWindow = pool.filter((a) => {
    const key = toDayKey(a.startDate);
    return key >= startKey && key <= endKey;
  });

  const distanceMeters = inWindow.reduce((sum, a) => sum + a.distanceMeters, 0);
  const movingTimeSeconds = inWindow.reduce((sum, a) => sum + a.movingTimeSeconds, 0);
  const runDays = new Set(inWindow.map((a) => toDayKey(a.startDate))).size;

  return {
    windowDays,
    startDate: startKey,
    endDate: endKey,
    distanceMeters,
    movingTimeSeconds,
    activityCount: inWindow.length,
    averageWeeklyDistanceMeters: (distanceMeters / windowDays) * 7,
    runDays,
    longestRunMeters: inWindow.reduce((max, a) => Math.max(max, a.distanceMeters), 0),
  };
}

export interface ConsistencyReport {
  windowDays: number;
  /** Fraction of weeks in the window with at least one run, 0–1. */
  activeWeekRatio: number;
  /** Fraction of days in the window with at least one run, 0–1. */
  runDayRatio: number;
  /** Longest run of consecutive days with no activity. */
  longestGapDays: number;
  /** Coefficient of variation of weekly distance. Lower is steadier. */
  weeklyVariation: number;
  averageRunsPerWeek: number;
}

/** How reliably the athlete has been training — the input to a readiness read. */
export function consistency(
  activities: readonly Activity[],
  options: { endDate?: Date; windowDays?: number } = {},
): ConsistencyReport {
  const windowDays = options.windowDays ?? 84;
  const runs = activities.filter(isRun);
  const endDate = options.endDate ?? (runs.length > 0
    ? new Date(Math.max(...runs.map((a) => new Date(a.startDate).getTime())))
    : new Date());
  const startDate = addDays(endDate, -(windowDays - 1));
  const startKey = toDayKey(startDate);
  const endKey = toDayKey(endDate);

  const inWindow = runs
    .filter((a) => toDayKey(a.startDate) >= startKey && toDayKey(a.startDate) <= endKey)
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

  const weeks = Math.max(1, Math.round(windowDays / 7));
  const perWeek = weeklyVolume(runs, { endDate, weeks });
  const activeWeeks = perWeek.filter((w) => w.activityCount > 0).length;
  const runDays = new Set(inWindow.map((a) => toDayKey(a.startDate)));

  const weekDistances = perWeek.map((w) => w.distanceMeters);
  const meanWeek = weekDistances.reduce((s, d) => s + d, 0) / Math.max(1, weekDistances.length);
  const variance =
    weekDistances.reduce((s, d) => s + (d - meanWeek) ** 2, 0) / Math.max(1, weekDistances.length);
  const weeklyVariation = meanWeek > 0 ? Math.sqrt(variance) / meanWeek : 0;

  let longestGapDays = 0;
  let previous = startDate;
  for (const activity of inWindow) {
    longestGapDays = Math.max(longestGapDays, daysBetween(previous, activity.startDate));
    previous = new Date(activity.startDate);
  }
  longestGapDays = Math.max(longestGapDays, daysBetween(previous, endDate));

  return {
    windowDays,
    activeWeekRatio: perWeek.length > 0 ? activeWeeks / perWeek.length : 0,
    runDayRatio: runDays.size / windowDays,
    longestGapDays,
    weeklyVariation: Math.round(weeklyVariation * 100) / 100,
    averageRunsPerWeek: Math.round((inWindow.length / (windowDays / 7)) * 10) / 10,
  };
}
