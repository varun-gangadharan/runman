import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import { deriveMaxHeartRate, heartRateZones, classifyActivity } from '../src/heartRate.ts';
import { consistentRunner, noHeartRateRunner, emptyRunner, run } from './fixtures.ts';

describe('deriveMaxHeartRate', () => {
  test('prefers a profile value over anything observed', () => {
    const { activities } = consistentRunner();
    const derived = deriveMaxHeartRate(activities, { maxHeartRate: 195 })!;
    assert.equal(derived.value, 195);
    assert.equal(derived.method, 'profile');
    assert.equal(derived.confidence, 'high');
  });

  test('falls back to the highest corroborated observed reading', () => {
    const { activities } = consistentRunner();
    const derived = deriveMaxHeartRate(activities, {})!;
    assert.equal(derived.method, 'observed');
    assert.equal(derived.value, 189); // highest max_heartrate in the fixture
  });

  test('ignores an isolated strap spike', () => {
    const activities = [
      run({ daysAgo: 1, km: 10, paceSecPerKm: 330, hr: 150, maxHr: 175 }),
      run({ daysAgo: 3, km: 10, paceSecPerKm: 330, hr: 150, maxHr: 178 }),
      run({ daysAgo: 5, km: 10, paceSecPerKm: 330, hr: 150, maxHr: 176 }),
      run({ daysAgo: 7, km: 10, paceSecPerKm: 330, hr: 150, maxHr: 174 }),
      run({ daysAgo: 9, km: 10, paceSecPerKm: 330, hr: 150, maxHr: 229 }), // spike
    ];
    const derived = deriveMaxHeartRate(activities, {})!;
    assert.ok(derived.value <= 190, `a lone 229 bpm spike should not set max HR, got ${derived.value}`);
  });

  test('uses the Tanaka age formula only as a last resort, and says so', () => {
    const { activities } = noHeartRateRunner();
    const derived = deriveMaxHeartRate(activities, { age: 30 })!;
    assert.equal(derived.method, 'age_estimate');
    assert.equal(derived.value, Math.round(211 - 0.64 * 30)); // 192
    assert.equal(derived.confidence, 'low');
    assert.match(derived.explanation, /±7 bpm/);
  });

  test('returns null rather than inventing a max HR', () => {
    assert.equal(deriveMaxHeartRate(noHeartRateRunner().activities, {}), null);
    assert.equal(deriveMaxHeartRate(emptyRunner().activities, {}), null);
  });
});

describe('heartRateZones', () => {
  test('zones scale to the individual, not to fixed bpm thresholds', () => {
    const young = heartRateZones([], { maxHeartRate: 200 })!;
    const older = heartRateZones([], { maxHeartRate: 180 })!;

    assert.equal(young.zones[1]!.maxBpm, 140); // 70% of 200
    assert.equal(older.zones[1]!.maxBpm, 126); // 70% of 180

    // The old code called anything under 130 bpm "easy" for both athletes. On
    // the 180-max runner, 130 bpm is already tempo — the fixed thresholds put
    // a genuinely hard effort in the same bucket as a recovery jog.
    const at130 = (zones: typeof young): number =>
      zones.zones.find((z) => 130 < z.maxBpm)!.index;
    assert.equal(at130(young), 2);
    assert.equal(at130(older), 3);
  });

  test('uses Karvonen heart-rate reserve when a resting HR is known', () => {
    const withRest = heartRateZones([], { maxHeartRate: 200, restingHeartRate: 50 })!;
    assert.equal(withRest.scale, 'hrr');
    // Z2 upper = 50 + 0.70 × (200 − 50) = 155
    assert.equal(withRest.zones[1]!.maxBpm, 155);

    const withoutRest = heartRateZones([], { maxHeartRate: 200 })!;
    assert.equal(withoutRest.scale, 'pct_max');
    assert.equal(withoutRest.zones[1]!.maxBpm, 140);
  });

  test('produces five contiguous ascending zones', () => {
    const zoneSet = heartRateZones([], { maxHeartRate: 190, restingHeartRate: 45 })!;
    assert.equal(zoneSet.zones.length, 5);
    for (let i = 1; i < zoneSet.zones.length; i++) {
      assert.equal(zoneSet.zones[i]!.minBpm, zoneSet.zones[i - 1]!.maxBpm);
    }
    assert.equal(zoneSet.zones[4]!.maxBpm, 190);
  });

  test('classifies an activity into the athlete own zone', () => {
    // Karvonen bands for max 200 / rest 50: Z1 125–140, Z2 140–155,
    // Z3 155–170, Z4 170–185, Z5 185–200.
    const zoneSet = heartRateZones([], { maxHeartRate: 200, restingHeartRate: 50 })!;
    const recovery = run({ daysAgo: 1, km: 10, paceSecPerKm: 400, hr: 130 });
    const easy = run({ daysAgo: 1, km: 10, paceSecPerKm: 360, hr: 150 });
    const hard = run({ daysAgo: 1, km: 10, paceSecPerKm: 300, hr: 190 });

    assert.equal(classifyActivity(recovery, zoneSet)!.index, 1);
    assert.equal(classifyActivity(easy, zoneSet)!.index, 2);
    assert.equal(classifyActivity(hard, zoneSet)!.index, 5);
    assert.equal(classifyActivity({ ...easy, averageHeartrate: null }, zoneSet), null);
  });

  test('returns null when there is nothing to derive zones from', () => {
    assert.equal(heartRateZones(noHeartRateRunner().activities, {}), null);
  });
});
