/**
 * Tests for Strava error interpretation.
 *
 * These exist because the raw payloads are genuinely confusing: Strava returns
 * a bare 403 for at least three unrelated conditions, only one of which the
 * athlete can act on. Getting the mapping wrong sends someone into a loop of
 * signing out and back in against a problem that reconnecting cannot fix.
 *
 * The `Application/Status/Inactive` case is a real one hit in production after
 * Strava moved API access behind a paid subscription.
 */

import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { interpretStravaError } from './strava.js';

describe('interpretStravaError', () => {
  test('recognises an inactive application and explains it is not the athlete fault', () => {
    const body = JSON.stringify({
      message: 'Forbidden',
      errors: [{ resource: 'Application', field: 'Status', code: 'Inactive' }],
    });
    const error = interpretStravaError(403, body, '/athlete/activities');

    assert.equal(error.code, 'application_inactive');
    assert.match(error.message, /application inactive/i);
    // The two things someone hitting this most needs to know.
    assert.match(error.message, /will not change anything|not change anything/i);
    assert.match(error.message, /strava\.com\/settings\/api/);
    // And reassurance that stored data survives.
    assert.match(error.message, /untouched/i);
  });

  test('maps a 401 to reauthorization rather than to the inactive-app message', () => {
    const error = interpretStravaError(401, JSON.stringify({ message: 'Unauthorized' }), '/athlete');
    assert.equal(error.code, 'reauthorize_required');
    assert.match(error.message, /connect Strava again/i);
  });

  test('recognises a missing activity scope', () => {
    const body = JSON.stringify({
      message: 'Forbidden',
      errors: [{ resource: 'Activity', field: 'access_token', code: 'invalid' }],
    });
    const error = interpretStravaError(403, body, '/athlete/activities');
    assert.equal(error.code, 'insufficient_scope');
    assert.match(error.message, /activity:read_all/);
  });

  test('falls back to a generic error, preserving the body, for anything unrecognised', () => {
    const error = interpretStravaError(500, 'upstream exploded', '/athlete');
    assert.equal(error.code, 'strava_error');
    assert.match(error.message, /upstream exploded/);
    assert.match(error.message, /500/);
  });

  test('does not throw on a non-JSON body', () => {
    const error = interpretStravaError(502, '<html>Bad Gateway</html>', '/athlete');
    assert.equal(error.code, 'strava_error');
    assert.match(error.message, /Bad Gateway/);
  });
});
