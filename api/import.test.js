/**
 * Tests for import validation.
 *
 * The import endpoint accepts activities parsed in the browser, so its input is
 * client-supplied. It is the athlete's own data scoped to their own session, so
 * the realistic threat is malformed input rather than a hostile peer — but a
 * NaN distance or a 1970 date corrupts every calculation downstream just as
 * effectively as an attack would, and silently.
 */

import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { validateActivity } from './import.js';

const valid = {
  id: 'export-123',
  name: 'Morning Run',
  type: 'Run',
  startDate: '2026-08-17T07:00:00.000Z',
  distanceMeters: 10000,
  movingTimeSeconds: 3600,
  elapsedTimeSeconds: 3700,
  totalElevationGainMeters: 42,
  averageHeartrate: 150,
  maxHeartrate: 178,
};

describe('validateActivity', () => {
  test('accepts a well-formed activity and normalizes it', () => {
    const result = validateActivity(valid);
    assert.equal(result.ok, true);
    assert.equal(result.activity.distanceMeters, 10000);
    assert.equal(result.activity.averageSpeedMps, 10000 / 3600);
    assert.equal(result.activity.isRace, false);
  });

  test('rejects non-finite and out-of-range numbers', () => {
    for (const bad of [{ distanceMeters: 'abc' }, { distanceMeters: -5 }, { distanceMeters: 5_000_000 }]) {
      assert.equal(validateActivity({ ...valid, ...bad }).ok, false, JSON.stringify(bad));
    }
    for (const bad of [{ movingTimeSeconds: 0 }, { movingTimeSeconds: 999_999 }, { movingTimeSeconds: null }]) {
      assert.equal(validateActivity({ ...valid, ...bad }).ok, false, JSON.stringify(bad));
    }
  });

  test('rejects an unparseable or future date', () => {
    assert.equal(validateActivity({ ...valid, startDate: 'nope' }).ok, false);
    const nextYear = new Date(Date.now() + 400 * 86400000).toISOString();
    assert.equal(validateActivity({ ...valid, startDate: nextYear }).ok, false);
  });

  test('rejects a missing or oversized id', () => {
    assert.equal(validateActivity({ ...valid, id: '' }).ok, false);
    assert.equal(validateActivity({ ...valid, id: 'x'.repeat(200) }).ok, false);
  });

  test('drops implausible heart rates rather than storing them', () => {
    // The DB has CHECK constraints for these; failing here gives a clear message
    // instead of a Postgres constraint violation surfacing in the UI.
    assert.equal(validateActivity({ ...valid, averageHeartrate: 15 }).activity.averageHeartrate, null);
    assert.equal(validateActivity({ ...valid, averageHeartrate: 400 }).activity.averageHeartrate, null);
    assert.equal(validateActivity({ ...valid, maxHeartrate: 'high' }).activity.maxHeartrate, null);
  });

  test('falls back to a safe type and name instead of rejecting', () => {
    const result = validateActivity({ ...valid, type: 'Quidditch', name: '   ' });
    assert.equal(result.ok, true);
    assert.equal(result.activity.type, 'Other');
    assert.equal(result.activity.name, 'Untitled activity');
  });

  test('truncates an overlong name rather than failing the row', () => {
    const result = validateActivity({ ...valid, name: 'a'.repeat(1000) });
    assert.equal(result.ok, true);
    assert.equal(result.activity.name.length, 300);
  });

  test('rejects junk input without throwing', () => {
    for (const junk of [null, undefined, 'string', 42, []]) {
      assert.equal(validateActivity(junk).ok, false);
    }
  });
});
