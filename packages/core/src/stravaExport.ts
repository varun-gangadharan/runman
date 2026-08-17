/**
 * Strava bulk-export parsing.
 *
 * Strava's API now sits behind a paid subscription, but "Download or Delete Your
 * Account" still hands every athlete a free zip of their complete history. The
 * `activities.csv` inside it carries every field this package needs — date,
 * type, distance, moving and elapsed time, elevation, average and max heart
 * rate — so it is a complete substitute for the API as an ingestion path, and
 * one that cannot be priced or rate-limited away.
 *
 * The file is messier than an API payload in three specific ways, each handled
 * below: duplicate column names, inconsistent distance units between those
 * duplicates, and a human-readable date format that varies by locale.
 */

import type { Activity, ActivityType } from './types.ts';

const TYPE_MAP: Record<string, ActivityType> = {
  Run: 'Run',
  'Trail Run': 'TrailRun',
  TrailRun: 'TrailRun',
  'Virtual Run': 'VirtualRun',
  VirtualRun: 'VirtualRun',
  Ride: 'Ride',
  'Virtual Ride': 'Ride',
  VirtualRide: 'Ride',
  Swim: 'Swim',
  Walk: 'Walk',
  Hike: 'Hike',
};

/**
 * Minimal RFC 4180 reader.
 *
 * Worth the forty lines rather than a split(','): activity names routinely
 * contain commas ("Morning run, felt awful"), quotes, and — because Strava
 * preserves the description field — literal newlines inside a quoted cell.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  // Strip a UTF-8 BOM, which Excel adds and which would otherwise become part
  // of the first header name and break every lookup against it.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"'; // An escaped quote inside a quoted field.
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      // Consume CRLF as one break.
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/**
 * Every column index for a given header name.
 *
 * Strava's export repeats several headers — `Distance`, `Elapsed Time` and
 * `Max Heart Rate` each appear twice, once in the summary block and once in the
 * detailed metrics block — so a name-to-index map would silently discard one of
 * them, and which one it kept would depend on iteration order.
 */
function indexHeaders(header: readonly string[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  header.forEach((name, index) => {
    const key = name.trim().toLowerCase();
    const existing = map.get(key);
    if (existing) existing.push(index);
    else map.set(key, [index]);
  });
  return map;
}

function numberAt(row: readonly string[], index: number | undefined): number | null {
  if (index === undefined) return null;
  const raw = (row[index] ?? '').trim();
  if (raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Strava writes dates like `Aug 17, 2026, 7:15:07 PM` in English exports and as
 * ISO-8601 in newer ones, with other locales producing other shapes again.
 * Everything Strava emits here is UTC, so a bare local-looking string must be
 * read as UTC rather than as the importer's timezone — otherwise every activity
 * shifts by the offset and the calendar-week buckets shift with it.
 */
export function parseExportDate(raw: string): string | null {
  const value = raw.trim();
  if (value === '') return null;

  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(value)) {
    const iso = new Date(value.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);
    return Number.isNaN(iso.getTime()) ? null : iso.toISOString();
  }

  // `Mon D, YYYY, h:mm:ss AM` — parse in UTC explicitly.
  const match = /^([A-Za-z]{3,})\s+(\d{1,2}),\s*(\d{4}),\s*(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?$/i.exec(value);
  if (match) {
    const [, monthName, day, year, hour, minute, second, meridiem] = match;
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const month = months.indexOf(monthName!.slice(0, 3).toLowerCase());
    if (month >= 0) {
      let hours = Number(hour);
      if (meridiem?.toUpperCase() === 'PM' && hours !== 12) hours += 12;
      if (meridiem?.toUpperCase() === 'AM' && hours === 12) hours = 0;
      const date = new Date(Date.UTC(Number(year), month, Number(day), hours, Number(minute), Number(second)));
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
  }

  const fallback = new Date(value);
  return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString();
}

export type SkipReason =
  | 'unparseable_date'
  | 'no_duration'
  | 'no_distance'
  | 'unsupported_type'
  | 'missing_id';

export interface ImportReport {
  activities: Activity[];
  /** Rows read, excluding the header. */
  rowsRead: number;
  skipped: Array<{ row: number; name: string; reason: SkipReason }>;
  /** Which unit the distance column turned out to be in. */
  distanceUnit: 'meters' | 'kilometers';
  warnings: string[];
}

/**
 * Decide whether a distance column holds metres or kilometres.
 *
 * The duplicated `Distance` columns are not in the same unit — the summary one
 * is kilometres (or miles) as displayed, the metrics one is metres — and Strava
 * does not label either. Guessing per row would be unstable, so the decision is
 * made once for the whole file from the largest value present: no runner covers
 * 1000 km in a single activity, and almost none cover under 1000 m, so the
 * magnitude separates the two cleanly.
 */
function inferDistanceUnit(values: readonly number[]): 'meters' | 'kilometers' {
  const max = values.reduce((largest, value) => Math.max(largest, value), 0);
  return max > 1000 ? 'meters' : 'kilometers';
}

export interface ImportOptions {
  /** Keep non-running activities. Defaults to false. */
  includeNonRuns?: boolean;
  /** Prefix for generated ids, to keep imports distinguishable from API syncs. */
  idPrefix?: string;
}

/**
 * Parse an `activities.csv` from a Strava bulk export into domain activities.
 *
 * Rows that cannot yield a trustworthy activity are skipped and reported rather
 * than filled in with defaults — an activity with an unreadable duration would
 * otherwise land in the training-load series as a zero and quietly drag the
 * athlete's fitness down.
 */
export function parseStravaExport(csv: string, options: ImportOptions = {}): ImportReport {
  const rows = parseCsv(csv);
  const warnings: string[] = [];

  if (rows.length < 2) {
    return { activities: [], rowsRead: 0, skipped: [], distanceUnit: 'meters', warnings: ['The file has no data rows.'] };
  }

  const header = rows[0]!;
  const columns = indexHeaders(header);
  const first = (...names: string[]): number | undefined => {
    for (const name of names) {
      const found = columns.get(name.toLowerCase());
      if (found && found.length > 0) return found[0];
    }
    return undefined;
  };
  const last = (...names: string[]): number | undefined => {
    for (const name of names) {
      const found = columns.get(name.toLowerCase());
      if (found && found.length > 0) return found[found.length - 1];
    }
    return undefined;
  };

  const idColumn = first('activity id');
  const dateColumn = first('activity date');
  const nameColumn = first('activity name');
  const typeColumn = first('activity type');
  const movingColumn = first('moving time');
  // The later duplicate is the metrics-block value, which is the one in metres
  // and seconds rather than the display-formatted summary.
  const distanceColumn = last('distance');
  const elapsedColumn = first('elapsed time');
  const elevationColumn = first('elevation gain');
  const avgHrColumn = first('average heart rate');
  const maxHrColumn = first('max heart rate');

  if (dateColumn === undefined) warnings.push('No "Activity Date" column found; every row will be skipped.');
  if (movingColumn === undefined) warnings.push('No "Moving Time" column found; falling back to elapsed time.');
  if (avgHrColumn === undefined) {
    warnings.push(
      'No "Average Heart Rate" column found, so training load will be scored from pace rather than heart rate.',
    );
  }

  const dataRows = rows.slice(1);

  // Unit inference needs the whole column, so it happens before the row loop.
  const rawDistances = dataRows
    .map((row) => numberAt(row, distanceColumn))
    .filter((value): value is number => value !== null && value > 0);
  const distanceUnit = inferDistanceUnit(rawDistances);
  const distanceScale = distanceUnit === 'meters' ? 1 : 1000;

  const activities: Activity[] = [];
  const skipped: ImportReport['skipped'] = [];
  const prefix = options.idPrefix ?? 'export';
  const seen = new Set<string>();

  dataRows.forEach((row, offset) => {
    const rowNumber = offset + 2; // 1-based, and the header occupies row 1.
    const name = (nameColumn === undefined ? '' : row[nameColumn] ?? '').trim() || 'Untitled activity';

    const rawType = (typeColumn === undefined ? 'Run' : row[typeColumn] ?? 'Run').trim();
    const type = TYPE_MAP[rawType] ?? 'Other';
    const isRun = type === 'Run' || type === 'TrailRun' || type === 'VirtualRun';
    if (!isRun && !options.includeNonRuns) {
      skipped.push({ row: rowNumber, name, reason: 'unsupported_type' });
      return;
    }

    const startDate = dateColumn === undefined ? null : parseExportDate(row[dateColumn] ?? '');
    if (!startDate) {
      skipped.push({ row: rowNumber, name, reason: 'unparseable_date' });
      return;
    }

    const elapsed = numberAt(row, elapsedColumn) ?? 0;
    const moving = numberAt(row, movingColumn) ?? elapsed;
    if (!moving || moving <= 0) {
      skipped.push({ row: rowNumber, name, reason: 'no_duration' });
      return;
    }

    const rawDistance = numberAt(row, distanceColumn);
    if (rawDistance === null || rawDistance <= 0) {
      skipped.push({ row: rowNumber, name, reason: 'no_distance' });
      return;
    }
    const distanceMeters = rawDistance * distanceScale;

    const rawId = idColumn === undefined ? '' : (row[idColumn] ?? '').trim();
    // Fall back to a deterministic id so re-importing the same file updates the
    // same rows instead of duplicating the athlete's entire history.
    const id = `${prefix}-${rawId || `${startDate}-${Math.round(distanceMeters)}`}`;
    if (seen.has(id)) return; // Strava occasionally repeats a row across exports.
    seen.add(id);

    const averageHeartrate = numberAt(row, avgHrColumn);
    const maxHeartrate = numberAt(row, maxHrColumn);

    activities.push({
      id,
      name,
      type,
      startDate,
      distanceMeters,
      movingTimeSeconds: moving,
      elapsedTimeSeconds: elapsed > 0 ? elapsed : moving,
      totalElevationGainMeters: numberAt(row, elevationColumn) ?? 0,
      averageHeartrate: averageHeartrate && averageHeartrate > 0 ? averageHeartrate : null,
      maxHeartrate: maxHeartrate && maxHeartrate > 0 ? maxHeartrate : null,
      averageSpeedMps: distanceMeters / moving,
      // The bulk export has no workout-type column, so races cannot be
      // identified the way the API identifies them. Commutes are at least
      // reliably *not* races.
      isRace: false,
    });
  });

  if (activities.length === 0 && dataRows.length > 0) {
    warnings.push('No activities could be read from this file. Check that it is the activities.csv from a Strava bulk export.');
  }

  return { activities, rowsRead: dataRows.length, skipped, distanceUnit, warnings };
}
