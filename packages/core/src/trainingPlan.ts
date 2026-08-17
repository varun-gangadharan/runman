/**
 * Training-plan generation.
 *
 * What this replaces had the right *shape* — build, peak, taper — resting on
 * three broken inputs. Starting volume came from the "last 30 activities ÷ 4"
 * miscalculation, so plans began at a volume the athlete had never actually run.
 * The 10% rule was applied as a fixed absolute increment computed once, which
 * both under-progresses early and over-progresses late. And target paces were
 * the athlete's *average* pace across all activities multiplied by a constant,
 * which anchors every workout to a number that includes their recovery jogs.
 *
 * Here, volume starts from a real 28-day calendar average, progresses
 * multiplicatively with recovery weeks built in, and paces derive from the
 * athlete's estimated threshold — the same threshold the load model uses.
 */

import { estimateThresholdSpeed } from './performance.ts';
import { predictRaceTime, labelForDistance, type RaceGoal } from './racePrediction.ts';
import { addDays, daysBetween, formatPace, startOfIsoWeek, toDayKey } from './time.ts';
import { rollingVolume } from './volume.ts';
import type { Activity, AthleteProfile, Confidence } from './types.ts';

export type WorkoutType = 'easy' | 'long' | 'tempo' | 'intervals' | 'recovery' | 'rest' | 'race';
export type PlanPhase = 'base' | 'build' | 'peak' | 'taper' | 'race';

export const PLAN_MIN_WEEKS = 6;
export const PLAN_MAX_WEEKS = 24;
/** The classic injury-prevention ceiling on week-over-week volume growth. */
export const MAX_WEEKLY_INCREASE = 0.1;
/** A long run beyond this share of weekly volume is a red flag for injury. */
export const MAX_LONG_RUN_SHARE = 0.35;
/** Beyond about this distance the marginal benefit of a longer run is negative. */
export const LONG_RUN_CEILING_METERS = 34000;

export interface PaceRange {
  minSecondsPerKm: number;
  maxSecondsPerKm: number;
  formatted: string;
}

export interface PaceGuide {
  recovery: PaceRange;
  easy: PaceRange;
  long: PaceRange;
  tempo: PaceRange;
  intervals: PaceRange;
  thresholdSecondsPerKm: number;
  basis: string;
}

export interface PlannedWorkout {
  /** 0 = Monday. */
  dayOfWeek: number;
  date: string;
  type: WorkoutType;
  distanceMeters: number;
  description: string;
  targetPace: PaceRange | null;
  intensity: 'rest' | 'low' | 'moderate' | 'high';
}

export interface PlanWeek {
  weekNumber: number;
  weekStart: string;
  phase: PlanPhase;
  isRecoveryWeek: boolean;
  targetDistanceMeters: number;
  longRunMeters: number;
  workouts: PlannedWorkout[];
  note: string;
}

export interface TrainingPlan {
  raceDate: string;
  targetDistanceMeters: number;
  targetLabel: string;
  goal: RaceGoal;
  weeks: PlanWeek[];
  paces: PaceGuide;
  startingWeeklyMeters: number;
  peakWeeklyMeters: number;
  totalDistanceMeters: number;
  confidence: Confidence;
  /** Things the athlete should know before following this. Never silently dropped. */
  warnings: string[];
  explanation: string;
}

export interface PlanOptions {
  targetDistanceMeters: number;
  raceDate: Date;
  daysPerWeek?: number;
  goal?: RaceGoal;
  /** Optional athlete-chosen peak weekly volume, metres. */
  peakWeeklyMeters?: number;
  profile?: AthleteProfile;
  now?: Date;
}

export type PlanErrorCode = 'no_data' | 'window_too_short' | 'window_too_long' | 'insufficient_history';

export class PlanGenerationError extends Error {
  code: PlanErrorCode;

  constructor(message: string, code: PlanErrorCode) {
    super(message);
    this.name = 'PlanGenerationError';
    this.code = code;
  }
}

/**
 * Pace bands relative to threshold pace, in seconds per kilometre.
 * Threshold is the pace holdable for about an hour; everything else is defined
 * as an offset from it, which is how coaches actually prescribe workouts.
 */
const PACE_OFFSETS: Record<'recovery' | 'easy' | 'long' | 'tempo' | 'intervals', [min: number, max: number]> = {
  recovery: [75, 105],
  easy: [55, 85],
  long: [45, 75],
  tempo: [-5, 12],
  intervals: [-25, -10],
};

function paceRange(thresholdSecondsPerKm: number, key: keyof typeof PACE_OFFSETS): PaceRange {
  const [minOffset, maxOffset] = PACE_OFFSETS[key];
  const min = thresholdSecondsPerKm + minOffset;
  const max = thresholdSecondsPerKm + maxOffset;
  return {
    minSecondsPerKm: Math.round(min),
    maxSecondsPerKm: Math.round(max),
    formatted: `${formatPace(min)}–${formatPace(max)}/km`,
  };
}

export function buildPaceGuide(activities: readonly Activity[]): PaceGuide | null {
  const threshold = estimateThresholdSpeed(activities);
  if (!threshold) return null;
  const t = threshold.paceSecondsPerKm;
  return {
    recovery: paceRange(t, 'recovery'),
    easy: paceRange(t, 'easy'),
    long: paceRange(t, 'long'),
    tempo: paceRange(t, 'tempo'),
    intervals: paceRange(t, 'intervals'),
    thresholdSecondsPerKm: Math.round(t),
    basis: `Paces are offsets from an estimated threshold pace of ${formatPace(t)}/km. ${threshold.explanation}`,
  };
}

export function generateTrainingPlan(
  activities: readonly Activity[],
  options: PlanOptions,
): TrainingPlan {
  const now = options.now ?? new Date();
  const goal = options.goal ?? 'finish';
  const daysPerWeek = clamp(options.daysPerWeek ?? 4, 3, 7);
  const warnings: string[] = [];

  const totalWeeks = Math.floor(daysBetween(now, options.raceDate) / 7);
  if (totalWeeks < PLAN_MIN_WEEKS) {
    throw new PlanGenerationError(
      `Race is ${totalWeeks} week${totalWeeks === 1 ? '' : 's'} away. A meaningful plan needs at least ${PLAN_MIN_WEEKS} weeks — ` +
        `below that there is not enough time to build fitness and still taper.`,
      'window_too_short',
    );
  }
  if (totalWeeks > PLAN_MAX_WEEKS) {
    throw new PlanGenerationError(
      `Race is ${totalWeeks} weeks away, beyond the ${PLAN_MAX_WEEKS}-week horizon this planner covers. ` +
        `Build general base now and generate a race plan ${PLAN_MAX_WEEKS} weeks out.`,
      'window_too_long',
    );
  }

  const paces = buildPaceGuide(activities);
  if (!paces) {
    throw new PlanGenerationError(
      'Not enough screened running history to estimate a threshold pace, so any prescribed paces would be invented. ' +
        'Log a few more runs — ideally including one hard effort of 5 km or longer — and try again.',
      'insufficient_history',
    );
  }

  const recent = rollingVolume(activities, { endDate: now, windowDays: 28 });
  if (recent.activityCount === 0) {
    throw new PlanGenerationError(
      'No runs recorded in the last 28 days, so there is no current volume to build from. ' +
        'A plan started from a guessed baseline is how people get hurt.',
      'no_data',
    );
  }

  const startingWeeklyMeters = recent.averageWeeklyDistanceMeters;
  if (recent.runDays < 6) {
    warnings.push(
      `Only ${recent.runDays} running days in the last 28. The starting volume of ` +
        `${(startingWeeklyMeters / 1000).toFixed(1)} km/week reflects that sparse history — ease into the first two weeks.`,
    );
  }

  // Ceiling: the athlete's own choice if given, otherwise what 10% a week can
  // reach across the build phase, capped at 1.6× current so a long runway does
  // not authorise an unrealistic doubling.
  const buildWeeks = Math.max(1, totalWeeks - taperWeeksFor(totalWeeks) - 1);
  const naturalPeak = startingWeeklyMeters * Math.pow(1 + MAX_WEEKLY_INCREASE, buildWeeks);
  const cappedPeak = Math.min(naturalPeak, startingWeeklyMeters * 1.6);
  let peakWeeklyMeters = options.peakWeeklyMeters ?? cappedPeak;

  if (options.peakWeeklyMeters && options.peakWeeklyMeters > cappedPeak * 1.05) {
    warnings.push(
      `Requested peak of ${(options.peakWeeklyMeters / 1000).toFixed(0)} km/week is more than a safe progression from ` +
        `${(startingWeeklyMeters / 1000).toFixed(1)} km/week reaches in ${buildWeeks} weeks. Capped at ` +
        `${(cappedPeak / 1000).toFixed(0)} km/week to stay inside the 10%-per-week guideline.`,
    );
    peakWeeklyMeters = cappedPeak;
  }

  const prediction = predictRaceTime(activities, options.targetDistanceMeters, { goal, now });
  const longestRecent = recent.longestRunMeters;
  if (options.targetDistanceMeters > longestRecent * 2.5) {
    warnings.push(
      `The target distance is ${(options.targetDistanceMeters / longestRecent).toFixed(1)}× the longest run of the last 28 days ` +
        `(${(longestRecent / 1000).toFixed(1)} km). The plan builds toward it, but that is an aggressive jump — ` +
        `consider a shorter goal race first.`,
    );
  }

  const weeks = buildWeeks_(
    totalWeeks,
    startingWeeklyMeters,
    peakWeeklyMeters,
    daysPerWeek,
    goal,
    paces,
    options.targetDistanceMeters,
    options.raceDate,
    now,
  );

  const totalDistanceMeters = weeks.reduce((sum, w) => sum + w.targetDistanceMeters, 0);

  return {
    raceDate: toDayKey(options.raceDate),
    targetDistanceMeters: options.targetDistanceMeters,
    targetLabel: labelForDistance(options.targetDistanceMeters),
    goal,
    weeks,
    paces,
    startingWeeklyMeters: Math.round(startingWeeklyMeters),
    peakWeeklyMeters: Math.round(peakWeeklyMeters),
    totalDistanceMeters: Math.round(totalDistanceMeters),
    confidence: prediction?.confidence ?? 'low',
    warnings,
    explanation:
      `${totalWeeks}-week plan built from a measured ${(startingWeeklyMeters / 1000).toFixed(1)} km/week over the ` +
      `last 28 calendar days (${recent.activityCount} runs across ${recent.runDays} days), progressing at no more than ` +
      `${Math.round(MAX_WEEKLY_INCREASE * 100)}% per week with a recovery week every fourth week and a ` +
      `${taperWeeksFor(totalWeeks)}-week taper. ${paces.basis}`,
  };
}

function taperWeeksFor(totalWeeks: number): number {
  if (totalWeeks >= 16) return 3;
  if (totalWeeks >= 10) return 2;
  return 1;
}

function buildWeeks_(
  totalWeeks: number,
  startingWeeklyMeters: number,
  peakWeeklyMeters: number,
  daysPerWeek: number,
  goal: RaceGoal,
  paces: PaceGuide,
  targetDistanceMeters: number,
  raceDate: Date,
  now: Date,
): PlanWeek[] {
  const taperWeeks = taperWeeksFor(totalWeeks);
  const buildEnd = totalWeeks - taperWeeks - 1; // the last week before taper; final week is race week
  const weeks: PlanWeek[] = [];

  const firstWeekStart = startOfIsoWeek(addDays(now, 7));
  let currentVolume = startingWeeklyMeters;
  let previousLongRun = Math.min(startingWeeklyMeters * MAX_LONG_RUN_SHARE, LONG_RUN_CEILING_METERS);

  for (let i = 0; i < totalWeeks; i++) {
    const weekNumber = i + 1;
    const weekStart = addDays(firstWeekStart, i * 7);
    const isRaceWeek = i === totalWeeks - 1;
    const isTaper = !isRaceWeek && i > buildEnd;
    // Every fourth week comes down, which is where adaptation actually happens.
    const isRecoveryWeek = !isRaceWeek && !isTaper && weekNumber % 4 === 0;

    let phase: PlanPhase;
    let targetVolume: number;

    if (isRaceWeek) {
      phase = 'race';
      targetVolume = peakWeeklyMeters * 0.35 + targetDistanceMeters;
    } else if (isTaper) {
      phase = 'taper';
      const taperIndex = i - buildEnd; // 1-based within the taper
      const factor = [0.8, 0.6, 0.5][taperIndex - 1] ?? 0.5;
      targetVolume = peakWeeklyMeters * factor;
    } else if (isRecoveryWeek) {
      phase = i > buildEnd * 0.6 ? 'peak' : 'build';
      targetVolume = currentVolume * 0.75;
    } else {
      phase = i === 0 ? 'base' : i > buildEnd * 0.6 ? 'peak' : 'build';
      const grown = i === 0 ? currentVolume : currentVolume * (1 + MAX_WEEKLY_INCREASE);
      targetVolume = Math.min(grown, peakWeeklyMeters);
      currentVolume = targetVolume;
    }

    const longRun = isRaceWeek
      ? targetDistanceMeters
      : Math.min(
          targetVolume * MAX_LONG_RUN_SHARE,
          LONG_RUN_CEILING_METERS,
          // Never jump the long run by more than 15% week to week.
          previousLongRun * 1.15,
          targetDistanceMeters * 1.1,
        );
    if (!isRaceWeek && !isRecoveryWeek && !isTaper) previousLongRun = longRun;

    weeks.push({
      weekNumber,
      weekStart: toDayKey(weekStart),
      phase,
      isRecoveryWeek,
      targetDistanceMeters: Math.round(targetVolume),
      longRunMeters: Math.round(longRun),
      workouts: layOutWeek({
        weekStart,
        targetVolume,
        longRun,
        daysPerWeek,
        phase,
        goal,
        paces,
        isRaceWeek,
        raceDate,
        targetDistanceMeters,
      }),
      note: weekNote(phase, isRecoveryWeek, weekNumber, totalWeeks),
    });
  }

  return weeks;
}

function weekNote(phase: PlanPhase, isRecoveryWeek: boolean, weekNumber: number, totalWeeks: number): string {
  if (phase === 'race') return 'Race week. Volume drops sharply; the goal is arriving fresh, not fit — fitness is already banked.';
  if (phase === 'taper') return 'Taper. Keep the intensity, cut the volume. Feeling twitchy and under-worked is the point.';
  if (isRecoveryWeek) return 'Recovery week. Volume is deliberately down about 25% — adaptation happens during the easier weeks, not the hard ones.';
  if (phase === 'peak') return `Peak block (week ${weekNumber} of ${totalWeeks}). Highest sustained load of the plan.`;
  if (phase === 'base') return 'Base week. Match what you have actually been running; resist the urge to start higher.';
  return 'Build week. Volume up roughly 10% on the last non-recovery week.';
}

interface LayoutInput {
  weekStart: Date;
  targetVolume: number;
  longRun: number;
  daysPerWeek: number;
  phase: PlanPhase;
  goal: RaceGoal;
  paces: PaceGuide;
  isRaceWeek: boolean;
  raceDate: Date;
  targetDistanceMeters: number;
}

/**
 * Assign the week's volume across days. Hard days are separated by easy ones and
 * the long run sits on Sunday, which is the arrangement that keeps consecutive
 * hard sessions — the most common self-coached mistake — from happening.
 */
function layOutWeek(input: LayoutInput): PlannedWorkout[] {
  const { weekStart, targetVolume, longRun, daysPerWeek, phase, goal, paces } = input;

  if (input.isRaceWeek) {
    return raceWeek(input);
  }

  const includeQuality = phase === 'build' || phase === 'peak' || phase === 'taper';
  const includeIntervals = includeQuality && goal !== 'finish' && daysPerWeek >= 4;
  const includeTempo = includeQuality && daysPerWeek >= 3;

  // Sunday long run; Tuesday and Thursday carry the quality when present.
  const runDays = pickRunDays(daysPerWeek);
  const workouts: PlannedWorkout[] = [];

  const tempoDistance = includeTempo ? Math.min(targetVolume * 0.18, 14000) : 0;
  const intervalDistance = includeIntervals ? Math.min(targetVolume * 0.13, 11000) : 0;
  const remaining = Math.max(0, targetVolume - longRun - tempoDistance - intervalDistance);
  const easyDays = runDays.filter((d) => d !== 6 && !(includeTempo && d === 3) && !(includeIntervals && d === 1));
  const perEasyDay = easyDays.length > 0 ? remaining / easyDays.length : 0;

  for (let day = 0; day < 7; day++) {
    const date = toDayKey(addDays(weekStart, day));
    if (!runDays.includes(day)) {
      workouts.push({
        dayOfWeek: day,
        date,
        type: 'rest',
        distanceMeters: 0,
        description: 'Rest or cross-train. Rest days are part of the plan, not a gap in it.',
        targetPace: null,
        intensity: 'rest',
      });
      continue;
    }

    if (day === 6) {
      workouts.push({
        dayOfWeek: day,
        date,
        type: 'long',
        distanceMeters: Math.round(longRun),
        description:
          `Long run, ${(longRun / 1000).toFixed(1)} km at a conversational effort. Time on feet is the objective — ` +
          `if you cannot speak in full sentences you are running it too hard.`,
        targetPace: paces.long,
        intensity: 'moderate',
      });
    } else if (includeIntervals && day === 1) {
      const reps = Math.max(4, Math.round((intervalDistance * 0.55) / 800));
      workouts.push({
        dayOfWeek: day,
        date,
        type: 'intervals',
        distanceMeters: Math.round(intervalDistance),
        description:
          `Intervals: 2 km warm-up, ${reps} × 800 m at ${paces.intervals.formatted} with 2:30 jog recovery, 2 km cool-down.`,
        targetPace: paces.intervals,
        intensity: 'high',
      });
    } else if (includeTempo && day === 3) {
      const tempoBlock = Math.max(3000, tempoDistance * 0.55);
      workouts.push({
        dayOfWeek: day,
        date,
        type: 'tempo',
        distanceMeters: Math.round(tempoDistance),
        description:
          `Tempo: 2 km warm-up, ${(tempoBlock / 1000).toFixed(1)} km continuous at ${paces.tempo.formatted}, 2 km cool-down. ` +
          `Comfortably hard — sustainable for about an hour if you had to.`,
        targetPace: paces.tempo,
        intensity: 'high',
      });
    } else {
      const isDayAfterHard = (includeIntervals && day === 2) || (includeTempo && day === 4);
      workouts.push({
        dayOfWeek: day,
        date,
        type: isDayAfterHard ? 'recovery' : 'easy',
        distanceMeters: Math.round(perEasyDay),
        description: isDayAfterHard
          ? `Recovery run, ${(perEasyDay / 1000).toFixed(1)} km. Deliberately slow — this exists to flush yesterday's session, not to add fitness.`
          : `Easy run, ${(perEasyDay / 1000).toFixed(1)} km at an aerobic effort.`,
        targetPace: isDayAfterHard ? paces.recovery : paces.easy,
        intensity: 'low',
      });
    }
  }

  return workouts;
}

function raceWeek(input: LayoutInput): PlannedWorkout[] {
  const { weekStart, paces, targetDistanceMeters, raceDate } = input;
  const raceDay = clamp(daysBetween(weekStart, raceDate), 0, 6);
  const shakeout = Math.min(5000, targetDistanceMeters * 0.15);

  const workouts: PlannedWorkout[] = [];
  for (let day = 0; day < 7; day++) {
    const date = toDayKey(addDays(weekStart, day));
    if (day === raceDay) {
      workouts.push({
        dayOfWeek: day,
        date,
        type: 'race',
        distanceMeters: targetDistanceMeters,
        description: `Race day: ${labelForDistance(targetDistanceMeters)}.`,
        targetPace: null,
        intensity: 'high',
      });
    } else if (day === raceDay - 1) {
      workouts.push({
        dayOfWeek: day,
        date,
        type: 'recovery',
        distanceMeters: Math.round(shakeout * 0.6),
        description: 'Shakeout jog with 4 × 20 s strides. Just enough to keep the legs awake.',
        targetPace: paces.recovery,
        intensity: 'low',
      });
    } else if (day === raceDay - 3) {
      workouts.push({
        dayOfWeek: day,
        date,
        type: 'easy',
        distanceMeters: Math.round(shakeout),
        description: `Easy ${(shakeout / 1000).toFixed(1)} km with 3 × 90 s at race pace to sharpen without fatiguing.`,
        targetPace: paces.easy,
        intensity: 'moderate',
      });
    } else if (day < raceDay) {
      workouts.push({
        dayOfWeek: day,
        date,
        type: 'rest',
        distanceMeters: 0,
        description: 'Rest. Nothing you do this week adds fitness; plenty can subtract from it.',
        targetPace: null,
        intensity: 'rest',
      });
    } else {
      workouts.push({
        dayOfWeek: day,
        date,
        type: 'rest',
        distanceMeters: 0,
        description: 'Post-race recovery. Walk, spin, or nothing at all.',
        targetPace: null,
        intensity: 'rest',
      });
    }
  }
  return workouts;
}

/** Which weekdays to run on, given a weekly frequency. 0 = Monday, 6 = Sunday. */
function pickRunDays(daysPerWeek: number): number[] {
  const byFrequency: Record<number, number[]> = {
    3: [1, 3, 6],
    4: [1, 3, 4, 6],
    5: [0, 1, 3, 4, 6],
    6: [0, 1, 2, 3, 4, 6],
    7: [0, 1, 2, 3, 4, 5, 6],
  };
  return byFrequency[daysPerWeek] ?? byFrequency[4]!;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
