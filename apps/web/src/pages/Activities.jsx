/**
 * Activity list, with each run's computed load and quality flags attached.
 *
 * Showing the load *and* how it was scored per activity is what makes the
 * training-load number on the dashboard auditable — a runner who disagrees with
 * their fitness figure can trace it back to individual runs.
 */

import { useMemo, useState } from 'react';
import {
  Box,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tooltip,
  Typography,
  Paper,
} from '@mui/material';
import { assessActivity, buildLoadScorer, formatDuration, formatPace } from '@runman/core';
import { useAthleteData } from '../hooks/useAthleteData';
import { useSettings } from '../context/SettingsContext';
import LoadingOrEmpty from '../components/LoadingOrEmpty';

const METHOD_LABEL = {
  trimp_hr: 'heart rate',
  pace_calibrated: 'pace (calibrated)',
  pace_threshold: 'pace',
  duration_only: 'duration only',
};

export default function Activities() {
  const { status, activities, profile } = useAthleteData();
  const { convertDistance, getDistanceUnit } = useSettings();
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  const scored = useMemo(() => {
    if (activities.length === 0) return [];
    const scorer = buildLoadScorer(activities, profile);
    return [...activities]
      .sort((a, b) => new Date(b.startDate) - new Date(a.startDate))
      .map((activity) => ({
        activity,
        load: scorer.score(activity),
        quality: assessActivity(activity),
      }));
  }, [activities, profile]);

  const gate = <LoadingOrEmpty status={status} activityCount={activities.length} />;
  if (gate) return gate;

  const visible = scored.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Activities
      </Typography>

      <Paper>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Activity</TableCell>
                <TableCell align="right">Distance</TableCell>
                <TableCell align="right">Time</TableCell>
                <TableCell align="right">Pace</TableCell>
                <TableCell align="right">Avg HR</TableCell>
                <TableCell align="right">Load</TableCell>
                <TableCell>Scored by</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map(({ activity, load, quality }) => (
                <TableRow key={activity.id} hover>
                  <TableCell>{activity.startDate.slice(0, 10)}</TableCell>
                  <TableCell sx={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {activity.name}
                    {activity.isRace && <Chip size="small" label="race" color="primary" sx={{ ml: 1 }} />}
                    {!quality.usableAsReference && (
                      <Tooltip title={quality.flags.join(', ')}>
                        <Chip size="small" label="flagged" color="warning" variant="outlined" sx={{ ml: 1 }} />
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {convertDistance(activity.distanceMeters / 1000)} {getDistanceUnit()}
                  </TableCell>
                  <TableCell align="right">{formatDuration(activity.movingTimeSeconds)}</TableCell>
                  <TableCell align="right">
                    {activity.distanceMeters > 0
                      ? `${formatPace((activity.movingTimeSeconds / activity.distanceMeters) * 1000)}/km`
                      : '—'}
                  </TableCell>
                  <TableCell align="right">
                    {activity.averageHeartrate ? Math.round(activity.averageHeartrate) : '—'}
                  </TableCell>
                  <TableCell align="right">{Math.round(load.load)}</TableCell>
                  <TableCell>
                    <Tooltip title={load.explanation}>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={METHOD_LABEL[load.method]}
                        color={load.method === 'trimp_hr' ? 'success' : load.method === 'duration_only' ? 'warning' : 'info'}
                      />
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        <TablePagination
          component="div"
          count={scored.length}
          page={page}
          onPageChange={(_, next) => setPage(next)}
          rowsPerPage={rowsPerPage}
          rowsPerPageOptions={[25, 50, 100]}
          onRowsPerPageChange={(event) => {
            setRowsPerPage(Number(event.target.value));
            setPage(0);
          }}
        />
      </Paper>
    </Box>
  );
}
