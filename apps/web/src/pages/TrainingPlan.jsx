/**
 * Race prediction and plan generation.
 *
 * Both come straight from `@runman/core`. Two things this page does that the
 * previous one did not: it shows which activities a prediction was derived from,
 * and it shows the plan's warnings rather than quietly clamping inputs.
 */

import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import {
  PlanGenerationError,
  STANDARD_DISTANCES,
  formatDuration,
  generateTrainingPlan,
  predictRaceTime,
} from '@runman/core';
import { useAthleteData } from '../hooks/useAthleteData';
import { useSettings } from '../context/SettingsContext';
import { ConfidenceChip, Explanation } from '../components/Provenance';
import LoadingOrEmpty from '../components/LoadingOrEmpty';

const RACE_DISTANCES = STANDARD_DISTANCES.filter((distance) => distance.meters >= 3000);

const GOALS = [
  { value: 'finish', label: 'Finish comfortably' },
  { value: 'pr', label: 'Set a personal record' },
  { value: 'compete', label: 'Race for position' },
];

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const WORKOUT_COLOR = {
  easy: 'success',
  recovery: 'default',
  long: 'info',
  tempo: 'warning',
  intervals: 'error',
  race: 'primary',
  rest: 'default',
};

export default function TrainingPlan() {
  const { status, activities, profile } = useAthleteData();
  const { convertDistance, getDistanceUnit } = useSettings();

  const [targetMeters, setTargetMeters] = useState(21097.5);
  const [goal, setGoal] = useState('finish');
  const [daysPerWeek, setDaysPerWeek] = useState(4);
  const [raceDate, setRaceDate] = useState('');
  const [plan, setPlan] = useState(null);
  const [planError, setPlanError] = useState(null);
  const [expandedWeek, setExpandedWeek] = useState(null);

  const prediction = useMemo(
    () => (activities.length > 0 ? predictRaceTime(activities, targetMeters, { goal }) : null),
    [activities, targetMeters, goal],
  );

  const gate = <LoadingOrEmpty status={status} activityCount={activities.length} />;
  if (gate) return gate;

  const handleGenerate = () => {
    setPlanError(null);
    setPlan(null);
    try {
      setPlan(
        generateTrainingPlan(activities, {
          targetDistanceMeters: targetMeters,
          raceDate: new Date(`${raceDate}T00:00:00Z`),
          daysPerWeek,
          goal,
          profile,
        }),
      );
    } catch (error) {
      setPlanError(
        error instanceof PlanGenerationError ? error.message : `Could not generate a plan: ${error.message}`,
      );
    }
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Race prediction &amp; plan
      </Typography>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={3}>
              <FormControl fullWidth size="small">
                <InputLabel>Distance</InputLabel>
                <Select label="Distance" value={targetMeters} onChange={(event) => setTargetMeters(event.target.value)}>
                  {RACE_DISTANCES.map((distance) => (
                    <MenuItem key={distance.meters} value={distance.meters}>
                      {distance.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={3}>
              <FormControl fullWidth size="small">
                <InputLabel>Goal</InputLabel>
                <Select label="Goal" value={goal} onChange={(event) => setGoal(event.target.value)}>
                  {GOALS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={3}>
              <TextField
                fullWidth
                size="small"
                type="date"
                label="Race date"
                InputLabelProps={{ shrink: true }}
                value={raceDate}
                onChange={(event) => setRaceDate(event.target.value)}
              />
            </Grid>
            <Grid item xs={6} sm={2}>
              <TextField
                fullWidth
                size="small"
                type="number"
                label="Runs / week"
                inputProps={{ min: 3, max: 7 }}
                value={daysPerWeek}
                onChange={(event) => setDaysPerWeek(Number(event.target.value))}
              />
            </Grid>
            <Grid item xs={6} sm={1}>
              <Button fullWidth variant="contained" disabled={!raceDate} onClick={handleGenerate}>
                Plan
              </Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {prediction ? (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, flexWrap: 'wrap', mb: 1 }}>
              <Typography variant="h6">{prediction.targetLabel} prediction</Typography>
              <Typography variant="h3" color="primary.main">
                {prediction.formattedTime}
              </Typography>
              <Typography color="text.secondary">
                {prediction.range.formattedOptimistic} – {prediction.range.formattedConservative}
              </Typography>
              <ConfidenceChip confidence={prediction.confidence} explanation={prediction.explanation} />
            </Box>

            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {prediction.formattedPace} · {prediction.method === 'personal_power_law' ? 'personal curve fit' : 'Riegel from closest effort'}
            </Typography>

            <Alert severity="info" sx={{ mb: 2 }}>
              {prediction.pacingAdvice}
            </Alert>

            <Typography variant="subtitle2" gutterBottom>
              Derived from
            </Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Activity</TableCell>
                    <TableCell>Date</TableCell>
                    <TableCell>Distance</TableCell>
                    <TableCell>Time</TableCell>
                    <TableCell>Pace</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {prediction.basedOn.map((reference) => (
                    <TableRow key={reference.activityId}>
                      <TableCell>{reference.activityName}</TableCell>
                      <TableCell>{reference.date.slice(0, 10)}</TableCell>
                      <TableCell>
                        {convertDistance(reference.distanceMeters / 1000)} {getDistanceUnit()}
                      </TableCell>
                      <TableCell>{reference.formattedTime}</TableCell>
                      <TableCell>{reference.formattedPace}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            <Explanation>{prediction.explanation}</Explanation>

            {prediction.excluded.length > 0 && (
              <Explanation>
                {prediction.excluded.length} activit{prediction.excluded.length === 1 ? 'y was' : 'ies were'}{' '}
                excluded from consideration: {prediction.excluded[0].activityName} —{' '}
                {prediction.excluded[0].reasons[0]}
                {prediction.excluded.length > 1 ? `, and ${prediction.excluded.length - 1} more.` : '.'}
              </Explanation>
            )}
          </CardContent>
        </Card>
      ) : (
        <Alert severity="info" sx={{ mb: 3 }}>
          No screened effort in the last six months can support a prediction yet. A single clean run of
          5 km or longer is enough to start.
        </Alert>
      )}

      {planError && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          {planError}
        </Alert>
      )}

      {plan && (
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              {plan.weeks.length}-week plan to {plan.targetLabel} on {plan.raceDate}
            </Typography>

            <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
              <Chip size="small" label={`start ${(plan.startingWeeklyMeters / 1000).toFixed(1)} km/wk`} />
              <Chip size="small" color="primary" label={`peak ${(plan.peakWeeklyMeters / 1000).toFixed(0)} km/wk`} />
              <Chip size="small" variant="outlined" label={`total ${(plan.totalDistanceMeters / 1000).toFixed(0)} km`} />
              <Chip size="small" variant="outlined" label={`easy ${plan.paces.easy.formatted}`} />
              <Chip size="small" variant="outlined" label={`tempo ${plan.paces.tempo.formatted}`} />
            </Box>

            {plan.warnings.map((warning) => (
              <Alert key={warning} severity="warning" sx={{ mb: 1 }}>
                {warning}
              </Alert>
            ))}

            <TableContainer sx={{ mt: 2 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Week</TableCell>
                    <TableCell>Phase</TableCell>
                    <TableCell>Volume</TableCell>
                    <TableCell>Long run</TableCell>
                    <TableCell>Sessions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {plan.weeks.map((week) => (
                    <>
                      <TableRow
                        key={week.weekNumber}
                        hover
                        sx={{ cursor: 'pointer' }}
                        onClick={() => setExpandedWeek(expandedWeek === week.weekNumber ? null : week.weekNumber)}
                      >
                        <TableCell>{week.weekNumber}</TableCell>
                        <TableCell>
                          <Chip size="small" label={week.phase} color={week.isRecoveryWeek ? 'default' : 'primary'} variant="outlined" />
                        </TableCell>
                        <TableCell>
                          {convertDistance(week.targetDistanceMeters / 1000)} {getDistanceUnit()}
                        </TableCell>
                        <TableCell>
                          {convertDistance(week.longRunMeters / 1000)} {getDistanceUnit()}
                        </TableCell>
                        <TableCell>
                          {week.workouts
                            .filter((workout) => workout.type !== 'rest')
                            .map((workout) => (
                              <Chip
                                key={workout.date}
                                size="small"
                                label={DAY_NAMES[workout.dayOfWeek]}
                                color={WORKOUT_COLOR[workout.type]}
                                sx={{ mr: 0.5 }}
                              />
                            ))}
                        </TableCell>
                      </TableRow>
                      {expandedWeek === week.weekNumber && (
                        <TableRow key={`${week.weekNumber}-detail`}>
                          <TableCell colSpan={5} sx={{ bgcolor: 'action.hover' }}>
                            <Typography variant="body2" sx={{ mb: 1 }}>
                              {week.note}
                            </Typography>
                            {week.workouts
                              .filter((workout) => workout.type !== 'rest')
                              .map((workout) => (
                                <Box key={workout.date} sx={{ mb: 1 }}>
                                  <Typography variant="subtitle2">
                                    {DAY_NAMES[workout.dayOfWeek]} · {workout.type} ·{' '}
                                    {convertDistance(workout.distanceMeters / 1000)} {getDistanceUnit()}
                                    {workout.targetPace ? ` · ${workout.targetPace.formatted}` : ''}
                                  </Typography>
                                  <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-line' }}>
                                    {workout.description}
                                  </Typography>
                                </Box>
                              ))}
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            <Explanation>{plan.explanation}</Explanation>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
