/**
 * Harness for rendering a page against stubbed API responses.
 *
 * These tests exist because of a specific failure: every page in the app
 * rendered blank in production while 96 unit tests passed. The gate that decides
 * whether a page shows a spinner, a redirect or its content was used as
 * `const gate = <Gate />; if (gate) return gate;` — and since a JSX element is
 * an object, that condition was always true, so no page ever rendered its own
 * content. No amount of testing the science core could have caught it. The
 * cheapest thing that would have is asserting that a page renders something.
 */

import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { vi } from 'vitest';
import { AthleteDataProvider } from '../hooks/useAthleteData';
import { SettingsProvider } from '../context/SettingsContext';

const theme = createTheme({ palette: { mode: 'dark' } });

export const ATHLETE = {
  id: '1',
  username: 'runner',
  firstName: 'Test',
  lastName: 'Runner',
  sex: 'male',
  maxHeartRate: 190,
  restingHeartRate: 48,
  birthYear: 1996,
};

/** A month of running, enough for load, volume and a prediction to be real. */
export function buildActivities(count = 30) {
  const activities = [];
  for (let i = 0; i < count; i++) {
    const start = new Date(Date.now() - i * 2 * 86400000);
    start.setUTCHours(7, 0, 0, 0);
    const km = i % 5 === 0 ? 16 : 10;
    const seconds = km * (i % 5 === 0 ? 330 : 345);
    activities.push({
      id: `a-${i}`,
      name: i % 5 === 0 ? 'Long run' : 'Easy run',
      type: 'Run',
      startDate: start.toISOString(),
      distanceMeters: km * 1000,
      movingTimeSeconds: seconds,
      elapsedTimeSeconds: seconds + 60,
      totalElevationGainMeters: 30,
      averageHeartrate: 148,
      maxHeartrate: 165,
      averageSpeedMps: (km * 1000) / seconds,
      isRace: false,
    });
  }
  return activities;
}

/**
 * Stub `fetch` for the endpoints the app calls on load.
 * @param {{ activities?: object[], athlete?: object|null, unauthenticated?: boolean }} options
 */
export function stubApi(options = {}) {
  const activities = options.activities ?? buildActivities();

  globalThis.fetch = vi.fn(async (url) => {
    const path = String(url);

    if (options.unauthenticated) {
      return new Response(JSON.stringify({ error: 'not_authenticated', message: 'Sign in.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path.includes('/api/auth/me')) {
      return jsonResponse({
        athlete: options.athlete ?? ATHLETE,
        sync: { lastSyncedAt: new Date().toISOString(), lastActivityDate: null, activityCount: activities.length },
      });
    }
    if (path.includes('/api/activities')) {
      return jsonResponse({ activities, count: activities.length });
    }
    if (path.includes('/api/keys')) {
      return jsonResponse({ keys: [] });
    }
    return jsonResponse({});
  });
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Render a page inside the providers it expects.
 *
 * Callers await the content they expect via `findBy*` rather than this helper
 * waiting on the absence of a spinner: "no spinner" is true both when loading
 * finished and when the page rendered nothing at all, which is precisely the
 * failure these tests exist to catch.
 */
export function renderPage(ui, { route = '/' } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ThemeProvider theme={theme}>
        <SettingsProvider>
          <AthleteDataProvider>{ui}</AthleteDataProvider>
        </SettingsProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}
