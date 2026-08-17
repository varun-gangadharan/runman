import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { parseCsv, parseExportDate, parseStravaExport } from '../src/stravaExport.ts';

/** A cut-down `activities.csv` with the real header shape, duplicates included. */
const HEADER =
  'Activity ID,Activity Date,Activity Name,Activity Type,Elapsed Time,Distance,Max Heart Rate,' +
  'Moving Time,Distance,Max Heart Rate,Average Heart Rate,Elevation Gain';

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join('\n');
}

describe('parseCsv', () => {
  test('handles quoted commas, escaped quotes and embedded newlines', () => {
    const rows = parseCsv('a,b,c\n"one, two","he said ""hi""","line1\nline2"');
    assert.deepEqual(rows[0], ['a', 'b', 'c']);
    assert.deepEqual(rows[1], ['one, two', 'he said "hi"', 'line1\nline2']);
  });

  test('handles CRLF line endings and a UTF-8 BOM', () => {
    const rows = parseCsv('﻿a,b\r\n1,2\r\n');
    assert.deepEqual(rows[0], ['a', 'b']); // BOM must not contaminate the first header
    assert.deepEqual(rows[1], ['1', '2']);
  });
});

describe('parseExportDate', () => {
  test('reads the human-readable format as UTC', () => {
    // The critical part is UTC: parsing this as local time shifts every
    // activity by the importer's offset, and with it every weekly bucket.
    assert.equal(parseExportDate('Aug 17, 2026, 7:15:07 PM'), '2026-08-17T19:15:07.000Z');
    assert.equal(parseExportDate('Jan 3, 2025, 6:05:00 AM'), '2025-01-03T06:05:00.000Z');
  });

  test('handles noon and midnight correctly', () => {
    assert.equal(parseExportDate('Jun 1, 2026, 12:00:00 AM'), '2026-06-01T00:00:00.000Z');
    assert.equal(parseExportDate('Jun 1, 2026, 12:00:00 PM'), '2026-06-01T12:00:00.000Z');
  });

  test('reads ISO dates, with or without an explicit zone', () => {
    assert.equal(parseExportDate('2026-08-17T19:15:07Z'), '2026-08-17T19:15:07.000Z');
    assert.equal(parseExportDate('2026-08-17 19:15:07'), '2026-08-17T19:15:07.000Z');
  });

  test('returns null rather than an Invalid Date', () => {
    assert.equal(parseExportDate(''), null);
    assert.equal(parseExportDate('not a date'), null);
  });
});

describe('parseStravaExport', () => {
  test('reads a normal run', () => {
    const report = parseStravaExport(
      csv('12345,"Aug 17, 2026, 7:15:07 PM",Morning Run,Run,3700,10.0,178,3600,10000,178,150,42'),
    );

    assert.equal(report.activities.length, 1);
    const activity = report.activities[0]!;
    assert.equal(activity.name, 'Morning Run');
    assert.equal(activity.type, 'Run');
    assert.equal(activity.startDate, '2026-08-17T19:15:07.000Z');
    assert.equal(activity.distanceMeters, 10000);
    assert.equal(activity.movingTimeSeconds, 3600);
    assert.equal(activity.elapsedTimeSeconds, 3700);
    assert.equal(activity.averageHeartrate, 150);
    assert.equal(activity.maxHeartrate, 178);
    assert.equal(activity.totalElevationGainMeters, 42);
  });

  test('takes the metres column, not the kilometres one, when Distance is duplicated', () => {
    // The header has `Distance` twice: 10.0 (km, summary) and 10000 (m, metrics).
    // Picking the first would report every run as 10 metres.
    const report = parseStravaExport(
      csv('1,"Aug 17, 2026, 7:15:07 PM",Run,Run,3600,10.0,,3600,10000,,,0'),
    );
    assert.equal(report.distanceUnit, 'meters');
    assert.equal(report.activities[0]!.distanceMeters, 10000);
  });

  test('infers kilometres when only a kilometre column exists', () => {
    const kmOnly = 'Activity ID,Activity Date,Activity Name,Activity Type,Moving Time,Distance\n' +
      '1,"Aug 17, 2026, 7:15:07 PM",Run,Run,3600,10.5\n' +
      '2,"Aug 15, 2026, 7:15:07 PM",Run,Run,1800,5.2';
    const report = parseStravaExport(kmOnly);
    assert.equal(report.distanceUnit, 'kilometers');
    assert.equal(report.activities[0]!.distanceMeters, 10500);
    assert.equal(report.activities[1]!.distanceMeters, 5200);
  });

  test('handles activity names containing commas and quotes', () => {
    const report = parseStravaExport(
      csv('1,"Aug 17, 2026, 7:15:07 PM","Long run, felt ""great""",Run,3600,10.0,,3600,10000,,,0'),
    );
    assert.equal(report.activities[0]!.name, 'Long run, felt "great"');
  });

  test('skips rows it cannot trust, and says why', () => {
    const report = parseStravaExport(
      csv(
        '1,"Aug 17, 2026, 7:15:07 PM",Good,Run,3600,10.0,,3600,10000,,,0',
        '2,not a date,Bad date,Run,3600,10.0,,3600,10000,,,0',
        '3,"Aug 16, 2026, 7:15:07 PM",No duration,Run,0,10.0,,0,10000,,,0',
        '4,"Aug 15, 2026, 7:15:07 PM",No distance,Run,3600,0,,3600,0,,,0',
      ),
    );

    assert.equal(report.activities.length, 1);
    assert.equal(report.rowsRead, 4);
    // A skipped row must never become a zero-load activity that quietly drags
    // the athlete's computed fitness down.
    assert.deepEqual(
      report.skipped.map((s) => s.reason).sort(),
      ['no_distance', 'no_duration', 'unparseable_date'],
    );
    assert.ok(report.skipped.every((s) => s.row >= 2), 'row numbers must account for the header');
  });

  test('excludes non-runs by default and includes them on request', () => {
    const rows = [
      '1,"Aug 17, 2026, 7:15:07 PM",Run,Run,3600,10.0,,3600,10000,,,0',
      '2,"Aug 16, 2026, 7:15:07 PM",Bike,Ride,3600,30.0,,3600,30000,,,0',
    ];
    assert.equal(parseStravaExport(csv(...rows)).activities.length, 1);
    assert.equal(parseStravaExport(csv(...rows), { includeNonRuns: true }).activities.length, 2);
  });

  test('maps trail and virtual runs onto their own types', () => {
    const report = parseStravaExport(
      csv(
        '1,"Aug 17, 2026, 7:15:07 PM",T,"Trail Run",3600,10.0,,3600,10000,,,0',
        '2,"Aug 16, 2026, 7:15:07 PM",V,"Virtual Run",3600,10.0,,3600,10000,,,0',
      ),
    );
    assert.deepEqual(report.activities.map((a) => a.type).sort(), ['TrailRun', 'VirtualRun']);
  });

  test('generates stable ids so re-importing updates rather than duplicates', () => {
    const file = csv('98765,"Aug 17, 2026, 7:15:07 PM",Run,Run,3600,10.0,,3600,10000,,,0');
    const first = parseStravaExport(file);
    const second = parseStravaExport(file);
    assert.equal(first.activities[0]!.id, second.activities[0]!.id);
    assert.match(first.activities[0]!.id, /^export-98765$/);
  });

  test('deduplicates repeated rows within one file', () => {
    const row = '55,"Aug 17, 2026, 7:15:07 PM",Run,Run,3600,10.0,,3600,10000,,,0';
    const report = parseStravaExport(csv(row, row));
    assert.equal(report.activities.length, 1);
  });

  test('reports missing heart-rate data as a warning rather than fabricating it', () => {
    const noHr = 'Activity ID,Activity Date,Activity Name,Activity Type,Moving Time,Distance\n' +
      '1,"Aug 17, 2026, 7:15:07 PM",Run,Run,3600,10000';
    const report = parseStravaExport(noHr);
    assert.equal(report.activities[0]!.averageHeartrate, null);
    assert.ok(report.warnings.some((w) => w.includes('Average Heart Rate')));
  });

  test('degrades on a file that is not a Strava export', () => {
    const report = parseStravaExport('name,value\nfoo,1');
    assert.equal(report.activities.length, 0);
    assert.ok(report.warnings.length > 0);
  });

  test('handles an empty file without throwing', () => {
    const report = parseStravaExport('');
    assert.equal(report.activities.length, 0);
    assert.equal(report.rowsRead, 0);
  });

  test('parsed activities flow into the rest of the core', async () => {
    // The real integration risk: a shape that parses but that the science code
    // cannot consume. Four weeks of running, then a volume calculation over it.
    const rows: string[] = [];
    for (let day = 1; day <= 28; day += 2) {
      const date = `Aug ${String(day).padStart(2, '0')}, 2026, 7:00:00 AM`;
      rows.push(`${day},"${date}",Run,Run,3700,10.0,,3600,10000,,145,20`);
    }
    const report = parseStravaExport(csv(...rows));
    assert.equal(report.activities.length, 14);

    const { rollingVolume } = await import('../src/volume.ts');
    const volume = rollingVolume(report.activities, {
      endDate: new Date('2026-08-28T12:00:00Z'),
      windowDays: 28,
    });
    assert.equal(volume.activityCount, 14);
    assert.equal(volume.distanceMeters, 140000);
  });
});
