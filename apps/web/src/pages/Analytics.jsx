/**
 * Analytics — load, volume and heart-rate distribution over time.
 *
 * The chart that matters here is the CTL/ATL one. The version this replaces
 * plotted "last 14 entries of a day-keyed map", which skipped rest days
 * entirely: a fortnight containing four runs rendered as four adjacent bars and
 * looked like a solid block of training. Load is now plotted against real
 * calendar days, so the gaps are visible.
 */

import { useMemo, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Grid,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { classifyActivity, computeLoadSeries, heartRateZones, weeklyVolume } from '@runman/core';
import { useAthleteData } from '../hooks/useAthleteData';
import { useSettings } from '../context/SettingsContext';
import { ConfidenceChip, Explanation } from '../components/Provenance';
import LoadingOrEmpty from '../components/LoadingOrEmpty';

const WINDOWS = [
  { label: '6 weeks', days: 42 },
  { label: '3 months', days: 90 },
  { label: '6 months', days: 182 },
];

export default function Analytics() {
  const { status, activities, profile } = useAthleteData();
  const { convertDistance, getDistanceUnit } = useSettings();
  const [windowDays, setWindowDays] = useState(90);

  const load = useMemo(
    () => (activities.length > 0 ? computeLoadSeries(activities, { days: windowDays, profile }) : null),
    [activities, profile, windowDays],
  );

  const weeks = useMemo(
    () => weeklyVolume(activities, { weeks: Math.round(windowDays / 7) }),
    [activities, windowDays],
  );

  const zones = useMemo(() => heartRateZones(activities, profile), [activities, profile]);

  const zoneDistribution = useMemo(() => {
    if (!zones) return [];
    const counts = new Map(zones.zones.map((zone) => [zone.name, 0]));
    for (const activity of activities) {
      const zone = classifyActivity(activity, zones);
      if (zone) counts.set(zone.name, (counts.get(zone.name) ?? 0) + 1);
    }
    return zones.zones.map((zone) => ({
      name: zone.name,
      range: `${zone.minBpm}–${zone.maxBpm} bpm`,
      activities: counts.get(zone.name) ?? 0,
    }));
  }, [activities, zones]);

  const gate = <LoadingOrEmpty status={status} activityCount={activities.length} />;
  if (gate) return gate;

  const weeklyChartData = weeks.map((week) => ({
    week: week.weekStart.slice(5),
    distance: Number(convertDistance(week.distanceMeters / 1000)),
    runs: week.activityCount,
  }));

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Typography variant="h4">Analytics</Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={windowDays}
          onChange={(_, value) => value && setWindowDays(value)}
        >
          {WINDOWS.map((option) => (
            <ToggleButton key={option.days} value={option.days}>
              {option.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>

      <Grid container spacing={3}>
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                <Typography variant="h6">Fitness, fatigue and form</Typography>
                {load && <ConfidenceChip confidence={load.confidence} explanation={load.explanation} />}
              </Box>

              {load ? (
                <>
                  <ResponsiveContainer width="100%" height={320}>
                    <AreaChart data={load.series}>
                      <defs>
                        <linearGradient id="ctlFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#4CAF50" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#4CAF50" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={30} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{ background: '#1E1E1E', border: '1px solid #333' }}
                        labelFormatter={(date) => new Date(date).toDateString()}
                      />
                      <Legend />
                      <Area
                        type="monotone"
                        dataKey="ctl"
                        name="Fitness (CTL)"
                        stroke="#4CAF50"
                        fill="url(#ctlFill)"
                        strokeWidth={2}
                      />
                      <Line type="monotone" dataKey="atl" name="Fatigue (ATL)" stroke="#FF5722" dot={false} strokeWidth={2} />
                      <Bar dataKey="load" name="Daily load" fill="#2196F3" opacity={0.4} />
                    </AreaChart>
                  </ResponsiveContainer>
                  <Explanation>{load.explanation}</Explanation>
                </>
              ) : (
                <Typography color="text.secondary">Not enough data to plot a load series.</Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={7}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Weekly volume
              </Typography>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={weeklyChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="week" tick={{ fontSize: 11 }} minTickGap={20} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: '#1E1E1E', border: '1px solid #333' }} />
                  <Bar dataKey="distance" name={`Distance (${getDistanceUnit()})`} fill="#FF5722" />
                </BarChart>
              </ResponsiveContainer>
              <Explanation>
                Weeks are real ISO calendar weeks. A week with no running appears as an empty bar
                rather than being skipped.
              </Explanation>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={5}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                <Typography variant="h6">Heart-rate zones</Typography>
                {zones && <ConfidenceChip confidence={zones.confidence} explanation={zones.explanation} />}
              </Box>

              {zones ? (
                <>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={zoneDistribution} layout="vertical" margin={{ left: 30 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={110} />
                      <Tooltip
                        contentStyle={{ background: '#1E1E1E', border: '1px solid #333' }}
                        formatter={(value, _name, entry) => [`${value} activities`, entry.payload.range]}
                      />
                      <Bar dataKey="activities" fill="#2196F3" />
                    </BarChart>
                  </ResponsiveContainer>
                  <Explanation>{zones.explanation}</Explanation>
                </>
              ) : (
                <Typography color="text.secondary">
                  No heart-rate data, and no max HR or birth year on your profile, so zones cannot be
                  derived. Adding either on the Profile page turns this on.
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
