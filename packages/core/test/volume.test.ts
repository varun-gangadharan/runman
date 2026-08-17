import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import { rollingVolume, weeklyVolume, consistency } from '../src/volume.ts';
import { NOW, run, sporadicRunner, consistentRunner, emptyRunner } from './fixtures.ts';

describe('rollingVolume', () => {
  test('divides by elapsed calendar days, not by a hardcoded 4', () => {
    // The regression this whole module exists for. Thirty 6 km runs spread over
    // a year: the old `slice(0,30).sum / 4` reported 180 km / 4 = 45 km/week.
    const { activities } = sporadicRunner();
    const result = rollingVolume(activities, { endDate: NOW, windowDays: 28 });

    // Runs land every 12 days starting 5 days ago, so days 5 and 17 fall in a
    // 28-day window: 2 runs × 6 km = 12 km over 28 days = 3 km/week.
    assert.equal(result.activityCount, 2);
    assert.equal(result.distanceMeters, 12000);
    assert.equal(result.averageWeeklyDistanceMeters, (12000 / 28) * 7);
    assert.equal(result.averageWeeklyDistanceMeters, 3000);
  });

  test('a fortnight off drags the average down', () => {
    const trained = [
      run({ daysAgo: 15, km: 10, paceSecPerKm: 330 }),
      run({ daysAgo: 17, km: 10, paceSecPerKm: 330 }),
      run({ daysAgo: 19, km: 10, paceSecPerKm: 330 }),
      run({ daysAgo: 21, km: 10, paceSecPerKm: 330 }),
    ];
    const result = rollingVolume(trained, { endDate: NOW, windowDays: 28 });
    // 40 km over 28 days = 10 km/week, even though the four runs themselves
    // happened inside a single week.
    assert.equal(result.averageWeeklyDistanceMeters, 10000);
    assert.equal(result.runDays, 4);
  });

  test('counts distinct run days, not activities', () => {
    const doubles = [
      run({ daysAgo: 2, km: 8, paceSecPerKm: 330, name: 'AM' }),
      { ...run({ daysAgo: 2, km: 6, paceSecPerKm: 330, name: 'PM' }), startDate: run({ daysAgo: 2, km: 6, paceSecPerKm: 330 }).startDate },
      run({ daysAgo: 4, km: 10, paceSecPerKm: 330 }),
    ];
    const result = rollingVolume(doubles, { endDate: NOW, windowDays: 28 });
    assert.equal(result.activityCount, 3);
    assert.equal(result.runDays, 2);
  });

  test('empty history yields zeros rather than NaN', () => {
    const result = rollingVolume(emptyRunner().activities, { endDate: NOW, windowDays: 28 });
    assert.equal(result.activityCount, 0);
    assert.equal(result.averageWeeklyDistanceMeters, 0);
    assert.ok(Number.isFinite(result.averageWeeklyDistanceMeters));
  });
});

describe('weeklyVolume', () => {
  test('includes weeks with zero training', () => {
    const { activities } = sporadicRunner();
    const weeks = weeklyVolume(activities, { endDate: NOW, weeks: 12 });
    assert.equal(weeks.length, 12);
    assert.ok(weeks.some((w) => w.activityCount === 0), 'expected at least one empty week to be reported');
  });

  test('reports 12 consecutive complete weeks for a consistent runner', () => {
    const { activities } = consistentRunner();
    const weeks = weeklyVolume(activities, { endDate: NOW, weeks: 12 });
    assert.equal(weeks.length, 12);
    assert.ok(weeks.every((w) => w.activityCount > 0));
    // Weeks must come back in ascending chronological order.
    const starts = weeks.map((w) => w.weekStart);
    assert.deepEqual(starts, [...starts].sort());
  });

  test('marks the trailing partial week as incomplete', () => {
    const weeks = weeklyVolume(consistentRunner().activities, {
      endDate: new Date('2026-08-18T12:00:00.000Z'), // a Tuesday
      weeks: 4,
    });
    assert.equal(weeks[weeks.length - 1]!.isComplete, false);
  });
});

describe('consistency', () => {
  test('separates a consistent runner from a sporadic one', () => {
    const steady = consistency(consistentRunner().activities, { endDate: NOW, windowDays: 84 });
    const sporadic = consistency(sporadicRunner().activities, { endDate: NOW, windowDays: 84 });

    assert.equal(steady.activeWeekRatio, 1);
    assert.ok(steady.longestGapDays <= 4, `expected small gaps, got ${steady.longestGapDays}`);
    assert.ok(sporadic.activeWeekRatio < 0.7, `expected sporadic training, got ${sporadic.activeWeekRatio}`);
    assert.ok(sporadic.longestGapDays >= 10, `expected long gaps, got ${sporadic.longestGapDays}`);
  });
});
