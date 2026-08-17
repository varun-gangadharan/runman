/**
 * Profile — physiology inputs and API keys.
 *
 * The two heart-rate fields here are what let the load model and zones stop
 * guessing. Both explain what changes when they are filled in, because "max
 * heart rate" is not self-evidently the thing standing between a runner and
 * accurate zones.
 */

import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { ContentCopy, Delete } from '@mui/icons-material';
import { deriveMaxHeartRate, heartRateZones } from '@runman/core';
import { api } from '../api/client';
import { useAthleteData } from '../hooks/useAthleteData';
import { useSettings } from '../context/SettingsContext';
import { useDataGate } from '../hooks/useDataGate';
import ImportExport from '../components/ImportExport';
import { Explanation } from '../components/Provenance';

export default function Profile() {
  const { status, athlete, activities, profile, reload } = useAthleteData();
  const { units, setUnits } = useSettings();

  const [form, setForm] = useState({ maxHeartRate: '', restingHeartRate: '', birthYear: '' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  const [keys, setKeys] = useState([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [issuedKey, setIssuedKey] = useState(null);

  useEffect(() => {
    if (athlete) {
      setForm({
        maxHeartRate: athlete.maxHeartRate ?? '',
        restingHeartRate: athlete.restingHeartRate ?? '',
        birthYear: athlete.birthYear ?? '',
      });
    }
  }, [athlete]);

  useEffect(() => {
    if (status === 'ready') api.keys.list().then((result) => setKeys(result.keys)).catch(() => {});
  }, [status]);

  const gate = useDataGate({ requireActivities: false });
  if (gate) return gate;

  const derivedMax = deriveMaxHeartRate(activities, profile);
  const zones = heartRateZones(activities, profile);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.updateProfile({
        maxHeartRate: form.maxHeartRate === '' ? null : Number(form.maxHeartRate),
        restingHeartRate: form.restingHeartRate === '' ? null : Number(form.restingHeartRate),
        birthYear: form.birthYear === '' ? null : Number(form.birthYear),
      });
      await reload();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateKey = async () => {
    try {
      const created = await api.keys.create(newKeyName.trim());
      setIssuedKey(created);
      setNewKeyName('');
      setKeys((await api.keys.list()).keys);
    } catch (keyError) {
      setError(keyError.message);
    }
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        {athlete?.firstName} {athlete?.lastName}
      </Typography>

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Physiology
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                These are the inputs that make training load and heart-rate zones yours rather than a
                population average. Nothing here is required — every calculation degrades to a clearly
                labelled estimate without them.
              </Typography>

              <Grid container spacing={2}>
                <Grid item xs={12} sm={4}>
                  <TextField
                    fullWidth
                    size="small"
                    type="number"
                    label="Max HR (bpm)"
                    value={form.maxHeartRate}
                    onChange={(event) => setForm({ ...form, maxHeartRate: event.target.value })}
                  />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <TextField
                    fullWidth
                    size="small"
                    type="number"
                    label="Resting HR (bpm)"
                    value={form.restingHeartRate}
                    onChange={(event) => setForm({ ...form, restingHeartRate: event.target.value })}
                  />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <TextField
                    fullWidth
                    size="small"
                    type="number"
                    label="Birth year"
                    value={form.birthYear}
                    onChange={(event) => setForm({ ...form, birthYear: event.target.value })}
                  />
                </Grid>
              </Grid>

              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mt: 2 }}>
                <Button variant="contained" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </Button>
                {saved && <Chip size="small" color="success" label="Saved" />}
              </Box>

              {derivedMax && (
                <Explanation>
                  Currently using {derivedMax.value} bpm as your max. {derivedMax.explanation}
                </Explanation>
              )}
              {!derivedMax && (
                <Explanation>
                  No max heart rate can be derived yet, so heart-rate zones are unavailable and training
                  load falls back to pace. Entering a max HR or a birth year turns both on.
                </Explanation>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Your heart-rate zones
              </Typography>
              {zones ? (
                <>
                  <TableContainer>
                    <Table size="small">
                      <TableBody>
                        {zones.zones.map((zone) => (
                          <TableRow key={zone.name}>
                            <TableCell>{zone.name}</TableCell>
                            <TableCell>
                              {zone.minBpm}–{zone.maxBpm} bpm
                            </TableCell>
                            <TableCell sx={{ color: 'text.secondary', fontSize: 12 }}>{zone.description}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  <Explanation>{zones.explanation}</Explanation>
                </>
              ) : (
                <Typography color="text.secondary" variant="body2">
                  Zones need a max heart rate. Wear a monitor on a hard effort, or enter a tested max
                  or your birth year above.
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <ImportExport />
        </Grid>

        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                API keys
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Keys grant read-only access to your training data through the RunCoach MCP server, so
                an assistant can answer questions about your training. Only a hash is stored — a key is
                shown once and cannot be recovered. Revoke one at any time.
              </Typography>

              {issuedKey && (
                <Alert severity="success" sx={{ mb: 2 }}>
                  <Typography variant="subtitle2">{issuedKey.warning}</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                    <Box component="code" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                      {issuedKey.key}
                    </Box>
                    <IconButton size="small" onClick={() => navigator.clipboard.writeText(issuedKey.key)}>
                      <ContentCopy fontSize="small" />
                    </IconButton>
                  </Box>
                </Alert>
              )}

              <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                <TextField
                  size="small"
                  label="Key name"
                  placeholder="Claude Desktop"
                  value={newKeyName}
                  onChange={(event) => setNewKeyName(event.target.value)}
                />
                <Button variant="outlined" disabled={!newKeyName.trim()} onClick={handleCreateKey}>
                  Create key
                </Button>
              </Box>

              {keys.length > 0 && (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Name</TableCell>
                        <TableCell>Key</TableCell>
                        <TableCell>Created</TableCell>
                        <TableCell>Last used</TableCell>
                        <TableCell />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {keys.map((key) => (
                        <TableRow key={key.id} sx={{ opacity: key.revoked_at ? 0.5 : 1 }}>
                          <TableCell>{key.name}</TableCell>
                          <TableCell sx={{ fontFamily: 'monospace' }}>{key.key_prefix}…</TableCell>
                          <TableCell>{key.created_at.slice(0, 10)}</TableCell>
                          <TableCell>{key.last_used_at ? key.last_used_at.slice(0, 10) : 'never'}</TableCell>
                          <TableCell align="right">
                            {key.revoked_at ? (
                              <Chip size="small" label="revoked" />
                            ) : (
                              <IconButton
                                size="small"
                                onClick={async () => {
                                  await api.keys.revoke(key.id);
                                  setKeys((await api.keys.list()).keys);
                                }}
                              >
                                <Delete fontSize="small" />
                              </IconButton>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Units
              </Typography>
              <Button
                variant="outlined"
                onClick={() => setUnits(units === 'metric' ? 'imperial' : 'metric')}
              >
                Currently {units} — switch to {units === 'metric' ? 'imperial' : 'metric'}
              </Button>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}
    </Box>
  );
}
