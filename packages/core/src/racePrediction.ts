/**
 * Race-time prediction.
 *
 * Three defects in the version this replaces:
 *
 *  1. It selected the reference effort by *fastest pace* among anything at least
 *     30% of the target distance. Predicting a marathon therefore keyed off
 *     whichever 13 km tempo happened to be quickest, and Riegel-extrapolating a
 *     short fast effort out by 3× inflates the prediction badly.
 *  2. It applied no plausibility screening, so one GPS glitch reading 2 km in
 *     4 minutes became the athlete's best effort and poisoned every prediction.
 *  3. It multiplied the result by 0.95 or 0.90 when the user picked an ambitious
 *     goal. Selecting "compete" in a dropdown does not make anyone 10% faster;
 *     that is fabricating fitness the data does not support.
 *
 * The replacement prefers a personal power-law fit across multiple distances,
 * falls back to Riegel from the *closest* screened effort, expresses uncertainty
 * as a range rather than a wish, and always reports which activities it used.
 */

import { describeFlag, screenActivities } from './dataQuality.ts';
import {
  DEFAULT_RIEGEL_EXPONENT,
  fitPowerLaw,
  findBestEfforts,
  predictFromFit,
  riegel,
  type BestEffort,
} from './performance.ts';
import { formatDuration, formatPace } from './time.ts';
import { STANDARD_DISTANCES, isRun, type Activity, type Confidence } from './types.ts';

export type PredictionMethod = 'personal_power_law' | 'riegel_closest_effort';

/** What the athlete intends to do on race day. Affects pacing advice, not the prediction. */
export type RaceGoal = 'finish' | 'pr' | 'compete';

export interface ReferenceEffort {
  activityId: string;
  activityName: string;
  date: string;
  distanceMeters: number;
  timeSeconds: number;
  formattedTime: string;
  paceSecondsPerKm: number;
  formattedPace: string;
  /** How heavily this effort influenced the prediction, 0–1. */
  weight: number;
}

export interface RacePrediction {
  targetDistanceMeters: number;
  targetLabel: string;
  predictedSeconds: number;
  formattedTime: string;
  paceSecondsPerKm: number;
  formattedPace: string;
  /** Plausible spread, not a goal adjustment. */
  range: { optimisticSeconds: number; conservativeSeconds: number; formattedOptimistic: string; formattedConservative: string };
  method: PredictionMethod;
  /** The fitted (or assumed) Riegel exponent for this athlete. */
  exponent: number;
  confidence: Confidence;
  explanation: string;
  /** Every activity that fed the prediction, so the number can be audited. */
  basedOn: ReferenceEffort[];
  /** Activities excluded by plausibility screening, with reasons. */
  excluded: Array<{ activityId: string; activityName: string; date: string; reasons: string[] }>;
  /** Pacing guidance for the stated goal. Advice only — it does not shift the prediction. */
  pacingAdvice: string;
}

export interface PredictionOptions {
  goal?: RaceGoal;
  /** Ignore efforts older than this many days. Defaults to 180. */
  lookbackDays?: number;
  now?: Date;
}

export function labelForDistance(meters: number): string {
  const match = STANDARD_DISTANCES.find((d) => Math.abs(d.meters - meters) / meters < 0.01);
  return match ? match.label : `${(meters / 1000).toFixed(2)} km`;
}

/**
 * Predict a race time for `targetMeters`.
 * Returns null when no screened effort in the lookback window can support one —
 * saying "not enough data" is a legitimate answer and a better one than a number
 * built from nothing.
 */
export function predictRaceTime(
  activities: readonly Activity[],
  targetMeters: number,
  options: PredictionOptions = {},
): RacePrediction | null {
  const now = options.now ?? new Date();
  const lookbackDays = options.lookbackDays ?? 180;
  const since = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  const goal = options.goal ?? 'finish';

  const runs = activities.filter(isRun).filter((a) => new Date(a.startDate) >= since);
  const { rejected } = screenActivities(runs);
  const excluded = rejected.map((r) => ({
    activityId: r.activity.id,
    activityName: r.activity.name,
    date: r.activity.startDate,
    reasons: r.flags.map(describeFlag),
  }));

  const efforts = findBestEfforts(activities, { since });
  if (efforts.length === 0) return null;

  const fit = fitPowerLaw(efforts);

  if (fit) {
    const predictedSeconds = predictFromFit(fit, targetMeters);
    // Residual spread in log-time converts directly to a multiplicative band.
    const residualSpread = logResidualStdDev(fit.efforts, fit.coefficient, fit.exponent);
    const band = Math.max(0.02, Math.min(0.08, residualSpread * 1.5)) + extrapolationPenalty(efforts, targetMeters);

    return assemble({
      targetMeters,
      predictedSeconds,
      band,
      method: 'personal_power_law',
      exponent: fit.exponent,
      confidence: predictionConfidence(fit.rSquared, fit.pointsUsed, efforts, targetMeters),
      explanation:
        `Fitted this athlete's own distance/time curve across ${fit.pointsUsed} screened best efforts ` +
        `(${fit.efforts.map((e) => e.label).join(', ')}). The fitted fatigue exponent is ${fit.exponent.toFixed(3)} ` +
        `versus the population-average Riegel value of ${DEFAULT_RIEGEL_EXPONENT} — ` +
        `${fit.exponent < DEFAULT_RIEGEL_EXPONENT ? 'this runner holds pace better than average as distance grows' : 'this runner fades faster than average as distance grows'}. ` +
        `Fit quality R²=${fit.rSquared.toFixed(3)}.` +
        extrapolationCaveat(efforts, targetMeters),
      basedOn: fit.efforts.map((e) => toReference(e, 1 / fit.pointsUsed)),
      excluded,
      goal,
    });
  }

  // Not enough distinct distances to fit a curve: scale from the effort closest
  // in distance to the target. Closest, specifically — extrapolating a long way
  // in either direction is where Riegel breaks down, so minimise the distance
  // travelled rather than maximising the pace used.
  const closest = efforts.reduce((best, e) =>
    Math.abs(Math.log(e.actualDistanceMeters / targetMeters)) <
    Math.abs(Math.log(best.actualDistanceMeters / targetMeters))
      ? e
      : best,
  );

  const predictedSeconds = riegel(
    closest.timeSeconds,
    closest.actualDistanceMeters,
    targetMeters,
    DEFAULT_RIEGEL_EXPONENT,
  );
  const stretch = Math.abs(Math.log(targetMeters / closest.actualDistanceMeters));

  return assemble({
    targetMeters,
    predictedSeconds,
    band: 0.05 + Math.min(0.12, stretch * 0.08),
    method: 'riegel_closest_effort',
    exponent: DEFAULT_RIEGEL_EXPONENT,
    confidence: stretch < 0.7 ? 'medium' : 'low',
    explanation:
      `Only ${efforts.length} screened best effort${efforts.length === 1 ? '' : 's'} available — not enough distinct ` +
      `distances to fit a personal curve — so the prediction scales the closest one by distance using the standard ` +
      `Riegel exponent of ${DEFAULT_RIEGEL_EXPONENT}. Reference: ${closest.label} in ${formatDuration(closest.timeSeconds)} ` +
      `on ${closest.date.slice(0, 10)} ("${closest.activityName}").` +
      (stretch > 0.7
        ? ` That reference is ${(targetMeters / closest.actualDistanceMeters).toFixed(1)}× the target distance, which is a long ` +
          `extrapolation — Riegel loses accuracy beyond roughly a 2× stretch, so treat this as a rough estimate.`
        : ''),
    basedOn: [toReference(closest, 1)],
    excluded,
    goal,
  });
}

function toReference(effort: BestEffort, weight: number): ReferenceEffort {
  return {
    activityId: effort.activityId,
    activityName: effort.activityName,
    date: effort.date,
    distanceMeters: effort.actualDistanceMeters,
    timeSeconds: effort.timeSeconds,
    formattedTime: formatDuration(effort.timeSeconds),
    paceSecondsPerKm: effort.paceSecondsPerKm,
    formattedPace: `${formatPace(effort.paceSecondsPerKm)}/km`,
    weight: Math.round(weight * 100) / 100,
  };
}

function assemble(input: {
  targetMeters: number;
  predictedSeconds: number;
  band: number;
  method: PredictionMethod;
  exponent: number;
  confidence: Confidence;
  explanation: string;
  basedOn: ReferenceEffort[];
  excluded: RacePrediction['excluded'];
  goal: RaceGoal;
}): RacePrediction {
  const predictedSeconds = Math.round(input.predictedSeconds);
  const optimistic = Math.round(predictedSeconds * (1 - input.band));
  const conservative = Math.round(predictedSeconds * (1 + input.band));
  const paceSecondsPerKm = (predictedSeconds / input.targetMeters) * 1000;

  return {
    targetDistanceMeters: input.targetMeters,
    targetLabel: labelForDistance(input.targetMeters),
    predictedSeconds,
    formattedTime: formatDuration(predictedSeconds),
    paceSecondsPerKm,
    formattedPace: `${formatPace(paceSecondsPerKm)}/km`,
    range: {
      optimisticSeconds: optimistic,
      conservativeSeconds: conservative,
      formattedOptimistic: formatDuration(optimistic),
      formattedConservative: formatDuration(conservative),
    },
    method: input.method,
    exponent: Math.round(input.exponent * 1000) / 1000,
    confidence: input.confidence,
    explanation: input.explanation,
    basedOn: input.basedOn,
    excluded: input.excluded,
    pacingAdvice: pacingAdvice(input.goal, paceSecondsPerKm),
  };
}

/**
 * Goal affects how to *run* the race, never what the data predicts. A runner
 * chasing a PR goes out on predicted pace and negative-splits; one aiming to
 * finish banks margin early. Neither changes the underlying fitness estimate.
 */
function pacingAdvice(goal: RaceGoal, paceSecondsPerKm: number): string {
  const target = formatPace(paceSecondsPerKm);
  switch (goal) {
    case 'pr':
      return (
        `To race this for a PR, run the first third slightly *slower* than ${target}/km (about ${formatPace(paceSecondsPerKm + 5)}/km), ` +
        `settle onto ${target}/km through the middle, and spend whatever is left in the final third. ` +
        `The prediction is what your current fitness supports — beating it comes from execution and taper, not from a faster starting pace.`
      );
    case 'compete':
      return (
        `Racing for place means running other people's pace, which is inherently riskier than running your own. ` +
        `${target}/km is what your data supports; going with a move that is more than about 10 s/km faster than that ` +
        `before the final quarter is likely to cost more than it gains.`
      );
    case 'finish':
      return (
        `For a comfortable finish, start around ${formatPace(paceSecondsPerKm + 15)}/km — roughly 15 s/km slower than the ` +
        `predicted ${target}/km — and only pick it up once you are past halfway and still feel strong.`
      );
  }
}

function logResidualStdDev(efforts: readonly BestEffort[], coefficient: number, exponent: number): number {
  if (efforts.length < 2) return 0.05;
  const residuals = efforts.map(
    (e) => Math.log(e.timeSeconds) - Math.log(coefficient * Math.pow(e.actualDistanceMeters, exponent)),
  );
  const mean = residuals.reduce((s, r) => s + r, 0) / residuals.length;
  const variance = residuals.reduce((s, r) => s + (r - mean) ** 2, 0) / residuals.length;
  return Math.sqrt(variance);
}

/** How far outside the observed distance range the target sits. */
function extrapolationStretch(efforts: readonly BestEffort[], targetMeters: number): number {
  const distances = efforts.map((e) => e.actualDistanceMeters);
  const min = Math.min(...distances);
  const max = Math.max(...distances);
  if (targetMeters >= min && targetMeters <= max) return 0;
  return targetMeters > max ? Math.log(targetMeters / max) : Math.log(min / targetMeters);
}

function extrapolationPenalty(efforts: readonly BestEffort[], targetMeters: number): number {
  return Math.min(0.1, extrapolationStretch(efforts, targetMeters) * 0.06);
}

function extrapolationCaveat(efforts: readonly BestEffort[], targetMeters: number): string {
  const stretch = extrapolationStretch(efforts, targetMeters);
  if (stretch === 0) return ' The target distance falls inside the range of efforts used, so this is an interpolation.';
  const distances = efforts.map((e) => e.actualDistanceMeters);
  const nearest = targetMeters > Math.max(...distances) ? Math.max(...distances) : Math.min(...distances);
  return (
    ` The target is outside the range of distances raced (nearest is ${(nearest / 1000).toFixed(1)} km), ` +
    `so this extrapolates the curve and the range is widened to reflect that.`
  );
}

function predictionConfidence(
  rSquared: number,
  points: number,
  efforts: readonly BestEffort[],
  targetMeters: number,
): Confidence {
  const stretch = extrapolationStretch(efforts, targetMeters);
  if (rSquared >= 0.99 && points >= 4 && stretch < 0.3) return 'high';
  if (rSquared >= 0.95 && stretch < 0.8) return 'medium';
  return 'low';
}
