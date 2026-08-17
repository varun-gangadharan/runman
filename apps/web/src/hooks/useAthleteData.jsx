/**
 * One load of the athlete's data for the whole app.
 *
 * The previous version re-fetched the athlete's entire Strava history inside
 * every page's `useEffect`. Six pages meant six full history downloads per
 * session, each one burning the same Strava rate limit and each one computing
 * its own slightly different version of the same metrics. Activities are now
 * fetched once from our own database and shared through context; the pages
 * derive what they need from `@runman/core`.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';

const AthleteDataContext = createContext(null);

/** Days of history to load. Enough for a 42-day CTL to be fully warmed up. */
const HISTORY_DAYS = 400;

export function AthleteDataProvider({ children }) {
  const [state, setState] = useState({
    status: 'loading',
    athlete: null,
    sync: null,
    activities: [],
    error: null,
  });

  const load = useCallback(async () => {
    try {
      const me = await api.me();
      const { activities } = await api.activities({ days: HISTORY_DAYS });
      setState({ status: 'ready', athlete: me.athlete, sync: me.sync, activities, error: null });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setState({ status: 'unauthenticated', athlete: null, sync: null, activities: [], error: null });
        return;
      }
      setState({ status: 'error', athlete: null, sync: null, activities: [], error });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sync = useCallback(
    async (full = false) => {
      const result = await api.sync(full);
      await load();
      return result;
    },
    [load],
  );

  /**
   * The profile shape `@runman/core` wants. Age is derived from birth year so
   * the Tanaka fallback stays correct as time passes rather than freezing at
   * whatever age was entered.
   */
  const profile = useMemo(() => {
    if (!state.athlete) return {};
    return {
      id: state.athlete.id,
      sex: state.athlete.sex ?? 'unspecified',
      maxHeartRate: state.athlete.maxHeartRate ?? null,
      restingHeartRate: state.athlete.restingHeartRate ?? null,
      age: state.athlete.birthYear ? new Date().getUTCFullYear() - state.athlete.birthYear : null,
    };
  }, [state.athlete]);

  const value = useMemo(
    () => ({ ...state, profile, reload: load, sync }),
    [state, profile, load, sync],
  );

  return <AthleteDataContext.Provider value={value}>{children}</AthleteDataContext.Provider>;
}

export function useAthleteData() {
  const context = useContext(AthleteDataContext);
  if (!context) throw new Error('useAthleteData must be used inside an AthleteDataProvider');
  return context;
}
