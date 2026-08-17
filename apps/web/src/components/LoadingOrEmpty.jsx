/**
 * The three states every data page shares: still loading, signed out, or signed
 * in with nothing synced yet. Returns null when the page should render normally.
 */

import { Alert, Box, Button, CircularProgress, Link as MuiLink, Paper, Typography } from '@mui/material';
import { Link, Navigate } from 'react-router-dom';
import { useState } from 'react';
import { useAthleteData } from '../hooks/useAthleteData';

export default function LoadingOrEmpty({ status, activityCount }) {
  const { sync } = useAthleteData();
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

  if (activityCount === 0) {
    return (
      <Paper sx={{ p: 4, mt: 4, textAlign: 'center' }}>
        <Typography variant="h6" gutterBottom>
          Nothing synced yet
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          Your Strava account is connected, but no activities have been pulled in. Everything on this
          page is computed from stored history, so there is nothing to show until that first sync
          finishes.
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
          // Retrying an inactive application just produces the same 403, so the
          // button stops offering an action that cannot succeed.
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
