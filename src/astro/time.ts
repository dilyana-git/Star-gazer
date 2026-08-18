/**
 * The only place timezones exist.
 *
 * State stores UTC epoch milliseconds (spec §4). Zone and DST are applied when
 * formatting for display and when parsing what the user typed, and nowhere
 * else. Everything here is built on `Intl`, so there is no timezone database to
 * ship or keep current.
 */
import type { Instant } from './types';

export interface LocalParts {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

/** Wall-clock fields at `instant` in `timeZone`. */
export function localParts(instant: Instant, timeZone: string): LocalParts {
  const parts = formatter(timeZone).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds (east positive). */
export function zoneOffsetMs(instant: Instant, timeZone: string): number {
  const p = localParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * Wall-clock time in a zone → UTC instant.
 *
 * Two passes: guess with the offset in force at the naive instant, then correct
 * with the offset actually in force at the answer. That converges everywhere
 * except inside a DST spring-forward gap, where the nominal time does not exist
 * and the result lands on the far side of the jump — which is the sane answer.
 */
export function zonedTimeToUtc(p: LocalParts, timeZone: string): Instant {
  const naive = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second ?? 0);
  const guess = naive - zoneOffsetMs(naive, timeZone);
  return naive - zoneOffsetMs(guess, timeZone);
}

/** Local noon on a given local calendar date, as a UTC instant. */
export function localNoon(year: number, month: number, day: number, timeZone: string): Instant {
  return zonedTimeToUtc({ year, month, day, hour: 12, minute: 0, second: 0 }, timeZone);
}

/** The local calendar date containing `instant`, as `YYYY-MM-DD`. */
export function localDateKey(instant: Instant, timeZone: string): string {
  const p = localParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

const timeCache = new Map<string, Intl.DateTimeFormat>();

/** "22:47" in the site's zone. Tabular figures are applied by CSS, not here. */
export function formatTime(instant: Instant | null, timeZone: string): string {
  if (instant == null) return '—';
  const key = `t:${timeZone}`;
  let f = timeCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
    timeCache.set(key, f);
  }
  return f.format(new Date(instant));
}

/** "Tue 18 Aug" in the site's zone. */
export function formatDate(instant: Instant, timeZone: string): string {
  const key = `d:${timeZone}`;
  let f = timeCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', day: 'numeric', month: 'short' });
    timeCache.set(key, f);
  }
  return f.format(new Date(instant));
}

/** "Tue 18 Aug 2026, 22:47" — for event detail lines. */
export function formatDateTime(instant: Instant, timeZone: string): string {
  return `${formatDate(instant, timeZone)}, ${formatTime(instant, timeZone)}`;
}

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
