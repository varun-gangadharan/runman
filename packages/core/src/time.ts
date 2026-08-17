/**
 * Calendar helpers.
 *
 * Every windowed calculation in this package is defined over a real calendar
 * range, never over "the last N activities". Counting activities silently
 * rescales a window whenever training frequency changes — a runner who took two
 * weeks off looks *identical* to one who trained straight through, because both
 * have the same last-30-activity list. Rest days have to be in the denominator.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` in UTC. Used as the canonical key for a training day. */
export type DayKey = string;

export function toDayKey(date: Date | string): DayKey {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().slice(0, 10);
}

export function dayKeyToDate(key: DayKey): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Whole days from `from` to `to`, by UTC calendar day (not elapsed hours). */
export function daysBetween(from: Date | string, to: Date | string): number {
  const a = dayKeyToDate(toDayKey(from)).getTime();
  const b = dayKeyToDate(toDayKey(to)).getTime();
  return Math.round((b - a) / DAY_MS);
}

/**
 * Every day key in `[startInclusive, endInclusive]`. This is what makes rest
 * days visible to the load and volume calculations.
 */
export function dayKeyRange(startInclusive: Date, endInclusive: Date): DayKey[] {
  const keys: DayKey[] = [];
  let cursor = dayKeyToDate(toDayKey(startInclusive));
  const end = dayKeyToDate(toDayKey(endInclusive));
  while (cursor.getTime() <= end.getTime()) {
    keys.push(toDayKey(cursor));
    cursor = addDays(cursor, 1);
  }
  return keys;
}

/** Monday-start ISO week containing `date`, as a UTC midnight Date. */
export function startOfIsoWeek(date: Date | string): Date {
  const d = dayKeyToDate(toDayKey(date));
  // getUTCDay(): 0=Sunday. Shift so Monday=0.
  const offset = (d.getUTCDay() + 6) % 7;
  return addDays(d, -offset);
}

/** e.g. `2026-W33`. Sortable within a year; used to group weekly volume. */
export function isoWeekKey(date: Date | string): string {
  const monday = startOfIsoWeek(date);
  const thursday = addDays(monday, 3); // ISO weeks belong to the year of their Thursday
  const year = thursday.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const week = Math.floor(daysBetween(startOfIsoWeek(jan1), monday) / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** Seconds per kilometre as `m:ss`. */
export function formatPace(secondsPerKm: number): string {
  const total = Math.round(secondsPerKm);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
