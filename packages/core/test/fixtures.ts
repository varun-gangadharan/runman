/**
 * The canonical fixture set.
 *
 * These same athletes are the golden inputs for RunCoach's tool tests, so that
 * "what should this data produce" has exactly one definition across both repos.
 * Each fixture targets a failure mode that the previous implementation got
 * wrong, and the adversarial ones exist specifically to keep those regressions
 * from coming back.
 */

import type { Activity, AthleteProfile } from '../src/types.ts';

/** Fixed clock. Every fixture is dated relative to this so tests never drift. */
export const NOW = new Date('2026-08-17T12:00:00.000Z');

export function daysAgo(n: number, hour = 8): string {
  const d = new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

let idCounter = 0;

export interface RunSpec {
  daysAgo: number;
  km: number;
  /** Pace in seconds per kilometre. */
  paceSecPerKm: number;
  hr?: number | null;
  maxHr?: number | null;
  elevationM?: number;
  name?: string;
  isRace?: boolean;
  /** Defaults to moving time; set explicitly to simulate auto-pause. */
  elapsedSeconds?: number;
}

export function run(spec: RunSpec): Activity {
  const distanceMeters = spec.km * 1000;
  const movingTimeSeconds = Math.round(spec.km * spec.paceSecPerKm);
  return {
    id: `fixture-${++idCounter}`,
    name: spec.name ?? `${spec.km} km run`,
    type: 'Run',
    startDate: daysAgo(spec.daysAgo),
    distanceMeters,
    movingTimeSeconds,
    elapsedTimeSeconds: spec.elapsedSeconds ?? movingTimeSeconds,
    totalElevationGainMeters: spec.elevationM ?? 0,
    averageHeartrate: spec.hr ?? null,
    maxHeartrate: spec.maxHr ?? (spec.hr ? spec.hr + 15 : null),
    averageSpeedMps: distanceMeters / movingTimeSeconds,
    isRace: spec.isRace ?? false,
  };
}

export function resetIds(): void {
  idCounter = 0;
}

/**
 * NOW falls on a Monday, so `weeksAgo × 7` lands on the Monday starting that ISO
 * week and subtracting the weekday index walks forward through it. Anchoring the
 * fixtures to real week boundaries keeps weekly-bucketing assertions meaningful
 * rather than accidents of where a 7-day stride happened to land.
 */
export function runOnWeekday(weeksAgo: number, weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6, spec: Omit<RunSpec, 'daysAgo'>): Activity | null {
  const offset = weeksAgo * 7 - weekday;
  return offset < 0 ? null : run({ ...spec, daysAgo: offset });
}

/**
 * Consistent club runner: ~46 km/week for six months, heart rate on everything,
 * and best efforts at 5K, 10K and half marathon that sit on a clean power law.
 * The "everything works" baseline.
 */
export function consistentRunner(): { activities: Activity[]; profile: AthleteProfile } {
  const activities: Activity[] = [];
  // 24 ISO weeks of Monday / Tuesday / Thursday / Sunday training.
  const template: Array<[weekday: 0 | 1 | 3 | 6, spec: Omit<RunSpec, 'daysAgo'>]> = [
    [0, { km: 8, paceSecPerKm: 355, hr: 138, maxHr: 150, name: 'Recovery' }],
    [1, { km: 12, paceSecPerKm: 300, hr: 165, maxHr: 178, name: 'Tempo' }],
    [3, { km: 10, paceSecPerKm: 345, hr: 142, maxHr: 155, name: 'Easy run' }],
    [6, { km: 16, paceSecPerKm: 330, hr: 148, maxHr: 162, name: 'Long run' }],
  ];
  for (let week = 0; week < 24; week++) {
    for (const [weekday, spec] of template) {
      const activity = runOnWeekday(week, weekday, spec);
      if (activity) activities.push(activity);
    }
  }
  // Best efforts, deliberately consistent with T = a·D^1.06.
  activities.push(run({ daysAgo: 40, km: 5, paceSecPerKm: 258, hr: 176, maxHr: 189, name: '5K race', isRace: true }));
  activities.push(run({ daysAgo: 75, km: 10, paceSecPerKm: 269, hr: 174, maxHr: 187, name: '10K race', isRace: true }));
  activities.push(run({ daysAgo: 110, km: 21.0975, paceSecPerKm: 281, hr: 171, maxHr: 184, name: 'Half marathon', isRace: true }));

  return { activities, profile: { sex: 'male', maxHeartRate: 190, restingHeartRate: 48, age: 30 } };
}

/**
 * Same training, zero heart-rate data. Exists to prove the load model does not
 * fall back to a flat intensity multiplier — the specific bug being fixed.
 */
export function noHeartRateRunner(): { activities: Activity[]; profile: AthleteProfile } {
  const { activities } = consistentRunner();
  return {
    activities: activities.map((a) => ({ ...a, averageHeartrate: null, maxHeartrate: null })),
    profile: {},
  };
}

/** A single activity, ever. Everything downstream must degrade rather than throw. */
export function oneActivityRunner(): { activities: Activity[]; profile: AthleteProfile } {
  return {
    activities: [run({ daysAgo: 3, km: 5, paceSecPerKm: 300, hr: 160, name: 'First run' })],
    profile: {},
  };
}

/** Brand-new user with no data at all. */
export function emptyRunner(): { activities: Activity[]; profile: AthleteProfile } {
  return { activities: [], profile: {} };
}

/**
 * A consistent runner whose history contains one GPS glitch: 3 km recorded in
 * 4 minutes (12.5 m/s — faster than the 400 m world record). The old predictor
 * picked exactly this activity, because it was the fastest pace above the 30%
 * distance threshold, and produced a sub-2-hour marathon prediction.
 */
export function gpsGlitchRunner(): { activities: Activity[]; profile: AthleteProfile } {
  const { activities, profile } = consistentRunner();
  activities.push(
    run({ daysAgo: 20, km: 3, paceSecPerKm: 80, hr: 150, name: 'Tunnel GPS glitch' }),
  );
  return { activities, profile };
}

/**
 * Thirty activities spread across a full year. Sum-of-last-30 ÷ 4 reports this
 * runner at roughly 45 km/week; they actually average about 3.5.
 */
export function sporadicRunner(): { activities: Activity[]; profile: AthleteProfile } {
  const activities: Activity[] = [];
  for (let i = 0; i < 30; i++) {
    activities.push(run({ daysAgo: 5 + i * 12, km: 6, paceSecPerKm: 360, hr: 150, name: 'Occasional run' }));
  }
  return { activities, profile: {} };
}

/** Trained hard for months, then stopped 30 days ago. */
export function returningRunner(): { activities: Activity[]; profile: AthleteProfile } {
  const { activities, profile } = consistentRunner();
  return { activities: activities.filter((a) => new Date(a.startDate) < new Date(NOW.getTime() - 30 * 86400000)), profile };
}

/** Sudden volume spike: quiet base, then a huge week. Should read as overreaching. */
export function spikingRunner(): { activities: Activity[]; profile: AthleteProfile } {
  const activities: Activity[] = [];
  for (let week = 2; week < 14; week++) {
    const base = week * 7;
    activities.push(run({ daysAgo: base + 6, km: 8, paceSecPerKm: 360, hr: 140, maxHr: 155 }));
    activities.push(run({ daysAgo: base + 3, km: 6, paceSecPerKm: 360, hr: 138, maxHr: 152 }));
  }
  for (let day = 1; day <= 12; day++) {
    activities.push(run({ daysAgo: day, km: 18, paceSecPerKm: 320, hr: 168, maxHr: 182, name: 'Big week' }));
  }
  return { activities, profile: { sex: 'male', maxHeartRate: 190, restingHeartRate: 50 } };
}

/**
 * The shape that broke the curve fit on real data.
 *
 * A serious runner whose only short activities are commutes and warm-ups, and
 * whose genuine efforts are all long. The fastest sub-2 km run on file is still
 * a 6:00/km jog, which is not a best effort at any level — but it *is* the
 * fastest activity in its distance band, so it arrives as one.
 *
 * Residual-based trimming alone gets this exactly backwards: the slow short
 * points flatten the initial slope, so every genuinely fast long race becomes
 * the apparent outlier and gets discarded. On a real 675-activity history that
 * produced an exponent of 0.992 — below the physiological floor, so no curve at
 * all — after throwing away the athlete's actual marathon and keeping a commute.
 */
export function jogsAndRacesRunner(): { activities: Activity[]; profile: AthleteProfile } {
  const activities: Activity[] = [];

  // Commutes and warm-ups: short, and jogged at 6:00/km.
  activities.push(run({ daysAgo: 20, km: 1.0, paceSecPerKm: 363, hr: 120, name: 'commute to sauna' }));
  activities.push(run({ daysAgo: 35, km: 1.65, paceSecPerKm: 349, hr: 122, name: 'shakeout' }));
  activities.push(run({ daysAgo: 50, km: 2.0, paceSecPerKm: 327, hr: 125, name: 'warm-up' }));

  // Genuine efforts, sitting on T = a·D^1.08.
  activities.push(run({ daysAgo: 60, km: 5.01, paceSecPerKm: 240, hr: 176, name: '5K effort' }));
  activities.push(run({ daysAgo: 75, km: 11.32, paceSecPerKm: 255, hr: 172, name: '11K tempo' }));
  activities.push(run({ daysAgo: 95, km: 16.17, paceSecPerKm: 267, hr: 170, name: '10 mile' }));
  activities.push(run({ daysAgo: 110, km: 21.42, paceSecPerKm: 252, hr: 174, name: 'half marathon' }));
  activities.push(run({ daysAgo: 140, km: 42.83, paceSecPerKm: 294, hr: 168, name: 'marathon' }));

  // Enough ordinary volume that the athlete looks trained.
  for (let week = 0; week < 20; week++) {
    for (const [weekday, km] of [[0, 8], [2, 12], [4, 10], [6, 18]] as const) {
      const activity = runOnWeekday(week, weekday as 0 | 2 | 4 | 6, {
        km,
        paceSecPerKm: 330,
        hr: 145,
        maxHr: 160,
        name: 'Easy run',
      });
      if (activity) activities.push(activity);
    }
  }

  return { activities, profile: { sex: 'male', maxHeartRate: 190, restingHeartRate: 45 } };
}
