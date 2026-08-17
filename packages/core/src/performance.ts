/**
 * Performance modelling: best efforts and the athlete's personal
 * distance/time power law.
 *
 * Riegel's formula `T2 = T1 × (D2/D1)^1.06` is the standard back-of-envelope
 * race predictor, and 1.06 is a population average. An athlete with a deep
 * aerobic base has a flatter exponent (they hold pace better as distance grows);
 * a speed-biased athlete has a steeper one. When there is enough data we fit the
 * exponent to *this* runner instead of assuming the population value, which is
 * both more accurate and reportable — the fitted exponent is itself a useful
 * training insight.
 */

import { screenActivities } from './dataQuality.ts';
import { STANDARD_DISTANCES, isRun, type Activity } from './types.ts';

/** The population-average Riegel exponent, used when a personal fit isn't possible. */
export const DEFAULT_RIEGEL_EXPONENT = 1.06;

/** A fitted exponent outside this range means noisy data, not an unusual athlete. */
const MIN_PLAUSIBLE_EXPONENT = 1.0;
const MAX_PLAUSIBLE_EXPONENT = 1.3;

export interface BestEffort {
  label: string;
  nominalDistanceMeters: number;
  activityId: string;
  activityName: string;
  date: string;
  actualDistanceMeters: number;
  timeSeconds: number;
  speedMps: number;
  paceSecondsPerKm: number;
  isRace: boolean;
}

export interface BestEffortOptions {
  /** Only consider activities on or after this instant. */
  since?: Date;
  now?: Date;
}

/**
 * Roughly log-spaced distance bands, in metres. Real runners almost never cover
 * exactly 5.00 km, and requiring a near-exact match against nominal race
 * distances discards most of a history — a runner whose every run is 6 km would
 * produce no reference efforts at all, and every downstream calculation would
 * report "insufficient data" for someone with two years of training on file.
 * Banding keeps one representative effort per distance scale, which is what the
 * power-law fit actually needs.
 */
const DISTANCE_BANDS: ReadonlyArray<readonly [min: number, maxExclusive: number]> = [
  [800, 1200],
  [1200, 1800],
  [1800, 2600],
  [2600, 4000],
  [4000, 6000],
  [6000, 8500],
  [8500, 12000],
  [12000, 17000],
  [17000, 24000],
  [24000, 34000],
  [34000, 50000],
  [50000, Number.POSITIVE_INFINITY],
];

/** Name a distance after the standard race it is within 5% of, else by its length. */
function labelDistance(meters: number): string {
  const match = STANDARD_DISTANCES.find((d) => Math.abs(d.meters - meters) / d.meters <= 0.05);
  return match ? match.label : `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Fastest credible run in each distance band.
 *
 * This matches whole activities rather than scanning splits — Strava's summary
 * payload has no split data, and inventing a "best 5K inside a 10K run" from an
 * average pace would be fiction. Note that the fastest run in a band is not
 * necessarily a maximal effort; `fitPowerLaw` trims the ones that are clearly
 * training runs rather than efforts.
 */
export function findBestEfforts(
  activities: readonly Activity[],
  options: BestEffortOptions = {},
): BestEffort[] {
  const { usable } = screenActivities(activities.filter(isRun));
  const inWindow = options.since
    ? usable.filter((a) => new Date(a.startDate) >= options.since!)
    : usable;

  const efforts: BestEffort[] = [];
  for (const [min, max] of DISTANCE_BANDS) {
    const candidates = inWindow.filter((a) => a.distanceMeters >= min && a.distanceMeters < max);
    if (candidates.length === 0) continue;

    const best = candidates.reduce((fastest, a) => {
      const aSpeed = a.distanceMeters / a.movingTimeSeconds;
      const bestSpeed = fastest.distanceMeters / fastest.movingTimeSeconds;
      // A flagged race beats a faster training run of the same scale: it is the
      // effort the athlete actually raced, and it carries a real date and name.
      if (a.isRace && !fastest.isRace) return aSpeed >= bestSpeed * 0.97 ? a : fastest;
      if (!a.isRace && fastest.isRace) return aSpeed > bestSpeed / 0.97 ? a : fastest;
      return aSpeed > bestSpeed ? a : fastest;
    });

    efforts.push({
      label: labelDistance(best.distanceMeters),
      nominalDistanceMeters: best.distanceMeters,
      activityId: best.id,
      activityName: best.name,
      date: best.startDate,
      actualDistanceMeters: best.distanceMeters,
      timeSeconds: best.movingTimeSeconds,
      speedMps: best.distanceMeters / best.movingTimeSeconds,
      paceSecondsPerKm: (best.movingTimeSeconds / best.distanceMeters) * 1000,
      isRace: best.isRace ?? false,
    });
  }
  return efforts;
}

export interface PowerLawFit {
  /** `T = coefficient × D^exponent`, with D in metres and T in seconds. */
  coefficient: number;
  exponent: number;
  /** Coefficient of determination of the log-log regression, 0–1. */
  rSquared: number;
  pointsUsed: number;
  efforts: BestEffort[];
}

/**
 * How much slower than the fitted curve a point may sit before it is treated as
 * an ordinary training run rather than a best effort. 4% is wider than race-day
 * variation and narrower than the gap between racing and jogging.
 */
const ENVELOPE_TOLERANCE = 0.04;

/**
 * Least-squares fit of `ln T = ln a + b ln D` across the athlete's best efforts,
 * trimmed to the lower envelope of the distance/time cloud.
 *
 * The trimming matters. `findBestEfforts` returns the fastest activity *near*
 * each standard distance, but "nearest 16 km run" is not the same as "10-mile
 * best effort" — for most runners it is a long slow Sunday run that happens to
 * land at that distance. Left in, it drags the fitted exponent upward and makes
 * the athlete look like they fade far worse with distance than they do. Genuine
 * best efforts define the *lower* edge of the cloud, so points sitting well
 * above the curve are dropped and the curve refitted.
 *
 * Returns null when fewer than three distinct distances survive, or when the
 * fitted exponent lands outside the physiologically plausible range.
 */
export function fitPowerLaw(efforts: readonly BestEffort[]): PowerLawFit | null {
  let points = efforts.filter((e) => e.timeSeconds > 0 && e.actualDistanceMeters > 0);
  if (points.length < 3) return null;

  // Trim one point at a time so a single bad outlier cannot take a good one with
  // it, and never below the three points a fit needs.
  for (let pass = 0; pass < points.length; pass++) {
    const candidate = leastSquaresLogFit(points);
    if (!candidate || points.length <= 3) break;

    let worstIndex = -1;
    let worstResidual = ENVELOPE_TOLERANCE;
    points.forEach((effort, index) => {
      const predicted = candidate.coefficient * Math.pow(effort.actualDistanceMeters, candidate.exponent);
      const residual = Math.log(effort.timeSeconds) - Math.log(predicted);
      if (residual > worstResidual) {
        worstResidual = residual;
        worstIndex = index;
      }
    });
    if (worstIndex === -1) break;
    points = points.filter((_, index) => index !== worstIndex);
  }

  const fit = leastSquaresLogFit(points);
  if (!fit) return null;
  if (fit.exponent < MIN_PLAUSIBLE_EXPONENT || fit.exponent > MAX_PLAUSIBLE_EXPONENT) return null;
  return fit;
}

function leastSquaresLogFit(points: readonly BestEffort[]): PowerLawFit | null {
  if (points.length < 3) return null;

  const xs = points.map((e) => Math.log(e.actualDistanceMeters));
  const ys = points.map((e) => Math.log(e.timeSeconds));
  const n = points.length;
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;

  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - meanX) * (ys[i]! - meanY);
    sxx += (xs[i]! - meanX) ** 2;
  }
  if (sxx === 0) return null;

  const exponent = sxy / sxx;
  const intercept = meanY - exponent * meanX;

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const predicted = intercept + exponent * xs[i]!;
    ssRes += (ys[i]! - predicted) ** 2;
    ssTot += (ys[i]! - meanY) ** 2;
  }
  const rSquared = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  return {
    coefficient: Math.exp(intercept),
    exponent,
    rSquared,
    pointsUsed: n,
    efforts: [...points],
  };
}

/** Predicted seconds to cover `meters` under a fitted power law. */
export function predictFromFit(fit: PowerLawFit, meters: number): number {
  return fit.coefficient * Math.pow(meters, fit.exponent);
}

/** Riegel scaling from a single reference effort. */
export function riegel(
  referenceTimeSeconds: number,
  referenceMeters: number,
  targetMeters: number,
  exponent: number = DEFAULT_RIEGEL_EXPONENT,
): number {
  return referenceTimeSeconds * Math.pow(targetMeters / referenceMeters, exponent);
}

export interface ThresholdSpeed {
  /** Speed the athlete could hold for one hour, m/s. */
  speedMps: number;
  paceSecondsPerKm: number;
  method: 'power_law_fit' | 'riegel_from_best_effort';
  confidence: 'high' | 'medium' | 'low';
  explanation: string;
}

/**
 * Functional threshold speed — the pace sustainable for roughly an hour. This is
 * the reference intensity that lets a run without heart-rate data still be
 * scored honestly, by comparing its pace against the athlete's own threshold
 * rather than assuming a fixed "moderate" multiplier.
 */
export function estimateThresholdSpeed(activities: readonly Activity[]): ThresholdSpeed | null {
  const efforts = findBestEfforts(activities);
  if (efforts.length === 0) return null;

  const fit = fitPowerLaw(efforts);
  if (fit) {
    // Distance covered in 3600s under the fitted law: D = (3600 / a)^(1/b).
    const meters = Math.pow(3600 / fit.coefficient, 1 / fit.exponent);
    const speedMps = meters / 3600;
    return {
      speedMps,
      paceSecondsPerKm: 1000 / speedMps,
      method: 'power_law_fit',
      confidence: fit.rSquared >= 0.98 ? 'high' : 'medium',
      explanation:
        `Fitted this athlete's distance/time curve across ${fit.pointsUsed} best efforts ` +
        `(exponent ${fit.exponent.toFixed(3)}, R²=${fit.rSquared.toFixed(3)}) and solved for the pace holdable for one hour.`,
    };
  }

  // One or two data points: scale the effort closest to an hour long.
  const closest = efforts.reduce((best, e) =>
    Math.abs(e.timeSeconds - 3600) < Math.abs(best.timeSeconds - 3600) ? e : best,
  );
  const meters = Math.pow(3600 / (closest.timeSeconds / Math.pow(closest.actualDistanceMeters, DEFAULT_RIEGEL_EXPONENT)), 1 / DEFAULT_RIEGEL_EXPONENT);
  const speedMps = meters / 3600;
  return {
    speedMps,
    paceSecondsPerKm: 1000 / speedMps,
    method: 'riegel_from_best_effort',
    confidence: 'low',
    explanation:
      `Only ${efforts.length} qualifying best effort${efforts.length === 1 ? '' : 's'} available, so threshold pace is ` +
      `extrapolated from the ${closest.label} on ${closest.date.slice(0, 10)} using the standard Riegel exponent.`,
  };
}
