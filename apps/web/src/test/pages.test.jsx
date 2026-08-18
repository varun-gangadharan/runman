/**
 * Every page must render its own content.
 *
 * The regression these guard against blanked the entire app: the data gate was
 * used as `const gate = <Gate />; if (gate) return gate;`, and a JSX element is
 * always truthy, so every page returned the gate — which renders null when the
 * data is fine. The navbar kept working, so the app looked alive and reported
 * "378 activities" while showing nothing at all.
 *
 * The assertions are deliberately about *content being present*, not about
 * markup details. A test tied to exact copy would break on every wording change
 * and teach people to ignore it.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import { renderPage, stubApi, buildActivities } from './renderPage.jsx';
import Dashboard from '../pages/Dashboard';
import Analytics from '../pages/Analytics';
import Records from '../pages/Records';
import Activities from '../pages/Activities';
import TrainingPlan from '../pages/TrainingPlan';
import Profile from '../pages/Profile';

beforeEach(() => {
  stubApi();
  // Recharts measures its container, which jsdom reports as zero, so charts
  // would otherwise refuse to render children.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  // Vitest with `globals: false` does not wire up Testing Library's automatic
  // cleanup, so without this every query searches the previous test's DOM too
  // and "found multiple elements" masquerades as a real duplicate-render bug.
  cleanup();
  vi.restoreAllMocks();
});

describe('pages render their content when data is present', () => {
  test('Dashboard shows the training status, not a blank page', async () => {
    renderPage(<Dashboard />);
    expect(await screen.findByText('Training status')).toBeInTheDocument();
    expect(screen.getByText(/Fitness \(CTL\)/)).toBeInTheDocument();
    expect(screen.getByText(/What to do about it/)).toBeInTheDocument();
  });

  test('Analytics shows its charts section', async () => {
    renderPage(<Analytics />);
    expect(await screen.findByText('Analytics')).toBeInTheDocument();
    expect(screen.getByText('Fitness, fatigue and form')).toBeInTheDocument();
    // Appears as both a heading and a chart legend.
    expect(screen.getAllByText('Weekly volume').length).toBeGreaterThan(0);
  });

  test('Records shows best efforts', async () => {
    renderPage(<Records />);
    expect(await screen.findByText('Best efforts')).toBeInTheDocument();
    expect(screen.getByText('Fastest run at each distance')).toBeInTheDocument();
  });

  test('Activities lists the athlete runs', async () => {
    renderPage(<Activities />);
    expect(await screen.findByText('Activities')).toBeInTheDocument();
    expect(screen.getAllByText(/Easy run|Long run/).length).toBeGreaterThan(0);
  });

  test('TrainingPlan shows the prediction controls', async () => {
    renderPage(<TrainingPlan />);
    expect(await screen.findByText(/Race prediction/)).toBeInTheDocument();
    expect(screen.getByLabelText('Race date')).toBeInTheDocument();
  });

  test('Profile shows physiology, the importer and API keys', async () => {
    renderPage(<Profile />);
    expect(await screen.findByText('Physiology')).toBeInTheDocument();
    // The importer is the only ingestion path when Strava's API is unavailable,
    // so it must be reachable.
    expect(screen.getByText('Import from a Strava export')).toBeInTheDocument();
    expect(screen.getByText('API keys')).toBeInTheDocument();
  });
});

describe('the gate still gates when it should', () => {
  test('an athlete with no activities gets the empty state, not a crash', async () => {
    stubApi({ activities: [] });
    renderPage(<Dashboard />);
    expect(await screen.findByText(/Let.s get your training history in/)).toBeInTheDocument();

    // Both ingestion paths must be offered, and which one works on a free
    // account must be obvious without reading documentation.
    expect(screen.getByText('Import an export')).toBeInTheDocument();
    expect(screen.getByText('Sync over the API')).toBeInTheDocument();
    expect(screen.getByText('Works on any account')).toBeInTheDocument();
    expect(screen.getByText('Needs a Strava subscription')).toBeInTheDocument();

    // The importer has to be usable right there, not one navigation away.
    expect(screen.getByText('Choose activities.csv')).toBeInTheDocument();
  });

  test('Profile stays reachable with no activities, because it holds the importer', async () => {
    stubApi({ activities: [] });
    renderPage(<Profile />);
    expect(await screen.findByText('Import from a Strava export')).toBeInTheDocument();
    expect(screen.queryByText(/Let.s get your training history in/)).toBeNull();
  });

  test('a signed-out visitor is redirected rather than shown an empty page', async () => {
    stubApi({ unauthenticated: true });
    renderPage(<Dashboard />);
    // The redirect renders nothing here; the point is that it does not sit on a
    // blank authenticated page pretending the athlete has no data.
    await waitFor(() => expect(screen.queryByText('Training status')).toBeNull());
  });
});

describe('data volume does not change whether content renders', () => {
  test('a single activity still renders the dashboard', async () => {
    stubApi({ activities: buildActivities(1) });
    renderPage(<Dashboard />);
    expect(await screen.findByText('Training status')).toBeInTheDocument();
  });

  test('a large history still renders the dashboard', async () => {
    stubApi({ activities: buildActivities(378) });
    renderPage(<Dashboard />);
    expect(await screen.findByText('Training status')).toBeInTheDocument();
  });
});
