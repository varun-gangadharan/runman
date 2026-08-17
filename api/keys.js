/**
 * Manage the API keys an athlete issues to RunCoach.
 *
 * GET    /api/keys        list keys (prefixes only — the secrets are unrecoverable)
 * POST   /api/keys        create a key; the plaintext appears in this response only
 * DELETE /api/keys?id=... revoke a key
 */

import { requireSession } from './_lib/session.js';
import { createKey, listKeys, revokeKey } from './_lib/apiKeys.js';

export default async function handler(req, res) {
  const session = requireSession(req, res);
  if (!session) return;

  try {
    if (req.method === 'GET') {
      return res.json({ keys: await listKeys(session.athleteId) });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
      const name = String(body.name ?? '').trim();
      if (!name) {
        return res.status(400).json({ error: 'invalid_request', message: 'A key name is required.' });
      }
      const created = await createKey(session.athleteId, name, body.expiresInDays ?? null);
      return res.status(201).json({
        ...created,
        warning: 'This is the only time the key is shown. Store it now — it cannot be recovered.',
      });
    }

    if (req.method === 'DELETE') {
      const id = String(req.query.id ?? '');
      if (!id) return res.status(400).json({ error: 'invalid_request', message: 'A key id is required.' });
      const revoked = await revokeKey(session.athleteId, id);
      return revoked
        ? res.json({ ok: true })
        : res.status(404).json({ error: 'not_found', message: 'No active key with that id.' });
    }

    res.status(405).json({ error: 'method_not_allowed' });
  } catch (error) {
    console.error('API key operation failed:', error);
    res.status(500).json({ error: 'server_error', message: error.message });
  }
}
