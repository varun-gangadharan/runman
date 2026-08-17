/**
 * Sign in with Strava.
 *
 * This page used to perform the OAuth code exchange itself, which required the
 * client secret to be present in the browser bundle. It now does nothing but
 * send the browser to our own `/api/auth/login`, which redirects on to Strava.
 * The code, the secret, and the resulting tokens never meet anywhere the
 * browser can see.
 */

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Paper, Typography } from '@mui/material';
import { DirectionsRun } from '@mui/icons-material';
import { LOGIN_URL } from '../api/client';
import { useAthleteData } from '../hooks/useAthleteData';

const ERROR_MESSAGES = {
  invalid_state: 'That sign-in link was not one we issued, so it was rejected. Please try again.',
  missing_code: 'Strava did not send an authorization code back. Please try again.',
  exchange_failed: 'We could not complete the handshake with Strava. Please try again in a moment.',
  access_denied: 'You declined the Strava permission request, so there is nothing to show yet.',
};

export default function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { status } = useAthleteData();
  const [redirecting, setRedirecting] = useState(false);

  const errorCode = params.get('error');

  useEffect(() => {
    if (status === 'ready') navigate('/', { replace: true });
  }, [status, navigate]);

  if (status === 'loading') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 12 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
      <Paper sx={{ p: 5, maxWidth: 480, textAlign: 'center' }}>
        <DirectionsRun sx={{ fontSize: 56, color: 'primary.main', mb: 1 }} />
        <Typography variant="h4" gutterBottom>
          Runman
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          Training load, race predictions and plans built from your own Strava history — with every
          number showing which activities it came from.
        </Typography>

        {errorCode && (
          <Alert severity="error" sx={{ mb: 3, textAlign: 'left' }}>
            {ERROR_MESSAGES[errorCode] ?? `Sign-in failed (${errorCode}).`}
          </Alert>
        )}

        <Button
          variant="contained"
          size="large"
          fullWidth
          disabled={redirecting}
          onClick={() => {
            setRedirecting(true);
            window.location.href = LOGIN_URL;
          }}
        >
          {redirecting ? 'Redirecting to Strava…' : 'Connect with Strava'}
        </Button>

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 3 }}>
          Runman requests read access to your activities. Your Strava tokens are stored server-side
          and are never sent to your browser.
        </Typography>
      </Paper>
    </Box>
  );
}
