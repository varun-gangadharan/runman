/**
 * Records — best efforts and the athlete's fitted distance/time curve.
 *
 * The fitted exponent shown here is the same one race predictions use. Showing
 * it is worthwhile in its own right: an exponent below 1.06 means this runner
 * holds pace better than average as distance grows, which is a genuine training
 * insight and not something a table of PRs conveys.
 */

import { useMemo } from 'react';
import {
  Box,
  Card,
  CardContent,
  Chip,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import {
  CartesianGrid,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  DEFAULT_RIEGEL_EXPONENT,
  findBestEfforts,
  fitPowerLaw,
  formatDuration,
  formatPace,
  predictFromFit,
  screenActivities,
} from '@runman/core';
import { useAthleteData } from '../hooks/useAthleteData';
import { Explanation } from '../components/Provenance';
import { useDataGate } from '../hooks/useDataGate';

export default function Records() {
  const { status, activities } = useAthleteData();

  const efforts = useMemo(() => findBestEfforts(activities), [activities]);
  const fit = useMemo(() => fitPowerLaw(efforts), [efforts]);
  const screening = useMemo(() => screenActivities(activities), [activities]);

  const gate = useDataGate();
  if (gate) return gate;

  const usedIds = new Set((fit?.efforts ?? []).map((effort) => effort.activityId));

  const curve = fit
    ? Array.from({ length: 40 }, (_, index) => {
        const meters = 1000 * Math.pow(50, index / 39); // 1 km → 50 km, log spaced
        return { distanceKm: meters / 1000, fitted: predictFromFit(fit, meters) / 60 };
      })
    : [];

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Best efforts
      </Typography>

      <Grid container spacing={3}>
        <Grid item xs={12} md={7}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Fastest run at each distance
              </Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Distance</TableCell>
                      <TableCell>Time</TableCell>
                      <TableCell>Pace</TableCell>
                      <TableCell>Date</TableCell>
                      <TableCell>Activity</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {efforts.map((effort) => (
                      <TableRow key={effort.activityId}>
                        <TableCell>
                          {effort.label}
                          {effort.isRace && <Chip size="small" label="race" sx={{ ml: 1 }} color="primary" />}
                          {usedIds.has(effort.activityId) && (
                            <Chip size="small" variant="outlined" label="in fit" sx={{ ml: 1 }} />
                          )}
                        </TableCell>
                        <TableCell>{formatDuration(effort.timeSeconds)}</TableCell>
                        <TableCell>{formatPace(effort.paceSecondsPerKm)}/km</TableCell>
                        <TableCell>{effort.date.slice(0, 10)}</TableCell>
                        <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {effort.activityName}
                        </TableCell>
                      </TableRow>
                    ))}
                    {efforts.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5}>
                          <Typography color="text.secondary" variant="body2">
                            No activity long enough or clean enough to count as a reference effort yet.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              <Explanation>
                One representative effort per distance band, screened for plausibility. Rows marked
                &ldquo;in fit&rdquo; are the ones the performance curve was fitted to; the rest sit
                far enough above the curve to be training runs rather than efforts.
              </Explanation>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={5}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Your performance curve
              </Typography>

              {fit ? (
                <>
                  <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                    <Chip size="small" label={`exponent ${fit.exponent.toFixed(3)}`} color="primary" />
                    <Chip size="small" variant="outlined" label={`R² ${fit.rSquared.toFixed(3)}`} />
                    <Chip size="small" variant="outlined" label={`${fit.pointsUsed} efforts`} />
                  </Box>

                  <ResponsiveContainer width="100%" height={260}>
                    <ComposedChart data={curve}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                      <XAxis
                        dataKey="distanceKm"
                        type="number"
                        scale="log"
                        domain={[1, 50]}
                        tick={{ fontSize: 11 }}
                        tickFormatter={(value) => `${Math.round(value)}k`}
                      />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => `${Math.round(value)}m`} />
                      <Tooltip
                        contentStyle={{ background: '#1E1E1E', border: '1px solid #333' }}
                        formatter={(value) => formatDuration(value * 60)}
                        labelFormatter={(value) => `${Number(value).toFixed(1)} km`}
                      />
                      <Line type="monotone" dataKey="fitted" name="Fitted curve" stroke="#4CAF50" dot={false} strokeWidth={2} />
                      <Scatter
                        name="Your efforts"
                        data={fit.efforts.map((effort) => ({
                          distanceKm: effort.actualDistanceMeters / 1000,
                          fitted: effort.timeSeconds / 60,
                        }))}
                        fill="#FF5722"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>

                  <Explanation>
                    Fitted as T = a·D<sup>b</sup> across your screened efforts. Your b is{' '}
                    {fit.exponent.toFixed(3)} against a population average of {DEFAULT_RIEGEL_EXPONENT} —{' '}
                    {fit.exponent < DEFAULT_RIEGEL_EXPONENT
                      ? 'you hold pace better than average as distance grows, which favours longer races.'
                      : 'you fade faster than average as distance grows, which favours shorter races or more endurance work.'}
                  </Explanation>
                </>
              ) : (
                <Typography color="text.secondary" variant="body2">
                  A personal curve needs efforts at three or more distance scales. Race or time-trial
                  a couple of different distances and this fills in.
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        {screening.rejected.length > 0 && (
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Excluded from records ({screening.rejected.length})
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  These activities were screened out before any calculation ran. Nothing is deleted —
                  they just cannot serve as reference efforts.
                </Typography>
                <TableContainer sx={{ maxHeight: 260 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>Activity</TableCell>
                        <TableCell>Date</TableCell>
                        <TableCell>Why</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {screening.rejected.slice(0, 50).map(({ activity, flags }) => (
                        <TableRow key={activity.id}>
                          <TableCell>{activity.name}</TableCell>
                          <TableCell>{activity.startDate.slice(0, 10)}</TableCell>
                          <TableCell>{flags.join(', ')}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </Grid>
        )}
      </Grid>
    </Box>
  );
}
