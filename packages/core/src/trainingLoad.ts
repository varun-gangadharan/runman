/**
 * Training load.
 *
 * The original implementation multiplied duration by `averageHeartrate / 180`,
 * and — when the activity had no heart-rate data — by a flat `0.8`. Two things
 * were wrong with that. The flat fallback quietly assigned every HR-less run the
 * same intensity, so a hill session and a shakeout scored identically and the
 * user had no way to tell which numbers were measured and which were assumed.
 * And 180 was a constant standing in for max heart rate, which is per-athlete.
 *
 * This module instead:
 *   - scores heart-rate runs with Banister TRIMP against the athlete's own max
 *     and resting HR,
 *   - scores HR-less runs from pace against the athlete's own threshold speed
 *     (rTSS), then rescales that onto the TRIMP scale using the activities that
 *     have both, so a mixed history stays on one coherent axis,
 *   - falls back to duration alone only when neither is possible, and always
 *     labels that as an assumption rather than a measurement,
 *   - tracks fitness (CTL), fatigue (ATL) and form (TSB) over a real calendar,
 *     so rest days pull the averages down the way they do in reality.
 */

import { estimateThresholdSpeed, type ThresholdSpeed } from './performance.ts';
import { deriveMaxHeartRate, heartRateReserveFraction } from './heartRate.ts';
import { addDays, dayKeyRange, toDayKey, type DayKey } from './time.ts';
import type { Activity, AthleteProfile, Confidence } from './types.ts';

/** Days of history the exponential averages need before they mean anything. */
export const CTL_TIME_CONSTANT_DAYS = 42;
export const ATL_TIME_CONSTANT_DAYS = 7;

export type LoadMethod = 'trimp_hr' | 'pace_calibrated' | 'pace_threshold' | 'duration_only';

export interface ActivityLoad {
  activityId: string;
  date: string;
  load: number;
  method: LoadMethod;
  confidence: Confidence;
  explanation: string;
}

/**
 * Banister TRIMP. The exponential weighting makes hard minutes count for
 * disproportionately more than easy ones, which is the whole point — an hour at
 * threshold is not two half-hours of jogging.
 */
function trimp(
  durationMinutes: number,
  averageHeartrate: number,
  maxHeartRate: number,
  restingHeartRate: number | null,
  sex: AthleteProfile['sex'],
): number {
  const hrr = heartRateReserveFraction(averageHeartrate, maxHeartRate, restingHeartRate);
  // Sex-specific constants from Banister's original derivation. `unspecified`
  // takes the male constants, which is the more common published default.
  const [scale, k] = sex === 'female' ? [0.86, 1.67] : [0.64, 1.92];
  return durationMinutes * hrr * scale * Math.exp(k * hrr);
}

/**
 * Grade-adjusted speed. Climbing costs real effort that flat pace hides, so a
 * hilly run's equivalent flat speed is faster than its recorded speed. Uses the
 * summary elevation gain, which is all a Strava activity summary carries.
 */
function gradeAdjustedSpeedMps(activity: Activity): number {
  const speed = activity.distanceMeters / activity.movingTimeSeconds;
  if (activity.distanceMeters <= 0) return speed;
  const averageGrade = Math.max(0, activity.totalElevationGainMeters) / activity.distanceMeters;
  // Roughly a 2% effort premium per 1% of average uphill grade, capped so a
  // mis-recorded elevation spike cannot dominate the score.
  return speed * (1 + Math.min(0.25, 2 * averageGrade));
}

/**
 * Running TSS: an hour at threshold scores 100, and load scales with the square
 * of intensity, matching the TRIMP curve's shape closely enough to be calibrated
 * onto it.
 */
function rtss(activity: Activity, thresholdSpeedMps: number): number {
  const intensityFactor = gradeAdjustedSpeedMps(activity) / thresholdSpeedMps;
  return (activity.movingTimeSeconds / 3600) * intensityFactor ** 2 * 100;
}

export interface LoadScorer {
  score(activity: Activity): ActivityLoad;
  primaryMethod: PrimaryLoadMethod;
  /** Fraction of activities carrying usable heart-rate data, 0–1. */
  heartRateCoverage: number;
  /** Factor applied to rTSS to put it on the TRIMP scale, when calibrated. */
  paceCalibrationFactor: number | null;
  threshold: ThresholdSpeed | null;
  maxHeartRate: number | null;
  explanation: string;
}

/**
 * Build a scorer for one athlete's history. Doing this once for the whole
 * history — rather than per activity — is what keeps a mixed HR / no-HR history
 * on a single comparable scale.
 */
export function buildLoadScorer(
  activities: readonly Activity[],
  profile: AthleteProfile = {},
): LoadScorer {
  const withDuration = activities.filter((a) => a.movingTimeSeconds > 0);
  const maxHrDerived = deriveMaxHeartRate(withDuration, profile);
  const maxHeartRate = maxHrDerived?.value ?? null;
  const restingHeartRate = profile.restingHeartRate ?? null;
  const threshold = estimateThresholdSpeed(withDuration);

  const withHr = withDuration.filter((a) => (a.averageHeartrate ?? 0) > 0);
  const heartRateCoverage = withDuration.length === 0 ? 0 : withHr.length / withDuration.length;

  const canTrimp = maxHeartRate !== null;
  const canPace = threshold !== null;

  // Calibrate the pace scale against the HR scale on activities that carry both,
  // so switching methods mid-history does not create a phantom step change.
  let paceCalibrationFactor: number | null = null;
  if (canTrimp && canPace && withHr.length >= 3) {
    const ratios: number[] = [];
    for (const activity of withHr) {
      if (activity.distanceMeters <= 0) continue;
      const paceScore = rtss(activity, threshold!.speedMps);
      if (paceScore <= 0) continue;
      const hrScore = trimp(
        activity.movingTimeSeconds / 60,
        activity.averageHeartrate!,
        maxHeartRate!,
        restingHeartRate,
        profile.sex,
      );
      if (hrScore > 0) ratios.push(hrScore / paceScore);
    }
    if (ratios.length >= 3) {
      ratios.sort((a, b) => a - b);
      paceCalibrationFactor = ratios[Math.floor(ratios.length / 2)]!; // median resists outliers
    }
  }

  const primaryMethod: PrimaryLoadMethod = canTrimp && heartRateCoverage > 0
    ? 'trimp_hr'
    : canPace
      ? 'pace_threshold'
      : 'duration_only';

  const explanation = buildScorerExplanation({
    primaryMethod,
    heartRateCoverage,
    paceCalibrationFactor,
    threshold,
    maxHrExplanation: maxHrDerived?.explanation ?? null,
  });

  function score(activity: Activity): ActivityLoad {
    const base = { activityId: activity.id, date: activity.startDate };
    const durationMinutes = activity.movingTimeSeconds / 60;

    if (durationMinutes <= 0) {
      return {
        ...base,
        load: 0,
        method: 'duration_only',
        confidence: 'none',
        explanation: 'Activity has no recorded moving time, so it contributes no load.',
      };
    }

    if (canTrimp && (activity.averageHeartrate ?? 0) > 0) {
      return {
        ...base,
        load: trimp(durationMinutes, activity.averageHeartrate!, maxHeartRate!, restingHeartRate, profile.sex),
        method: 'trimp_hr',
        confidence: restingHeartRate ? 'high' : 'medium',
        explanation:
          `Banister TRIMP from ${Math.round(activity.averageHeartrate!)} bpm average against a max of ${maxHeartRate} bpm` +
          `${restingHeartRate ? ` and a resting HR of ${restingHeartRate} bpm` : ' (no resting HR on file, so heart-rate reserve is approximated from max alone)'}.`,
      };
    }

    if (canPace && activity.distanceMeters > 0) {
      const raw = rtss(activity, threshold!.speedMps);
      const calibrated = paceCalibrationFactor === null ? raw : raw * paceCalibrationFactor;
      return {
        ...base,
        load: calibrated,
        method: paceCalibrationFactor === null ? 'pace_threshold' : 'pace_calibrated',
        confidence: paceCalibrationFactor === null ? (threshold!.confidence === 'high' ? 'medium' : 'low') : 'medium',
        explanation:
          `No heart-rate data on this activity, so load is scored from grade-adjusted pace against an estimated ` +
          `threshold pace of ${formatPaceShort(threshold!.paceSecondsPerKm)}/km` +
          `${paceCalibrationFactor === null ? '' : `, rescaled by ${paceCalibrationFactor.toFixed(2)}× onto the same scale as this athlete's heart-rate-scored runs`}.`,
      };
    }

    return {
      ...base,
      load: (activity.movingTimeSeconds / 3600) * 65,
      method: 'duration_only',
      confidence: 'low',
      explanation:
        'Neither heart rate nor a usable distance/pace reference is available for this athlete, so load is a ' +
        'duration-only placeholder assuming a moderate effort. Treat it as an assumption, not a measurement.',
    };
  }

  return {
    score,
    primaryMethod,
    heartRateCoverage,
    paceCalibrationFactor,
    threshold,
    maxHeartRate,
    explanation,
  };
}

function formatPaceShort(secondsPerKm: number): string {
  const m = Math.floor(secondsPerKm / 60);
  const s = Math.round(secondsPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Only the three methods that can be a history's *primary* scale. */
type PrimaryLoadMethod = Extract<LoadMethod, 'trimp_hr' | 'pace_threshold' | 'duration_only'>;

function buildScorerExplanation(input: {
  primaryMethod: PrimaryLoadMethod;
  heartRateCoverage: number;
  paceCalibrationFactor: number | null;
  threshold: ThresholdSpeed | null;
  maxHrExplanation: string | null;
}): string {
  const pct = Math.round(input.heartRateCoverage * 100);
  switch (input.primaryMethod) {
    case 'trimp_hr':
      return (
        `${pct}% of activities carry heart-rate data and are scored with Banister TRIMP. ` +
        `${input.maxHrExplanation ?? ''}` +
        (pct < 100
          ? input.paceCalibrationFactor !== null
            ? ` The remaining ${100 - pct}% are scored from pace and rescaled onto the same axis.`
            : ` The remaining ${100 - pct}% are scored from pace; too few overlapping activities exist to calibrate the two scales, so those values are less comparable.`
          : '')
      );
    case 'pace_threshold':
      return (
        `No usable heart-rate data in this history, so every activity is scored from grade-adjusted pace against ` +
        `an estimated threshold. ${input.threshold?.explanation ?? ''}`
      );
    case 'duration_only':
      return (
        'This athlete has neither heart-rate data nor enough runs to establish a threshold pace, so load is a ' +
        'duration-only placeholder. Numbers are directionally useful at best — connect a heart-rate monitor or ' +
        'log a few more runs to get real ones.'
      );
  }
}

export interface DailyLoad {
  date: DayKey;
  /** Sum of every activity's load on this calendar day. Zero on rest days. */
  load: number;
  activityCount: number;
  distanceMeters: number;
  movingTimeSeconds: number;
  /** Chronic training load — 42-day exponential average. "Fitness". */
  ctl: number;
  /** Acute training load — 7-day exponential average. "Fatigue". */
  atl: number;
  /** Training stress balance, `ctl − atl`. Positive means freshening up. */
  tsb: number;
}

export type LoadTrend = 'ramping' | 'building' | 'steady' | 'easing' | 'detraining';

export interface TrainingLoadSummary {
  series: DailyLoad[];
  current: DailyLoad;
  trend: LoadTrend;
  /** Change in CTL across the window, as a fraction of its starting value. */
  ctlChangeRatio: number;
  /**
   * Acute:chronic workload ratio. Sustained values above ~1.5 are the classic
   * spike associated with elevated injury risk; below ~0.8 is detraining.
   */
  acuteChronicRatio: number;
  method: LoadMethod;
  confidence: Confidence;
  explanation: string;
  /** Days of history available before the window started, for warm-up honesty. */
  warmupDays: number;
}

export interface LoadSeriesOptions {
  /** End of the reported window. Defaults to the most recent activity's day. */
  endDate?: Date;
  /** Length of the reported window in days. */
  days?: number;
  profile?: AthleteProfile;
}

/**
 * Daily load series with CTL/ATL/TSB.
 *
 * The exponential averages are seeded from the athlete's full history and only
 * then sliced to the requested window, so a 30-day view does not start from a
 * fictitious zero-fitness state.
 */
export function computeLoadSeries(
  activities: readonly Activity[],
  options: LoadSeriesOptions = {},
): TrainingLoadSummary | null {
  const scorer = buildLoadScorer(activities, options.profile ?? {});
  const scored = activities
    .filter((a) => a.movingTimeSeconds > 0)
    .map((a) => ({ activity: a, load: scorer.score(a) }));

  if (scored.length === 0) return null;

  const sorted = [...scored].sort(
    (a, b) => new Date(a.activity.startDate).getTime() - new Date(b.activity.startDate).getTime(),
  );
  const firstDate = new Date(sorted[0]!.activity.startDate);
  const lastDate = new Date(sorted[sorted.length - 1]!.activity.startDate);

  const windowDays = options.days ?? 90;
  const endDate = options.endDate ?? lastDate;
  const windowStart = addDays(endDate, -(windowDays - 1));

  const byDay = new Map<DayKey, { load: number; count: number; distance: number; time: number }>();
  for (const { activity, load } of sorted) {
    const key = toDayKey(activity.startDate);
    const bucket = byDay.get(key) ?? { load: 0, count: 0, distance: 0, time: 0 };
    bucket.load += load.load;
    bucket.count += 1;
    bucket.distance += activity.distanceMeters;
    bucket.time += activity.movingTimeSeconds;
    byDay.set(key, bucket);
  }

  const ctlAlpha = 1 - Math.exp(-1 / CTL_TIME_CONSTANT_DAYS);
  const atlAlpha = 1 - Math.exp(-1 / ATL_TIME_CONSTANT_DAYS);

  let ctl = 0;
  let atl = 0;
  const series: DailyLoad[] = [];

  for (const key of dayKeyRange(firstDate, endDate)) {
    const bucket = byDay.get(key) ?? { load: 0, count: 0, distance: 0, time: 0 };
    ctl += (bucket.load - ctl) * ctlAlpha;
    atl += (bucket.load - atl) * atlAlpha;
    series.push({
      date: key,
      load: round(bucket.load),
      activityCount: bucket.count,
      distanceMeters: round(bucket.distance),
      movingTimeSeconds: bucket.time,
      ctl: round(ctl),
      atl: round(atl),
      tsb: round(ctl - atl),
    });
  }

  const windowStartKey = toDayKey(windowStart);
  const windowSeries = series.filter((d) => d.date >= windowStartKey);
  const reported = windowSeries.length > 0 ? windowSeries : series.slice(-1);
  const current = reported[reported.length - 1]!;
  const first = reported[0]!;

  const ctlChangeRatio = first.ctl > 0 ? (current.ctl - first.ctl) / first.ctl : current.ctl > 0 ? 1 : 0;
  const acuteChronicRatio = current.ctl > 0 ? current.atl / current.ctl : 0;
  const warmupDays = series.length - reported.length;

  return {
    series: reported,
    current,
    trend: classifyTrend(ctlChangeRatio, acuteChronicRatio),
    ctlChangeRatio: round(ctlChangeRatio, 3),
    acuteChronicRatio: round(acuteChronicRatio, 2),
    method: scorer.primaryMethod,
    confidence: scorerConfidence(scorer, warmupDays),
    explanation:
      `${scorer.explanation} Fitness (CTL) and fatigue (ATL) are ${CTL_TIME_CONSTANT_DAYS}- and ${ATL_TIME_CONSTANT_DAYS}-day ` +
      `exponential averages over every calendar day in the window, including rest days.` +
      (warmupDays < CTL_TIME_CONSTANT_DAYS
        ? ` Only ${warmupDays} day${warmupDays === 1 ? '' : 's'} of history precede this window, so the fitness figure is still warming up and understates true fitness.`
        : ''),
    warmupDays,
  };
}

function scorerConfidence(scorer: LoadScorer, warmupDays: number): Confidence {
  if (scorer.primaryMethod === 'duration_only') return 'low';
  if (warmupDays < ATL_TIME_CONSTANT_DAYS) return 'low';
  if (warmupDays < CTL_TIME_CONSTANT_DAYS) return 'medium';
  return scorer.primaryMethod === 'trimp_hr' && scorer.heartRateCoverage > 0.8 ? 'high' : 'medium';
}

function classifyTrend(ctlChangeRatio: number, acuteChronicRatio: number): LoadTrend {
  if (acuteChronicRatio >= 1.5) return 'ramping';
  if (ctlChangeRatio >= 0.1) return 'building';
  if (ctlChangeRatio <= -0.25 || acuteChronicRatio < 0.6) return 'detraining';
  if (ctlChangeRatio <= -0.05) return 'easing';
  return 'steady';
}

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
