import { Alert, AppBar, Box, Button, Chip, IconButton, Snackbar, Toolbar, Tooltip, Typography } from '@mui/material';
import { DirectionsRun, Sync } from '@mui/icons-material';
import { Link, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { api } from '../api/client';
import { useAthleteData } from '../hooks/useAthleteData';

const NAV_ITEMS = [
  { label: 'Dashboard', path: '/' },
  { label: 'Activities', path: '/activities' },
  { label: 'Analytics', path: '/analytics' },
  { label: 'Records', path: '/records' },
  { label: 'Plan', path: '/training' },
  { label: 'Profile', path: '/profile' },
];

export default function Navbar() {
  const { pathname } = useLocation();
  const { status, athlete, sync, activities, sync: runSync } = useAthleteData();
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(null);

  const handleSync = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      // A first sync has nothing stored, so it has to walk the whole history.
      await runSync(activities.length === 0);
    } catch (error) {
      // A sync that fails silently is worse than one that fails loudly: the
      // athlete concludes they have no data rather than that the pull broke.
      setSyncError(error.message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <AppBar position="static" color="transparent" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
      <Toolbar>
        <DirectionsRun sx={{ color: 'primary.main', mr: 1 }} />
        <Typography variant="h6" component={Link} to="/" sx={{ color: 'inherit', textDecoration: 'none', mr: 4 }}>
          Runman
        </Typography>

        {status === 'ready' && (
          <Box sx={{ display: 'flex', gap: 1, flexGrow: 1 }}>
            {NAV_ITEMS.map((item) => (
              <Button
                key={item.path}
                component={Link}
                to={item.path}
                size="small"
                color={pathname === item.path ? 'primary' : 'inherit'}
              >
                {item.label}
              </Button>
            ))}
          </Box>
        )}

        <Box sx={{ flexGrow: status === 'ready' ? 0 : 1 }} />

        {status === 'ready' && (
          <>
            <Chip
              size="small"
              variant="outlined"
              sx={{ mr: 1 }}
              label={`${activities.length} activities`}
            />
            <Tooltip
              title={
                sync?.lastSyncedAt
                  ? `Last synced ${new Date(sync.lastSyncedAt).toLocaleString()}`
                  : 'Never synced — pull your history from Strava'
              }
            >
              <span>
                <IconButton onClick={handleSync} disabled={syncing} size="small">
                  <Sync sx={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} />
                </IconButton>
              </span>
            </Tooltip>
            <Button
              size="small"
              color="inherit"
              onClick={async () => {
                await api.logout();
                window.location.href = '/login';
              }}
            >
              {athlete?.firstName ? `Sign out (${athlete.firstName})` : 'Sign out'}
            </Button>
          </>
        )}
      </Toolbar>

      <Snackbar
        open={Boolean(syncError)}
        onClose={() => setSyncError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        // Long enough to actually read a paragraph explaining what went wrong.
        autoHideDuration={15000}
      >
        <Alert severity="warning" onClose={() => setSyncError(null)} sx={{ maxWidth: 560 }}>
          {syncError}
        </Alert>
      </Snackbar>
    </AppBar>
  );
}
