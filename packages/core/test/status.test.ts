import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import { analyzeTrainingStatus } from '../src/status.ts';
import {
  NOW,
  consistentRunner,
  noHeartRateRunner,
  sporadicRunner,
  spikingRunner,
  returningRunner,
  emptyRunner,
  oneActivityRunner,
} from './fixtures.ts';

describe('analyzeTrainingStatus', () => {
  test('reads a consistent runner as trained, with high confidence', () => {
    const { activities, profile } = consistentRunner();
    const status = analyzeTrainingStatus(activities, { now: NOW, profile });

    assert.ok(['well_trained', 'building_well'].includes(status.state), `got ${status.state}`);
    assert.equal(status.confidence, 'high');
    assert.ok(status.metrics.fitness! > 0);
    assert.ok(status.observations.length >= 3);
    assert.equal(status.caveats.length, 0, `unexpected caveats: ${status.caveats.join(' | ')}`);
  });

  test('flags a volume spike as overreaching and says why', () => {
    const { activities, profile } = spikingRunner();
    const status = analyzeTrainingStatus(activities, { now: NOW, profile });

    assert.equal(status.state, 'overreaching');
    assert.ok(status.metrics.acuteChronicRatio! >= 1.5);
    assert.match(status.narrative, /acute-to-chronic/);
    assert.ok(status.recommendations.length > 0);
  });

  test('recognises a runner coming back from a long gap', () => {
    const { activities, profile } = returningRunner();
    const status = analyzeTrainingStatus(activities, { now: NOW, profile });
    assert.ok(['returning', 'detraining'].includes(status.state), `got ${status.state}`);
    assert.ok(status.metrics.longestGapDays >= 21);
  });

  test('calls sporadic training what it is', () => {
    const { activities } = sporadicRunner();
    const status = analyzeTrainingStatus(activities, { now: NOW });
    assert.ok(
      ['undertrained', 'returning', 'insufficient_data', 'detraining'].includes(status.state),
      `got ${status.state}`,
    );
    assert.notEqual(status.state, 'well_trained');
  });

  test('carries data-quality caveats forward instead of flattening them away', () => {
    const { activities } = noHeartRateRunner();
    const status = analyzeTrainingStatus(activities, { now: NOW });

    assert.ok(status.caveats.length > 0);
    assert.ok(
      status.caveats.some((c) => c.includes('heart-rate')),
      `expected an HR caveat, got: ${status.caveats.join(' | ')}`,
    );
    assert.equal(status.zones, null);
  });

  test('degrades rather than throwing on an empty history', () => {
    const status = analyzeTrainingStatus(emptyRunner().activities, { now: NOW });
    assert.equal(status.state, 'insufficient_data');
    assert.equal(status.confidence, 'none');
    assert.equal(status.load, null);
    assert.ok(status.recommendations.length > 0);
  });

  test('handles a one-activity athlete without inventing a trend', () => {
    const status = analyzeTrainingStatus(oneActivityRunner().activities, { now: NOW });
    assert.notEqual(status.state, 'well_trained');
    assert.equal(status.confidence, 'low');
    assert.ok(status.caveats.length > 0);
  });

  test('every state produces a headline, a narrative and advice', () => {
    const cases = [consistentRunner(), spikingRunner(), returningRunner(), sporadicRunner(), oneActivityRunner()];
    for (const { activities, profile } of cases) {
      const status = analyzeTrainingStatus(activities, { now: NOW, profile });
      assert.ok(status.headline.length > 10, 'headline must be substantive');
      assert.ok(status.narrative.length > 60, 'narrative must be substantive');
      assert.ok(status.recommendations.length > 0, 'every state must carry actionable advice');
      assert.ok(status.observations.length > 0);
    }
  });
});
