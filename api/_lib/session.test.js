/**
 * Session and cookie tests.
 *
 * The cookie attributes are tested because they were written twice — once for
 * the session cookie and once for the OAuth state cookie — and the copy guarding
 * CSRF quietly shipped without `Secure`. Anything security-relevant that exists
 * in two places will eventually disagree.
 */

import { strict as assert } from 'node:assert';
import { createHmac } from 'node:crypto';
import { describe, test } from 'node:test';

process.env.SESSION_SECRET ??= 'test-secret-for-signing-only';

const { cookieAttributes, sessionCookie, clearSessionCookie, serializeSession, verifySession } =
  await import('./session.js');

describe('cookie attributes', () => {
  test('sets Secure on an https deployment', () => {
    const previous = process.env.APP_URL;
    process.env.APP_URL = 'https://runman-pied.vercel.app';
    const attributes = cookieAttributes({ maxAgeSeconds: 600 });
    assert.match(attributes, /Secure/);
    assert.match(attributes, /HttpOnly/);
    assert.match(attributes, /SameSite=Lax/);
    process.env.APP_URL = previous;
  });

  test('omits Secure on plain-http local development, which would break it', () => {
    const previous = process.env.APP_URL;
    process.env.APP_URL = 'http://localhost:3000';
    assert.ok(!/Secure/.test(cookieAttributes({ maxAgeSeconds: 600 })));
    process.env.APP_URL = previous;
  });

  test('the session cookie carries every protective attribute', () => {
    const previous = process.env.APP_URL;
    process.env.APP_URL = 'https://runman-pied.vercel.app';
    const cookie = sessionCookie({ athleteId: '123' });
    for (const attribute of ['HttpOnly', 'SameSite=Lax', 'Secure', 'Path=/']) {
      assert.match(cookie, new RegExp(attribute.replace('/', '\\/')), `missing ${attribute}`);
    }
    process.env.APP_URL = previous;
  });

  test('clearing expires the cookie immediately', () => {
    assert.match(clearSessionCookie(), /Max-Age=0/);
  });
});

describe('session signing', () => {
  test('round-trips an athlete id', () => {
    const value = serializeSession({ athleteId: '128746829' });
    assert.equal(verifySession(value).athleteId, '128746829');
  });

  test('rejects a tampered payload', () => {
    const value = serializeSession({ athleteId: '1' });
    const [payload, signature] = value.split('.');
    const forged = Buffer.from(JSON.stringify({ athleteId: '999', issuedAt: Date.now() })).toString('base64url');
    // Someone swapping in another athlete's id must not be able to reuse the signature.
    assert.equal(verifySession(`${forged}.${signature}`), null);
    assert.equal(verifySession(`${payload}.${signature.slice(0, -2)}xx`), null);
  });

  test('rejects malformed and empty values without throwing', () => {
    for (const value of [undefined, '', 'nodot', 'a.b', '....']) {
      assert.equal(verifySession(value), null);
    }
  });

  test('rejects a session older than its maximum age', () => {
    const stale = Buffer.from(
      JSON.stringify({ athleteId: '1', issuedAt: Date.now() - 400 * 86400000 }),
    ).toString('base64url');
    // Signed correctly, but expired — must still be refused.
    const signature = createHmac('sha256', process.env.SESSION_SECRET).update(stale).digest('base64url');
    assert.equal(verifySession(`${stale}.${signature}`), null);
  });
});
