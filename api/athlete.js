/**
 * Update the athlete's physiology fields.
 *
 * Bounds are enforced here as well as by the database CHECK constraints — a
 * clear 400 beats a Postgres constraint-violation string reaching the UI.
 */

import { requireSession } from './_lib/session.js';
import { supabase } from './_lib/supabase.js';

const FIELDS = {
  maxHeartRate: { column: 'max_heart_rate', min: 120, max: 230, label: 'Max heart rate' },
  restingHeartRate: { column: 'resting_heart_rate', min: 25, max: 120, label: 'Resting heart rate' },
  birthYear: { column: 'birth_year', min: 1900, max: new Date().getUTCFullYear(), label: 'Birth year' },
};

export default async function handler(req, res) {
  const session = requireSession(req, res);
  if (!session) return;

  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'method_not_allowed', message: 'Use PATCH.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
    const patch = {};

    for (const [key, spec] of Object.entries(FIELDS)) {
      if (!(key in body)) continue;
      const value = body[key];

      if (value === null || value === '') {
        patch[spec.column] = null;
        continue;
      }
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric < spec.min || numeric > spec.max) {
        return res.status(400).json({
          error: 'invalid_request',
          message: `${spec.label} must be between ${spec.min} and ${spec.max}.`,
        });
      }
      patch[spec.column] = Math.round(numeric);
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'invalid_request', message: 'Nothing to update.' });
    }

    // Resting HR above max HR would make every heart-rate-reserve calculation
    // negative, so reject the combination rather than storing it.
    if (patch.resting_heart_rate != null && patch.max_heart_rate != null
        && patch.resting_heart_rate >= patch.max_heart_rate) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'Resting heart rate must be below max heart rate.',
      });
    }

    const { error } = await supabase().from('athletes').update(patch).eq('id', session.athleteId);
    if (error) throw new Error(error.message);

    res.json({ ok: true, updated: Object.keys(patch) });
  } catch (error) {
    console.error('Profile update failed:', error);
    res.status(500).json({ error: 'server_error', message: error.message });
  }
}
