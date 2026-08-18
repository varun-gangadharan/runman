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
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Grid,
  Paper,
  Typography,
} from '@mui/material';
import { Navigate } from 'react-router-dom';
import ImportExport from '../components/ImportExport';
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
      <Box sx={{ maxWidth: 760, mx: 'auto', mt: 4 }}>
        <Typography variant="h5" gutterBottom>
          Let&apos;s get your training history in
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          Everything Runman shows is computed from your stored activities, so there is nothing to
          display yet. There are two ways in, and they produce identical results — pick whichever
          matches your Strava account.
        </Typography>

        {error && (
          <Alert
            severity={error.code === 'application_inactive' ? 'warning' : 'error'}
            sx={{ mb: 3 }}
          >
            {error.message}
          </Alert>
        )}

        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Import an export
                </Typography>
                <Chip size="small" label="Works on any account" color="success" sx={{ mb: 1.5 }} />
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Strava lets every athlete download their full history for free, no subscription
                  needed. Request the archive, then upload the <code>activities.csv</code> from it.
                </Typography>
                <ImportExport compact />
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Sync over the API
                </Typography>
                <Chip size="small" label="Needs a Strava subscription" sx={{ mb: 1.5 }} />
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Pulls straight from Strava and stays up to date incrementally afterwards. Strava
                  restricts API access to subscribers, so this returns an error on a free account.
                </Typography>
                <Button
                  variant="outlined"
                  // Retrying an inactive Strava application produces the same 403
                  // every time, so stop offering an action that cannot succeed.
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
                  {syncing ? 'Syncing from Strava…' : 'Try syncing from Strava'}
                </Button>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </Box>
    );
  }

  return null;
}
