import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import { predictRaceTime } from '../src/racePrediction.ts';
import { assessActivity, worldRecordSpeedMps } from '../src/dataQuality.ts';
import {
  NOW,
  consistentRunner,
  gpsGlitchRunner,
  oneActivityRunner,
  emptyRunner,
  run,
} from './fixtures.ts';

const MARATHON = 42195;
const HALF = 21097.5;
const TEN_K = 10000;

describe('predictRaceTime', () => {
  test('uses a personal power-law fit when several distances are available', () => {
    const { activities } = consistentRunner();
    const prediction = predictRaceTime(activities, MARATHON, { now: NOW })!;

    assert.equal(prediction.method, 'personal_power_law');
    assert.ok(prediction.basedOn.length >= 3, 'expected at least three reference efforts');
    // The fixture's efforts sit on T = a·D^1.06, so the fit must recover ~1.06.
    assert.ok(
      Math.abs(prediction.exponent - 1.06) < 0.02,
      `expected the fitted exponent to recover 1.06, got ${prediction.exponent}`,
    );
  });

  test('is traceable: every prediction names the activities behind it', () => {
    const { activities } = consistentRunner();
    const prediction = predictRaceTime(activities, HALF, { now: NOW })!;

    assert.ok(prediction.basedOn.length > 0);
    for (const reference of prediction.basedOn) {
      assert.ok(reference.activityId, 'reference effort must carry an activity id');
      assert.ok(reference.activityName, 'reference effort must carry an activity name');
      assert.ok(reference.date, 'reference effort must carry a date');
      assert.ok(reference.formattedTime.length > 0);
      // The id must correspond to a real activity in the input.
      assert.ok(activities.some((a) => a.id === reference.activityId));
    }
  });

  test('ignores a GPS glitch that the old fastest-pace selector would have chosen', () => {
    const { activities } = gpsGlitchRunner();
    const glitch = activities.find((a) => a.name === 'Tunnel GPS glitch')!;

    // Confirm the fixture really is the fastest-paced activity in the set — that
    // is precisely why the old selector picked it.
    const fastest = activities.reduce((best, a) =>
      a.distanceMeters / a.movingTimeSeconds > best.distanceMeters / best.movingTimeSeconds ? a : best,
    );
    assert.equal(fastest.id, glitch.id, 'fixture should be the fastest activity by pace');

    const prediction = predictRaceTime(activities, MARATHON, { now: NOW })!;
    assert.ok(
      !prediction.basedOn.some((r) => r.activityId === glitch.id),
      'glitch activity must not be used as a reference effort',
    );
    assert.ok(
      prediction.excluded.some((e) => e.activityId === glitch.id),
      'glitch activity must be reported as excluded, with a reason',
    );
    assert.ok(
      prediction.excluded
        .find((e) => e.activityId === glitch.id)!
        .reasons.some((r) => r.includes('world record')),
      'exclusion reason must state why',
    );
  });

  test('a glitch does not change the predicted time', () => {
    const clean = predictRaceTime(consistentRunner().activities, MARATHON, { now: NOW })!;
    const dirty = predictRaceTime(gpsGlitchRunner().activities, MARATHON, { now: NOW })!;
    assert.equal(clean.predictedSeconds, dirty.predictedSeconds);
  });

  test('produces a physically plausible marathon time', () => {
    const { activities } = consistentRunner();
    const prediction = predictRaceTime(activities, MARATHON, { now: NOW })!;
    // A runner with a 21:30 5K and a 1:38:47 half predicts to roughly 3:25–3:40.
    assert.ok(
      prediction.predictedSeconds > 3 * 3600 && prediction.predictedSeconds < 4 * 3600,
      `expected a 3–4 hour marathon, got ${prediction.formattedTime}`,
    );
    assert.ok(prediction.predictedSeconds / MARATHON * 1000 > 250, 'predicted pace must be slower than half-marathon pace');
  });

  test('the goal changes pacing advice but never the prediction', () => {
    const { activities } = consistentRunner();
    const finish = predictRaceTime(activities, TEN_K, { goal: 'finish', now: NOW })!;
    const compete = predictRaceTime(activities, TEN_K, { goal: 'compete', now: NOW })!;
    const pr = predictRaceTime(activities, TEN_K, { goal: 'pr', now: NOW })!;

    // The old implementation multiplied by 0.90 for 'compete' and 1.05 for
    // 'finish' — a 15% swing produced by a dropdown.
    assert.equal(finish.predictedSeconds, compete.predictedSeconds);
    assert.equal(finish.predictedSeconds, pr.predictedSeconds);
    assert.notEqual(finish.pacingAdvice, compete.pacingAdvice);
    assert.notEqual(finish.pacingAdvice, pr.pacingAdvice);
  });

  test('falls back to the closest effort, not the fastest, with one distance on file', () => {
    const activities = [
      run({ daysAgo: 10, km: 5, paceSecPerKm: 240, name: 'Fast 5K' }),
      run({ daysAgo: 20, km: 20, paceSecPerKm: 300, name: 'Slower 20K' }),
    ];
    const prediction = predictRaceTime(activities, HALF, { now: NOW })!;

    assert.equal(prediction.method, 'riegel_closest_effort');
    assert.equal(prediction.basedOn.length, 1);
    // 20 km is far closer to a half marathon than 5 km, despite being slower.
    assert.equal(prediction.basedOn[0]!.activityName, 'Slower 20K');
  });

  test('widens the range and lowers confidence when extrapolating far', () => {
    const nearby = predictRaceTime(consistentRunner().activities, HALF, { now: NOW })!;
    const distant = predictRaceTime(consistentRunner().activities, 50000, { now: NOW })!;

    const spread = (p: typeof nearby): number =>
      (p.range.conservativeSeconds - p.range.optimisticSeconds) / p.predictedSeconds;
    assert.ok(spread(distant) > spread(nearby), 'a longer extrapolation must carry a wider range');
    assert.ok(distant.explanation.includes('outside the range'));
  });

  test('returns null rather than a fabricated number with no usable data', () => {
    assert.equal(predictRaceTime(emptyRunner().activities, TEN_K, { now: NOW }), null);
    // A single 5 km run is enough for a low-confidence estimate, but not a fit.
    const single = predictRaceTime(oneActivityRunner().activities, TEN_K, { now: NOW })!;
    assert.equal(single.method, 'riegel_closest_effort');
    assert.equal(single.confidence, 'medium');
  });

  test('every prediction carries a confidence and an explanation', () => {
    for (const target of [5000, TEN_K, HALF, MARATHON]) {
      const prediction = predictRaceTime(consistentRunner().activities, target, { now: NOW })!;
      assert.ok(['high', 'medium', 'low'].includes(prediction.confidence));
      assert.ok(prediction.explanation.length > 40, 'explanation must be substantive');
    }
  });
});

describe('plausibility screening', () => {
  test('the world-record curve slows monotonically with distance', () => {
    const distances = [800, 1500, 5000, 10000, 21097.5, 42195];
    for (let i = 1; i < distances.length; i++) {
      assert.ok(
        worldRecordSpeedMps(distances[i]!) < worldRecordSpeedMps(distances[i - 1]!),
        `speed should fall from ${distances[i - 1]}m to ${distances[i]}m`,
      );
    }
  });

  test('flags the specific failure modes, individually', () => {
    assert.deepEqual(assessActivity(run({ daysAgo: 1, km: 0.4, paceSecPerKm: 300 })).flags, ['too_short']);
    assert.ok(assessActivity(run({ daysAgo: 1, km: 5, paceSecPerKm: 60 })).flags.includes('faster_than_world_record'));
    assert.ok(assessActivity(run({ daysAgo: 1, km: 5, paceSecPerKm: 900 })).flags.includes('implausibly_slow'));
    assert.ok(
      assessActivity(run({ daysAgo: 1, km: 5, paceSecPerKm: 300, elapsedSeconds: 6000 })).flags.includes('heavy_autopause'),
    );
    assert.deepEqual(assessActivity(run({ daysAgo: 1, km: 10, paceSecPerKm: 330 })).flags, ['ok']);
  });
});
