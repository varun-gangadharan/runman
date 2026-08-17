/**
 * Import from a Strava bulk export.
 *
 * Strava now gates API access behind a paid subscription, but every athlete can
 * still download their complete history for free. This is the ingestion path
 * that does not depend on Strava's pricing.
 *
 * Parsing happens here, in the browser, with the same `@runman/core` parser the
 * server would use — which keeps the upload to the fields that matter rather
 * than shipping a file that also contains descriptions, gear and private notes.
 */

import { useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  LinearProgress,
  Link,
  Typography,
} from '@mui/material';
import { UploadFile } from '@mui/icons-material';
import { parseStravaExport } from '@runman/core';
import { api } from '../api/client';
import { useAthleteData } from '../hooks/useAthleteData';

/** Matches the server's per-request cap. */
const BATCH_SIZE = 500;

const SKIP_LABELS = {
  unparseable_date: 'unreadable date',
  no_duration: 'no recorded duration',
  no_distance: 'no recorded distance',
  unsupported_type: 'not a run',
  missing_id: 'no activity id',
};

export default function ImportExport() {
  const { reload } = useAthleteData();
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleFile = async (file) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setProgress(0);

    try {
      const text = await file.text();
      const report = parseStravaExport(text);

      if (report.activities.length === 0) {
        setError(
          report.warnings[0] ??
            'No activities could be read from that file. It should be the activities.csv from a Strava bulk export.',
        );
        return;
      }

      let saved = 0;
      let rejected = 0;
      for (let i = 0; i < report.activities.length; i += BATCH_SIZE) {
        const batch = report.activities.slice(i, i + BATCH_SIZE);
        const isFinal = i + BATCH_SIZE >= report.activities.length;
        const response = await api.importActivities(batch, isFinal);
        saved += response.saved;
        rejected += response.rejected.length;
        setProgress(Math.round(((i + batch.length) / report.activities.length) * 100));
      }

      setResult({ saved, rejected, report });
      await reload();
    } catch (importError) {
      setError(importError.message);
    } finally {
      setBusy(false);
    }
  };

  const skipCounts = result
    ? result.report.skipped.reduce((counts, entry) => {
        counts[entry.reason] = (counts[entry.reason] ?? 0) + 1;
        return counts;
      }, {})
    : {};

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Import from a Strava export
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Strava restricts API access to subscribers, but your full history is still free to
          download. Go to{' '}
          <Link href="https://www.strava.com/athlete/delete_your_account" target="_blank" rel="noreferrer">
            Settings → My Account → Download or Delete Your Account
          </Link>
          , request an archive, and upload the <code>activities.csv</code> from the zip Strava emails
          you. Re-importing the same file updates existing activities rather than duplicating them.
        </Typography>

        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: 'none' }}
          onChange={(event) => handleFile(event.target.files?.[0])}
        />

        <Button
          variant="contained"
          startIcon={<UploadFile />}
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? 'Importing…' : 'Choose activities.csv'}
        </Button>

        {busy && <LinearProgress variant="determinate" value={progress} sx={{ mt: 2 }} />}

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}

        {result && (
          <Alert severity="success" sx={{ mt: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Imported {result.saved} activities from {result.report.rowsRead} rows.
            </Typography>
            {Object.keys(skipCounts).length > 0 && (
              <Typography variant="body2" component="div">
                Skipped:{' '}
                {Object.entries(skipCounts)
                  .map(([reason, count]) => `${count} ${SKIP_LABELS[reason] ?? reason}`)
                  .join(', ')}
                .
              </Typography>
            )}
            {result.rejected > 0 && (
              <Typography variant="body2">
                {result.rejected} rejected by validation on the server.
              </Typography>
            )}
            {result.report.warnings.map((warning) => (
              <Typography key={warning} variant="body2" sx={{ mt: 0.5 }}>
                {warning}
              </Typography>
            ))}
          </Alert>
        )}

        <Box sx={{ mt: 2 }}>
          <Typography variant="caption" color="text.secondary">
            The file is parsed in your browser; only the fields Runman computes with are uploaded.
            Descriptions, gear and private notes stay on your machine.
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
}
