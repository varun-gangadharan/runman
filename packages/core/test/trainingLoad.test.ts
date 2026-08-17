import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import { buildLoadScorer, computeLoadSeries, CTL_TIME_CONSTANT_DAYS, ATL_TIME_CONSTANT_DAYS } from '../src/trainingLoad.ts';
import {
  NOW,
  consistentRunner,
  noHeartRateRunner,
  oneActivityRunner,
  emptyRunner,
  spikingRunner,
  run,
} from './fixtures.ts';

describe('activity load scoring', () => {
  test('scores heart-rate activities with Banister TRIMP against the athlete own max', () => {
    const profile = { sex: 'male' as const, maxHeartRate: 200, restingHeartRate: 50 };
    const activity = run({ daysAgo: 1, km: 10, paceSecPerKm: 360, hr: 150 }); // 60 minutes exactly
    const scorer = buildLoadScorer([activity], profile);
    const scored = scorer.score(activity);

    // HRr = (150 - 50) / (200 - 50) = 0.6667
    // TRIMP = 60 min × 0.6667 × 0.64 × e^(1.92 × 0.6667) = 60 × 0.6667 × 0.64 × 3.6039
    const hrr = (150 - 50) / (200 - 50);
    const expected = 60 * hrr * 0.64 * Math.exp(1.92 * hrr);
    assert.ok(Math.abs(scored.load - expected) < 0.01, `expected ${expected}, got ${scored.load}`);
    assert.equal(scored.method, 'trimp_hr');
    assert.equal(scored.confidence, 'high');
  });

  test('uses the female TRIMP constants when the profile says so', () => {
    const activity = run({ daysAgo: 1, km: 10, paceSecPerKm: 360, hr: 150 });
    const male = buildLoadScorer([activity], { sex: 'male', maxHeartRate: 200, restingHeartRate: 50 }).score(activity);
    const female = buildLoadScorer([activity], { sex: 'female', maxHeartRate: 200, restingHeartRate: 50 }).score(activity);
    assert.notEqual(male.load, female.load);
  });

  test('two runs of equal duration but different intensity score differently without HR', () => {
    // The core regression: the old code assigned `intensity = 0.8` to every
    // HR-less activity, so these two scored identically.
    const { activities } = noHeartRateRunner();
    const hard = run({ daysAgo: 1, km: 12, paceSecPerKm: 300 }); // 60 min at tempo
    const easy = run({ daysAgo: 2, km: 10, paceSecPerKm: 360 }); // 60 min easy

    const scorer = buildLoadScorer([...activities, hard, easy], {});
    const hardLoad = scorer.score(hard);
    const easyLoad = scorer.score(easy);

    assert.equal(hard.movingTimeSeconds, easy.movingTimeSeconds, 'fixture check: equal duration');
    assert.ok(
      hardLoad.load > easyLoad.load * 1.2,
      `the harder run must score materially higher (${hardLoad.load} vs ${easyLoad.load})`,
    );
    assert.notEqual(hardLoad.method, 'duration_only');
  });

  test('labels a duration-only fallback as an assumption instead of hiding it', () => {
    // No HR anywhere, and no distance to derive pace from — the only case where
    // a flat assumption is unavoidable. It must say so.
    const noDistance = {
      ...run({ daysAgo: 1, km: 5, paceSecPerKm: 300 }),
      distanceMeters: 0,
      averageHeartrate: null,
      maxHeartrate: null,
    };
    const scorer = buildLoadScorer([noDistance], {});
    const scored = scorer.score(noDistance);

    assert.equal(scored.method, 'duration_only');
    assert.equal(scored.confidence, 'low');
    assert.match(scored.explanation, /assumption, not a measurement/);
  });

  test('rescales pace-scored activities onto the heart-rate scale in a mixed history', () => {
    const { activities, profile } = consistentRunner();
    const scorer = buildLoadScorer(activities, profile);
    assert.equal(scorer.primaryMethod, 'trimp_hr');
    assert.ok(scorer.paceCalibrationFactor !== null, 'expected a calibration factor from overlapping activities');

    const withoutHr = { ...activities[0]!, id: 'no-hr', averageHeartrate: null, maxHeartrate: null };
    const withHr = activities[0]!;
    const a = scorer.score(withoutHr);
    const b = scorer.score(withHr);

    assert.equal(a.method, 'pace_calibrated');
    // Same activity, one with HR stripped: the two scores must land in the same
    // ballpark, not on two incompatible scales.
    assert.ok(a.load > b.load * 0.5 && a.load < b.load * 2, `${a.load} vs ${b.load} are not on a comparable scale`);
  });

  test('reports heart-rate coverage honestly', () => {
    assert.equal(buildLoadScorer(consistentRunner().activities, consistentRunner().profile).heartRateCoverage, 1);
    assert.equal(buildLoadScorer(noHeartRateRunner().activities, {}).heartRateCoverage, 0);
  });
});

describe('computeLoadSeries', () => {
  test('includes every calendar day, rest days included', () => {
    const { activities, profile } = consistentRunner();
    const summary = computeLoadSeries(activities, { endDate: NOW, days: 30, profile })!;

    assert.equal(summary.series.length, 30);
    assert.ok(summary.series.some((d) => d.activityCount === 0), 'rest days must appear in the series');
    // Days must be strictly consecutive.
    for (let i = 1; i < summary.series.length; i++) {
      const previous = new Date(`${summary.series[i - 1]!.date}T00:00:00Z`).getTime();
      const current = new Date(`${summary.series[i]!.date}T00:00:00Z`).getTime();
      assert.equal(current - previous, 86400000);
    }
  });

  test('CTL and ATL follow the exponential update, with rest days pulling them down', () => {
    // One 60-minute run, then nine days off.
    const activities = [run({ daysAgo: 9, km: 10, paceSecPerKm: 360, hr: 150 })];
    const summary = computeLoadSeries(activities, {
      endDate: NOW,
      days: 10,
      profile: { sex: 'male', maxHeartRate: 200, restingHeartRate: 50 },
    })!;

    const hrr = (150 - 50) / (200 - 50);
    const load = 60 * hrr * 0.64 * Math.exp(1.92 * hrr);
    const ctlAlpha = 1 - Math.exp(-1 / CTL_TIME_CONSTANT_DAYS);
    const atlAlpha = 1 - Math.exp(-1 / ATL_TIME_CONSTANT_DAYS);

    let ctl = load * ctlAlpha;
    let atl = load * atlAlpha;
    for (let i = 0; i < 9; i++) {
      ctl += (0 - ctl) * ctlAlpha;
      atl += (0 - atl) * atlAlpha;
    }

    assert.ok(Math.abs(summary.current.ctl - Math.round(ctl * 10) / 10) < 0.2, `ctl ${summary.current.ctl} vs ${ctl}`);
    assert.ok(Math.abs(summary.current.atl - Math.round(atl * 10) / 10) < 0.2, `atl ${summary.current.atl} vs ${atl}`);

    // Both decay across the nine rest days, and fatigue decays proportionally
    // faster than fitness — the 7-day constant unwinds sooner than the 42-day one.
    const firstDay = summary.series[0]!;
    assert.ok(summary.current.atl < firstDay.atl);
    assert.ok(summary.current.ctl < firstDay.ctl);
    assert.ok(
      summary.current.atl / summary.current.ctl < firstDay.atl / firstDay.ctl,
      'the acute:chronic ratio must fall during a rest block',
    );
  });

  test('flags a load spike as ramping', () => {
    const { activities, profile } = spikingRunner();
    const summary = computeLoadSeries(activities, { endDate: NOW, days: 42, profile })!;
    assert.ok(summary.acuteChronicRatio > 1.3, `expected a spike, got ACWR ${summary.acuteChronicRatio}`);
    assert.equal(summary.trend, 'ramping');
  });

  test('warns when there is not enough history for the fitness figure to mean anything', () => {
    const { activities } = oneActivityRunner();
    const summary = computeLoadSeries(activities, { endDate: NOW, days: 30 })!;
    assert.ok(summary.warmupDays < CTL_TIME_CONSTANT_DAYS);
    assert.match(summary.explanation, /warming up/);
    assert.equal(summary.confidence, 'low');
  });

  test('returns null for an athlete with no activities', () => {
    assert.equal(computeLoadSeries(emptyRunner().activities, { endDate: NOW }), null);
  });

  test('a history with no heart-rate data still produces a usable series', () => {
    const { activities } = noHeartRateRunner();
    const summary = computeLoadSeries(activities, { endDate: NOW, days: 42 })!;
    assert.equal(summary.method, 'pace_threshold');
    assert.ok(summary.current.ctl > 0);
    assert.match(summary.explanation, /No usable heart-rate data/);
  });
});
