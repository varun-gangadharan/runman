/**
 * Composite training-status read.
 *
 * This is the synthesis layer: load trend, acute:chronic ratio, consistency and
 * volume are each individually meaningful but individually easy to misread. A
 * high acute:chronic ratio is alarming during a build and unremarkable in the
 * first week back from a break. This module combines them into one readiness
 * assessment, and — importantly — carries the caveats forward rather than
 * flattening everything into a single confident-sounding score.
 */

import { computeLoadSeries, type TrainingLoadSummary } from './trainingLoad.ts';
import { consistency, rollingVolume, type ConsistencyReport, type RollingVolume } from './volume.ts';
import { heartRateZones, type ZoneSet } from './heartRate.ts';
import type { Activity, AthleteProfile, Confidence } from './types.ts';

export type ReadinessState =
  | 'well_trained'
  | 'building_well'
  | 'overreaching'
  | 'undertrained'
  | 'detraining'
  | 'returning'
  | 'insufficient_data';

export interface TrainingStatus {
  state: ReadinessState;
  headline: string;
  /** Plain-language read, safe to hand to a user verbatim. */
  narrative: string;
  observations: string[];
  recommendations: string[];
  /** Anything that limits how much the above should be trusted. */
  caveats: string[];
  confidence: Confidence;
  metrics: {
    fitness: number | null;
    fatigue: number | null;
    form: number | null;
    acuteChronicRatio: number | null;
    weeklyDistanceKm: number;
    runsPerWeek: number;
    longestGapDays: number;
    heartRateCoverage: number | null;
  };
  load: TrainingLoadSummary | null;
  volume: RollingVolume;
  consistency: ConsistencyReport;
  zones: ZoneSet | null;
}

export interface StatusOptions {
  now?: Date;
  profile?: AthleteProfile;
  /** Window for the load trend. Defaults to 42 days. */
  windowDays?: number;
}

export function analyzeTrainingStatus(
  activities: readonly Activity[],
  options: StatusOptions = {},
): TrainingStatus {
  const now = options.now ?? new Date();
  const profile = options.profile ?? {};
  const windowDays = options.windowDays ?? 42;

  const volume = rollingVolume(activities, { endDate: now, windowDays: 28 });
  const consistencyReport = consistency(activities, { endDate: now, windowDays: 84 });
  const load = computeLoadSeries(activities, { endDate: now, days: windowDays, profile });
  const zones = heartRateZones(activities, profile);

  const weeklyKm = volume.averageWeeklyDistanceMeters / 1000;
  const caveats: string[] = [];
  const observations: string[] = [];
  const recommendations: string[] = [];

  if (activities.length === 0) {
    return emptyStatus(volume, consistencyReport, 'No activities on record yet.');
  }
  if (volume.activityCount === 0) {
    return {
      ...emptyStatus(volume, consistencyReport, `No runs in the last 28 days (last gap: ${consistencyReport.longestGapDays} days).`),
      state: 'detraining',
      headline: 'No training logged in the last four weeks',
      narrative:
        `There are no runs at all in the last 28 days, so there is no current fitness to assess. ` +
        `Whatever the history shows, four weeks off means starting the return conservatively.`,
      recommendations: [
        'Restart at roughly half the weekly volume you last sustained, and hold it for two weeks before building.',
        'Keep every run conversational for the first fortnight — the aerobic system returns faster than tendons and bone do.',
      ],
    };
  }

  const acwr = load?.acuteChronicRatio ?? null;
  const fitness = load?.current.ctl ?? null;
  const fatigue = load?.current.atl ?? null;
  const form = load?.current.tsb ?? null;

  // --- Observations -------------------------------------------------------
  observations.push(
    `Averaging ${weeklyKm.toFixed(1)} km/week over the last 28 calendar days ` +
      `(${volume.activityCount} runs across ${volume.runDays} days).`,
  );
  if (load) {
    observations.push(
      `Fitness (42-day load average) is ${fitness}, fatigue (7-day) is ${fatigue}, form is ${form! >= 0 ? '+' : ''}${form}. ` +
        `Load trend over the window: ${load.trend}.`,
    );
  }
  observations.push(
    `Trained in ${Math.round(consistencyReport.activeWeekRatio * 100)}% of the last 12 weeks, ` +
      `averaging ${consistencyReport.averageRunsPerWeek} runs/week. Longest gap: ${consistencyReport.longestGapDays} days.`,
  );
  if (consistencyReport.weeklyVariation > 0.5) {
    observations.push(
      `Week-to-week volume is uneven (variation ${consistencyReport.weeklyVariation.toFixed(2)}) — big weeks followed by ` +
        `near-empty ones, rather than a steady progression.`,
    );
  }

  // --- Caveats ------------------------------------------------------------
  if (load && load.warmupDays < 42) {
    caveats.push(
      `Only ${load.warmupDays} days of history precede this window, so the fitness figure is still warming up and reads low.`,
    );
  }
  if (load?.method === 'duration_only') {
    caveats.push(
      'No heart-rate data and not enough runs to establish a threshold pace, so load is a duration-only placeholder. ' +
        'Everything derived from it is directional at best.',
    );
  } else if (load?.method === 'pace_threshold') {
    caveats.push('No heart-rate data in this history — load is inferred from pace, which cannot see effort on a hard day at slow pace.');
  }
  if (!zones) {
    caveats.push('No heart-rate zones available: no HR data and no max HR or age on the profile.');
  } else if (zones.confidence === 'low') {
    caveats.push(`Heart-rate zones rest on an age estimate rather than measured data (${zones.explanation}).`);
  }
  if (volume.activityCount < 6) {
    caveats.push(`Only ${volume.activityCount} runs in the last 28 days — a small sample for any trend claim.`);
  }

  // --- State classification -----------------------------------------------
  const state = classify({
    acwr,
    trend: load?.trend ?? null,
    consistency: consistencyReport,
    volume,
  });

  const { headline, narrative, advice } = describe(state, {
    weeklyKm,
    acwr,
    form,
    consistency: consistencyReport,
    volume,
  });
  recommendations.push(...advice);

  const confidence: Confidence =
    load?.confidence === 'high' && volume.activityCount >= 8
      ? 'high'
      : load?.confidence === 'low' || volume.activityCount < 5
        ? 'low'
        : 'medium';

  return {
    state,
    headline,
    narrative,
    observations,
    recommendations,
    caveats,
    confidence,
    metrics: {
      fitness,
      fatigue,
      form,
      acuteChronicRatio: acwr,
      weeklyDistanceKm: Math.round(weeklyKm * 10) / 10,
      runsPerWeek: consistencyReport.averageRunsPerWeek,
      longestGapDays: consistencyReport.longestGapDays,
      heartRateCoverage: load ? null : null,
    },
    load,
    volume,
    consistency: consistencyReport,
    zones,
  };
}

function classify(input: {
  acwr: number | null;
  trend: TrainingLoadSummary['trend'] | null;
  consistency: ConsistencyReport;
  volume: RollingVolume;
}): ReadinessState {
  const { acwr, trend, consistency: c, volume } = input;

  if (volume.activityCount < 3 && c.activeWeekRatio < 0.35) return 'insufficient_data';
  if (c.longestGapDays >= 21 && volume.activityCount > 0) return 'returning';
  if (acwr !== null && acwr >= 1.5) return 'overreaching';
  if (trend === 'detraining' || (acwr !== null && acwr < 0.7 && c.activeWeekRatio < 0.7)) return 'detraining';
  if (c.activeWeekRatio < 0.6) return 'undertrained';
  if (trend === 'building' || trend === 'ramping') return 'building_well';
  return 'well_trained';
}

function describe(
  state: ReadinessState,
  ctx: { weeklyKm: number; acwr: number | null; form: number | null; consistency: ConsistencyReport; volume: RollingVolume },
): { headline: string; narrative: string; advice: string[] } {
  const km = ctx.weeklyKm.toFixed(1);
  const acwr = ctx.acwr?.toFixed(2) ?? 'unknown';

  switch (state) {
    case 'overreaching':
      return {
        headline: 'Load has spiked — back off before it costs you',
        narrative:
          `Recent training is running well ahead of what the last six weeks prepared you for: the acute-to-chronic ` +
          `workload ratio is ${acwr}, against a comfortable band of roughly 0.8–1.3. Sustained ratios above 1.5 are the ` +
          `pattern that precedes most overuse injuries. This is not a verdict on how you feel — it is a statement about ` +
          `how fast the load went up.`,
        advice: [
          'Cut the next 7 days to about 70% of the last 7 and keep every run easy.',
          'Hold the long run where it is rather than extending it again this week.',
          'If anything has been niggling, this is the week it turns into an injury if you push through.',
        ],
      };
    case 'building_well':
      return {
        headline: 'Fitness is trending up at a sustainable rate',
        narrative:
          `Volume is at ${km} km/week and chronic load is climbing without the acute load outrunning it ` +
          `(ratio ${acwr}). This is what a productive build looks like: consistent weeks, gradual progression, ` +
          `fatigue that stays proportional to fitness.`,
        advice: [
          'Keep the progression at or under 10% a week — the current trajectory is working.',
          'Schedule a down week if the last three have all been up weeks; adaptation happens in the easier ones.',
        ],
      };
    case 'detraining':
      return {
        headline: 'Fitness is receding',
        narrative:
          `Chronic load is falling and recent volume (${km} km/week) is below what the preceding weeks established. ` +
          `Aerobic fitness fades slowly — most of it survives a couple of quiet weeks — but the trend is downward, ` +
          `not flat.`,
        advice: [
          'Two or three consistent easy weeks will recover most of the loss; there is no need to make it back in one week.',
          'Prioritise frequency over distance on the way back — more short runs beat fewer long ones for re-establishing load.',
        ],
      };
    case 'returning':
      return {
        headline: `Coming back after a ${ctx.consistency.longestGapDays}-day gap`,
        narrative:
          `There is a ${ctx.consistency.longestGapDays}-day break in the recent history, so current fitness metrics ` +
          `describe a rebuilding athlete rather than a trained one. The numbers will read low and that is accurate.`,
        advice: [
          'Rebuild to your previous volume over about the same number of weeks you were off, not faster.',
          'Skip quality sessions until you have strung together two consistent weeks.',
        ],
      };
    case 'undertrained':
      return {
        headline: 'Training is too intermittent to build fitness',
        narrative:
          `Only ${Math.round(ctx.consistency.activeWeekRatio * 100)}% of the last 12 weeks contained any running, at ` +
          `${km} km/week. The limiting factor right now is consistency, not volume or intensity — sporadic weeks do not ` +
          `accumulate into fitness no matter how hard the individual sessions are.`,
        advice: [
          'Aim for three runs a week, every week, before worrying about how far or how fast any of them are.',
          'Set the bar low enough that a bad week still clears it — 20 minutes counts.',
        ],
      };
    case 'insufficient_data':
      return {
        headline: 'Not enough recent training to assess',
        narrative: 'There is too little recent activity to say anything meaningful about training status.',
        advice: ['Log two to three weeks of consistent running and the trend metrics become usable.'],
      };
    case 'well_trained':
      return {
        headline: 'Training is consistent and load is steady',
        narrative:
          `Volume is holding at ${km} km/week with an acute-to-chronic ratio of ${acwr} and regular weekly activity. ` +
          `Fitness is being maintained rather than built — which is exactly right if you are between goals, and worth ` +
          `changing if you have one coming.`,
        advice: [
          'If a race is on the calendar, this is a good base to start a structured build from.',
          'If not, maintaining here is a legitimate choice — steady beats sawtooth.',
        ],
      };
  }
}

function emptyStatus(volume: RollingVolume, consistencyReport: ConsistencyReport, reason: string): TrainingStatus {
  return {
    state: 'insufficient_data',
    headline: 'Not enough data to assess training status',
    narrative: reason,
    observations: [reason],
    recommendations: ['Connect Strava and sync some activity history, then check back.'],
    caveats: ['No metrics could be computed.'],
    confidence: 'none',
    metrics: {
      fitness: null,
      fatigue: null,
      form: null,
      acuteChronicRatio: null,
      weeklyDistanceKm: 0,
      runsPerWeek: 0,
      longestGapDays: consistencyReport.longestGapDays,
      heartRateCoverage: null,
    },
    load: null,
    volume,
    consistency: consistencyReport,
    zones: null,
  };
}
