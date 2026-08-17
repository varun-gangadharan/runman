/**
 * The three states every data page shares: still loading, signed out, or signed
 * in with nothing imported yet.
 *
 * This is a hook returning an element *or null*, rather than a component,
 * because of the bug it replaces. The previous version was a component used as:
 *
 *   const gate = <LoadingOrEmpty status={status} activityCount={n} />;
 *   if (gate) return gate;
 *
 * A JSX element is an object, so `gate` was always truthy and every page
 * returned the gate unconditionally. The gate rendered `null` whenever the data
 * was fine, so the entire app rendered blank pages under a working navbar — the
 * failure looked like a data problem when it was pure control flow.
 *
 * Returning `null` for "no gate needed" makes `if (gate)` mean what it reads
 * like. The shape of the API is what prevents the mistake, rather than a comment
 * asking callers to remember.
 */

import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Link as MuiLink,
  Paper,
  Typography,
} from '@mui/material';
import { Link, Navigate } from 'react-router-dom';
import { useAthleteData } from './useAthleteData';

/**
 * @param {{ requireActivities?: boolean }} options
 *   `requireActivities: false` for pages that must stay reachable with an empty
 *   history — Profile in particular, since that is where the importer lives.
 * @returns {JSX.Element | null} An element to render instead of the page, or
 *   null when the page should render normally.
 */
export function useDataGate(options = {}) {
  const requireActivities = options.requireActivities ?? true;
  const { status, activities, sync } = useAthleteData();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);

  if (status === 'loading') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 12 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (status === 'unauthenticated') return <Navigate to="/login" replace />;

  if (status === 'error') {
    return (
      <Paper sx={{ p: 4, mt: 4 }}>
        <Typography variant="h6" gutterBottom>
          Could not load your data
        </Typography>
        <Typography color="text.secondary">
          The server returned an error. Reload the page, and if it persists check that the app&apos;s
          environment variables are set.
        </Typography>
      </Paper>
    );
  }

  if (requireActivities && activities.length === 0) {
    return (
      <Paper sx={{ p: 4, mt: 4, textAlign: 'center' }}>
        <Typography variant="h6" gutterBottom>
          Nothing imported yet
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          Your account is connected, but no activities have been loaded. Everything on this page is
          computed from stored history, so there is nothing to show until some arrives.
        </Typography>

        {error && (
          <Alert
            severity={error.code === 'application_inactive' ? 'warning' : 'error'}
            sx={{ mb: 2, textAlign: 'left' }}
          >
            {error.message}
          </Alert>
        )}

        <Button
          variant="contained"
          // Retrying an inactive Strava application produces the same 403 every
          // time, so the button stops offering an action that cannot succeed.
          disabled={syncing || error?.code === 'application_inactive'}
          onClick={async () => {
            setSyncing(true);
            setError(null);
            try {
              await sync(true);
            } catch (syncError) {
              setError({ message: syncError.message, code: syncError.code });
            } finally {
              setSyncing(false);
            }
          }}
        >
          {syncing ? 'Syncing from Strava…' : 'Sync my Strava history'}
        </Button>

        <Typography variant="body2" color="text.secondary" sx={{ mt: 3 }}>
          {error?.code === 'application_inactive'
            ? 'Since the API is unavailable, import your history instead — '
            : 'No Strava API access? Import a bulk export instead — '}
          <MuiLink component={Link} to="/profile">
            Profile → Import from a Strava export
          </MuiLink>
          . Strava lets every athlete download their full history for free.
        </Typography>
      </Paper>
    );
  }

  return null;
}
