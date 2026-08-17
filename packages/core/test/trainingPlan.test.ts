import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import {
  generateTrainingPlan,
  PlanGenerationError,
  MAX_WEEKLY_INCREASE,
  MAX_LONG_RUN_SHARE,
  buildPaceGuide,
} from '../src/trainingPlan.ts';
import { NOW, consistentRunner, sporadicRunner, emptyRunner, oneActivityRunner } from './fixtures.ts';

const MARATHON = 42195;
const HALF = 21097.5;

function raceIn(weeks: number): Date {
  return new Date(NOW.getTime() + weeks * 7 * 86400000);
}

describe('generateTrainingPlan', () => {
  test('starts from measured 28-day volume, not from a guess', () => {
    const { activities, profile } = consistentRunner();
    const plan = generateTrainingPlan(activities, {
      targetDistanceMeters: MARATHON,
      raceDate: raceIn(16),
      daysPerWeek: 4,
      profile,
      now: NOW,
    });

    // The fixture runs 8 + 12 + 10 + 16 = 46 km every week. Four full weeks of
    // that in the 28-day window, so the plan must start at 46 km/week.
    assert.ok(
      Math.abs(plan.startingWeeklyMeters - 46000) < 1500,
      `expected ~46 km/week, got ${plan.startingWeeklyMeters / 1000}`,
    );
  });

  test('never grows volume by more than 10% week over week', () => {
    const { activities, profile } = consistentRunner();
    const plan = generateTrainingPlan(activities, {
      targetDistanceMeters: MARATHON,
      raceDate: raceIn(18),
      profile,
      now: NOW,
    });

    // The cap applies against the last *building* week, not the last week on the
    // calendar. Stepping back up to the previous level after a deliberate down
    // week is the point of the down week, not a violation of the 10% rule.
    let lastBuildingVolume = plan.startingWeeklyMeters;
    for (const week of plan.weeks) {
      if (week.phase === 'taper' || week.phase === 'race' || week.isRecoveryWeek) continue;
      const growth = (week.targetDistanceMeters - lastBuildingVolume) / lastBuildingVolume;
      assert.ok(
        growth <= MAX_WEEKLY_INCREASE + 0.001,
        `week ${week.weekNumber} grew ${(growth * 100).toFixed(1)}% over the last building week, above the ${MAX_WEEKLY_INCREASE * 100}% cap`,
      );
      lastBuildingVolume = week.targetDistanceMeters;
    }
  });

  test('a recovery week steps back down, then the build resumes where it left off', () => {
    const { activities, profile } = consistentRunner();
    const plan = generateTrainingPlan(activities, {
      targetDistanceMeters: MARATHON,
      raceDate: raceIn(18),
      profile,
      now: NOW,
    });

    const recovery = plan.weeks.find((w) => w.isRecoveryWeek)!;
    const before = plan.weeks[recovery.weekNumber - 2]!;
    const after = plan.weeks[recovery.weekNumber]!;

    assert.ok(recovery.targetDistanceMeters < before.targetDistanceMeters * 0.85, 'recovery week must be a real step down');
    assert.ok(
      after.targetDistanceMeters <= before.targetDistanceMeters * (1 + MAX_WEEKLY_INCREASE) + 1,
      'the week after recovery must not overshoot the pre-recovery volume by more than 10%',
    );
  });

  test('inserts a recovery week every fourth week', () => {
    const { activities, profile } = consistentRunner();
    const plan = generateTrainingPlan(activities, {
      targetDistanceMeters: MARATHON,
      raceDate: raceIn(16),
      profile,
      now: NOW,
    });

    const recoveryWeeks = plan.weeks.filter((w) => w.isRecoveryWeek);
    assert.ok(recoveryWeeks.length >= 2, `expected recovery weeks, got ${recoveryWeeks.length}`);
    for (const week of recoveryWeeks) {
      const previous = plan.weeks[week.weekNumber - 2]!;
      assert.ok(
        week.targetDistanceMeters < previous.targetDistanceMeters,
        `recovery week ${week.weekNumber} should be lighter than the week before it`,
      );
    }
  });

  test('caps the long run at a safe share of weekly volume', () => {
    const { activities, profile } = consistentRunner();
    const plan = generateTrainingPlan(activities, {
      targetDistanceMeters: MARATHON,
      raceDate: raceIn(16),
      profile,
      now: NOW,
    });

    for (const week of plan.weeks) {
      if (week.phase === 'race') continue;
      assert.ok(
        week.longRunMeters <= week.targetDistanceMeters * MAX_LONG_RUN_SHARE + 1,
        `week ${week.weekNumber}: long run ${week.longRunMeters} exceeds ${MAX_LONG_RUN_SHARE * 100}% of ${week.targetDistanceMeters}`,
      );
      assert.ok(week.longRunMeters <= 34001, 'long run should never exceed the 34 km ceiling');
    }
  });

  test('tapers into race week and puts the race on the right day', () => {
    const { activities, profile } = consistentRunner();
    const raceDate = raceIn(16);
    const plan = generateTrainingPlan(activities, {
      targetDistanceMeters: MARATHON,
      raceDate,
      profile,
      now: NOW,
    });

    const taperWeeks = plan.weeks.filter((w) => w.phase === 'taper');
    assert.ok(taperWeeks.length >= 2, 'a 16-week plan should carry a multi-week taper');

    const raceWeek = plan.weeks[plan.weeks.length - 1]!;
    assert.equal(raceWeek.phase, 'race');
    const raceWorkout = raceWeek.workouts.find((w) => w.type === 'race')!;
    assert.ok(raceWorkout, 'race week must contain the race');
    assert.equal(raceWorkout.distanceMeters, MARATHON);

    // Peak volume must be behind the athlete by race week.
    assert.ok(raceWeek.targetDistanceMeters < plan.peakWeeklyMeters);
  });

  test('never schedules two hard sessions back to back', () => {
    const { activities, profile } = consistentRunner();
    const plan = generateTrainingPlan(activities, {
      targetDistanceMeters: HALF,
      raceDate: raceIn(12),
      daysPerWeek: 5,
      goal: 'pr',
      profile,
      now: NOW,
    });

    for (const week of plan.weeks) {
      if (week.phase === 'race') continue;
      for (let day = 1; day < week.workouts.length; day++) {
        const previous = week.workouts[day - 1]!;
        const current = week.workouts[day]!;
        assert.ok(
          !(previous.intensity === 'high' && current.intensity === 'high'),
          `week ${week.weekNumber}: back-to-back hard days on ${previous.date} and ${current.date}`,
        );
      }
    }
  });

  test('derives paces from threshold rather than from an all-activity average', () => {
    const { activities } = consistentRunner();
    const paces = buildPaceGuide(activities)!;

    // Easy must be slower than tempo, which must be slower than intervals.
    assert.ok(paces.easy.minSecondsPerKm > paces.tempo.maxSecondsPerKm);
    assert.ok(paces.tempo.minSecondsPerKm > paces.intervals.maxSecondsPerKm);
    assert.ok(paces.recovery.minSecondsPerKm > paces.easy.minSecondsPerKm);
    // And threshold must sit between the fixture's tempo and race efforts.
    assert.ok(paces.thresholdSecondsPerKm > 250 && paces.thresholdSecondsPerKm < 320,
      `threshold pace ${paces.thresholdSecondsPerKm} s/km is outside the plausible band for this fixture`);
  });

  test('weekly workout distances add up to the weekly target', () => {
    const { activities, profile } = consistentRunner();
    const plan = generateTrainingPlan(activities, {
      targetDistanceMeters: HALF,
      raceDate: raceIn(12),
      daysPerWeek: 4,
      profile,
      now: NOW,
    });

    for (const week of plan.weeks) {
      if (week.phase === 'race') continue;
      const summed = week.workouts.reduce((total, w) => total + w.distanceMeters, 0);
      assert.ok(
        Math.abs(summed - week.targetDistanceMeters) / week.targetDistanceMeters < 0.05,
        `week ${week.weekNumber}: workouts sum to ${summed} but the target is ${week.targetDistanceMeters}`,
      );
    }
  });

  test('honours the requested number of running days', () => {
    const { activities, profile } = consistentRunner();
    for (const daysPerWeek of [3, 4, 5, 6]) {
      const plan = generateTrainingPlan(activities, {
        targetDistanceMeters: HALF,
        raceDate: raceIn(12),
        daysPerWeek,
        profile,
        now: NOW,
      });
      const buildWeek = plan.weeks.find((w) => w.phase === 'build')!;
      const running = buildWeek.workouts.filter((w) => w.type !== 'rest').length;
      assert.equal(running, daysPerWeek);
    }
  });

  test('caps an unrealistic requested peak and says it did', () => {
    const { activities, profile } = consistentRunner();
    const plan = generateTrainingPlan(activities, {
      targetDistanceMeters: MARATHON,
      raceDate: raceIn(12),
      peakWeeklyMeters: 160000, // 160 km/week from a 46 km/week base
      profile,
      now: NOW,
    });

    assert.ok(plan.peakWeeklyMeters < 160000);
    assert.ok(plan.warnings.some((w) => w.includes('Capped at')), 'the cap must be surfaced, not applied silently');
  });

  test('refuses to plan without recent training rather than guessing a baseline', () => {
    assert.throws(
      () =>
        generateTrainingPlan(emptyRunner().activities, {
          targetDistanceMeters: HALF,
          raceDate: raceIn(12),
          now: NOW,
        }),
      (error: unknown) => error instanceof PlanGenerationError && error.code === 'insufficient_history',
    );

    // Sporadic runner has history but nothing in the last 28 days worth building on.
    const sporadic = generateTrainingPlan(sporadicRunner().activities, {
      targetDistanceMeters: HALF,
      raceDate: raceIn(12),
      now: NOW,
    });
    assert.ok(sporadic.warnings.length > 0, 'a sparse history must produce warnings');
  });

  test('rejects a race window that is too short or too far out', () => {
    const { activities, profile } = consistentRunner();
    for (const [weeks, code] of [[3, 'window_too_short'], [40, 'window_too_long']] as const) {
      assert.throws(
        () =>
          generateTrainingPlan(activities, {
            targetDistanceMeters: MARATHON,
            raceDate: raceIn(weeks),
            profile,
            now: NOW,
          }),
        (error: unknown) => error instanceof PlanGenerationError && error.code === code,
      );
    }
  });

  test('warns when the goal race dwarfs anything recently run', () => {
    const { activities } = oneActivityRunner();
    // A single 5 km run, then a marathon plan.
    let plan;
    try {
      plan = generateTrainingPlan(activities, {
        targetDistanceMeters: MARATHON,
        raceDate: raceIn(16),
        now: NOW,
      });
    } catch (error) {
      assert.ok(error instanceof PlanGenerationError);
      return; // Refusing outright is also an acceptable answer here.
    }
    assert.ok(plan.warnings.some((w) => w.includes('aggressive jump')));
  });
});
