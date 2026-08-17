/**
 * API keys — the credential RunCoach (or any MCP client) presents to read an
 * athlete's data.
 *
 * Only a SHA-256 hash is stored. The plaintext key is shown once, at creation,
 * and is unrecoverable afterwards. That is the difference between a database
 * leak being an incident and being a breach.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { supabase } from './supabase.js';

const KEY_PREFIX = 'rc_live_';

/** @param {string} key */
export function hashKey(key) {
  return createHash('sha256').update(key).digest('hex');
}

/** Generate a new key. The plaintext is returned exactly once. */
export function generateKey() {
  const secret = randomBytes(32).toString('base64url');
  const key = `${KEY_PREFIX}${secret}`;
  return { key, hash: hashKey(key), prefix: key.slice(0, KEY_PREFIX.length + 6) };
}

/**
 * Resolve a presented key to an athlete, or null.
 *
 * The lookup is by hash, so the plaintext is never compared against stored
 * values directly, and an unknown key costs the same single indexed lookup as a
 * known one.
 * @param {string | undefined} presented
 */
export async function authenticateKey(presented) {
  if (!presented || !presented.startsWith(KEY_PREFIX)) return null;

  const hash = hashKey(presented);
  const { data, error } = await supabase()
    .from('api_keys')
    .select('id, athlete_id, scopes, key_hash, revoked_at, expires_at')
    .eq('key_hash', hash)
    .maybeSingle();

  if (error || !data) return null;
  if (data.revoked_at) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;

  // Belt and braces: confirm the stored hash matches in constant time, so a
  // future change to the lookup cannot reintroduce a comparison shortcut.
  const a = Buffer.from(data.key_hash);
  const b = Buffer.from(hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  // Fire-and-forget: a failed usage stamp must not fail the request.
  supabase()
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(undefined, (updateError) => console.error('Failed to stamp key usage:', updateError));

  return { athleteId: data.athlete_id, keyId: data.id, scopes: data.scopes ?? ['read'] };
}

/** @param {string} athleteId @param {string} name @param {number | null} expiresInDays */
export async function createKey(athleteId, name, expiresInDays = null) {
  const { key, hash, prefix } = generateKey();
  const { data, error } = await supabase()
    .from('api_keys')
    .insert({
      athlete_id: athleteId,
      name,
      key_hash: hash,
      key_prefix: prefix,
      expires_at: expiresInDays ? new Date(Date.now() + expiresInDays * 86400000).toISOString() : null,
    })
    .select('id, name, key_prefix, created_at, expires_at')
    .single();

  if (error) throw new Error(`Failed to create API key: ${error.message}`);
  return { ...data, key };
}

/** @param {string} athleteId */
export async function listKeys(athleteId) {
  const { data, error } = await supabase()
    .from('api_keys')
    .select('id, name, key_prefix, created_at, last_used_at, expires_at, revoked_at')
    .eq('athlete_id', athleteId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to list API keys: ${error.message}`);
  return data ?? [];
}

/** Revocation is scoped to the owning athlete so an id alone is not enough. */
export async function revokeKey(athleteId, keyId) {
  const { error, count } = await supabase()
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() }, { count: 'exact' })
    .eq('id', keyId)
    .eq('athlete_id', athleteId)
    .is('revoked_at', null);
  if (error) throw new Error(`Failed to revoke API key: ${error.message}`);
  return (count ?? 0) > 0;
}
