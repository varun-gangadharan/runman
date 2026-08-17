/**
 * Dashboard — the composite training-status read.
 *
 * All of this comes from `analyzeTrainingStatus` in `@runman/core`, the same
 * function RunCoach's `analyze_training_status` MCP tool calls. Asking Claude
 * "how's my training going" and loading this page produce the same answer from
 * the same code, which is the point of having a shared core at all.
 */

import { useMemo } from 'react';
import { Alert, Box, Button, Card, CardContent, Grid, Typography } from '@mui/material';
import { analyzeTrainingStatus } from '@runman/core';
import { useAthleteData } from '../hooks/useAthleteData';
import { Caveats, ConfidenceChip } from '../components/Provenance';
import StatCard from '../components/StatCard';
import { useDataGate } from '../hooks/useDataGate';

const STATE_SEVERITY = {
  overreaching: 'warning',
  detraining: 'warning',
  undertrained: 'info',
  returning: 'info',
  insufficient_data: 'info',
  building_well: 'success',
  well_trained: 'success',
};

export default function Dashboard() {
  const { status, activities, profile, sync } = useAthleteData();

  const training = useMemo(
    () => (activities.length > 0 ? analyzeTrainingStatus(activities, { profile }) : null),
    [activities, profile],
  );

  const gate = useDataGate();
  if (gate) return gate;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
        <Typography variant="h4">Training status</Typography>
        <ConfidenceChip confidence={training.confidence} />
      </Box>

      <Alert severity={STATE_SEVERITY[training.state] ?? 'info'} sx={{ mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          {training.headline}
        </Typography>
        <Typography variant="body2">{training.narrative}</Typography>
      </Alert>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} md={3}>
          <StatCard
            title="Fitness (CTL)"
            value={training.metrics.fitness ?? '—'}
            subtitle="42-day load average"
          />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatCard
            title="Fatigue (ATL)"
            value={training.metrics.fatigue ?? '—'}
            subtitle="7-day load average"
          />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatCard
            title="Form (TSB)"
            value={
              training.metrics.form === null
                ? '—'
                : `${training.metrics.form > 0 ? '+' : ''}${training.metrics.form}`
            }
            subtitle="Fitness minus fatigue"
          />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatCard
            title="Weekly volume"
            value={training.metrics.weeklyDistanceKm}
            unit="km"
            subtitle="Last 28 calendar days"
          />
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                What the data shows
              </Typography>
              <Box component="ul" sx={{ pl: 2, m: 0 }}>
                {training.observations.map((observation) => (
                  <Typography key={observation} component="li" variant="body2" sx={{ mb: 1 }}>
                    {observation}
                  </Typography>
                ))}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                What to do about it
              </Typography>
              <Box component="ul" sx={{ pl: 2, m: 0 }}>
                {training.recommendations.map((recommendation) => (
                  <Typography key={recommendation} component="li" variant="body2" sx={{ mb: 1 }}>
                    {recommendation}
                  </Typography>
                ))}
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Caveats items={training.caveats} />

      {sync?.lastSyncedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 3 }}>
          Computed from {activities.length} stored activities, last synced{' '}
          {new Date(sync.lastSyncedAt).toLocaleString()}.
        </Typography>
      )}
    </Box>
  );
}
