/** Shared machinery for the event detectors. */
import * as A from 'astronomy-engine';
import { altAzFromHorVector, bodyVectorEqj, rotate, rotationEqjToHor, vectorFromRaDec } from '../frames';
import { nightWindow } from '../twilight';
import { localParts, DAY, MINUTE } from '../time';
import type { Instant, Site, Vec3 } from '../types';
import type { NightWindow } from '../twilight';

/** The four bright ecliptic stars the Moon can occult (spec §7.3). */
export const ECLIPTIC_STARS = [
  { name: 'Aldebaran', ra: 4.59868, dec: 16.50931, mag: 0.85 },
  { name: 'Regulus', ra: 10.13953, dec: 11.96719, mag: 1.36 },
  { name: 'Spica', ra: 13.41988, dec: -11.16133, mag: 0.97 },
  { name: 'Antares', ra: 16.49013, dec: -26.432, mag: 1.06 },
].map((s) => ({ ...s, vector: vectorFromRaDec(s.ra, s.dec) as Vec3 }));

export const PLANET_BODIES = [
  A.Body.Mercury,
  A.Body.Venus,
  A.Body.Mars,
  A.Body.Jupiter,
  A.Body.Saturn,
  A.Body.Uranus,
  A.Body.Neptune,
];

/** Where a target is, at a moment, from a site. */
export interface Moment {
  instant: Instant;
  altitude: number;
  azimuth: number;
}

export type PositionAt = (instant: Instant) => Vec3;

export function positionOf(body: A.Body, site: Site): PositionAt {
  return (instant) => bodyVectorEqj(body, instant, site);
}

export function fixedPosition(vector: Vec3): PositionAt {
  return () => vector;
}

export function altAzOf(site: Site, instant: Instant, vector: Vec3): { altitude: number; azimuth: number } {
  const [x, y, z] = rotate(rotationEqjToHor(site, instant), vector);
  return altAzFromHorVector(x, y, z);
}

/**
 * The highest the target gets between two instants, sampled coarsely and then
 * refined. Ten-minute resolution on the refinement is finer than any of the
 * copy this feeds.
 */
export function bestMoment(site: Site, from: Instant, to: Instant, position: PositionAt): Moment {
  const span = to - from;
  const coarse = Math.max(10 * MINUTE, span / 48);

  let best: Moment = { instant: from, altitude: -90, azimuth: 0 };
  for (let t = from; t <= to; t += coarse) {
    const { altitude, azimuth } = altAzOf(site, t, position(t));
    if (altitude > best.altitude) best = { instant: t, altitude, azimuth };
  }

  // Refine around the coarse winner.
  for (let t = best.instant - coarse; t <= best.instant + coarse; t += 5 * MINUTE) {
    if (t < from || t > to) continue;
    const { altitude, azimuth } = altAzOf(site, t, position(t));
    if (altitude > best.altitude) best = { instant: t, altitude, azimuth };
  }

  return best;
}

/**
 * Ternary search for the minimum of a unimodal function on [lo, hi].
 * Used to refine a conjunction's closest approach to arcminute precision.
 */
export function refineMinimum(
  lo: Instant,
  hi: Instant,
  f: (t: Instant) => number,
  toleranceMs = 30_000,
): { instant: Instant; value: number } {
  let a = lo;
  let b = hi;
  while (b - a > toleranceMs) {
    const m1 = a + (b - a) / 3;
    const m2 = b - (b - a) / 3;
    if (f(m1) < f(m2)) b = m2;
    else a = m1;
  }
  const instant = (a + b) / 2;
  return { instant, value: f(instant) };
}

/** The nights (noon-to-noon) overlapping a range, in order. */
export function nightsBetween(site: Site, from: Instant, to: Instant): NightWindow[] {
  const out: NightWindow[] = [];
  const first = localParts(from, site.timezone);
  let cursor = Date.UTC(first.year, first.month - 1, first.day, 12);

  // Walk local dates, not UTC days: a night belongs to the local calendar.
  for (let guard = 0; guard < 400; guard++) {
    const p = localParts(cursor, site.timezone);
    const night = nightWindow(site, p.year, p.month, p.day);
    if (night.bounds[0] > to) break;
    if (night.bounds[1] >= from) out.push(night);
    cursor += DAY;
  }
  return out;
}

/** The night a given instant belongs to, from a precomputed list. */
export function nightContaining(nights: NightWindow[], t: Instant): NightWindow | null {
  return nights.find((n) => t >= n.bounds[0] && t <= n.bounds[1]) ?? null;
}

/**
 * The longest continuous stretch in which the target is usefully up and the sky
 * is at least civil-dark. This is what "when it is observable from this site"
 * means on a SkyEvent.
 *
 * Longest *continuous*, not first-to-last: a bracket spanning more than a day
 * contains two separate twilights with daylight in between, and reporting the
 * span from the first to the last would claim the event was observable right
 * through the afternoon.
 */
export function observableWindow(
  site: Site,
  position: PositionAt,
  from: Instant,
  to: Instant,
  minimumAltitude = 10,
): [Instant, Instant] | null {
  const step = Math.max(5 * MINUTE, (to - from) / 192);

  let best: [Instant, Instant] | null = null;
  let runStart: Instant | null = null;
  let previous: Instant | null = null;

  for (let t = from; t <= to; t += step) {
    const { altitude } = altAzOf(site, t, position(t));
    const sun = altAzOf(site, t, bodyVectorEqj(A.Body.Sun, t, site));
    const usable = altitude >= minimumAltitude && sun.altitude < -6;

    if (usable) {
      runStart ??= t;
      previous = t;
    } else if (runStart != null && previous != null) {
      if (!best || previous - runStart > best[1] - best[0]) best = [runStart, previous];
      runStart = null;
      previous = null;
    }
  }
  if (runStart != null && previous != null && (!best || previous - runStart > best[1] - best[0])) {
    best = [runStart, previous];
  }

  return best && best[1] > best[0] ? best : null;
}

/**
 * The best moment the event can *actually* be seen, not the best moment it
 * exists.
 *
 * A conjunction peaks when the two bodies are closest, which is frequently at
 * two in the afternoon. Reporting that moment's altitude tells the reader that
 * Mercury was 63° up — true, and useless, because the Sun was up too. So: find
 * the part of the bracket that is dark and above the horizon, and evaluate the
 * event there. Only when no such part exists does it fall back to the raw
 * bracket, and then the interference term is left to say why.
 */
export function bestObservableMoment(
  site: Site,
  position: PositionAt,
  from: Instant,
  to: Instant,
): { moment: Moment; window: [Instant, Instant]; observable: boolean } {
  // Altitude 0, not 10: the 10° rule belongs to the visibility score, and
  // applying it here would hide a low event rather than scoring it low.
  const window = observableWindow(site, position, from, to, 0);
  if (window) {
    return { moment: bestMoment(site, window[0], window[1], position), window, observable: true };
  }
  return { moment: bestMoment(site, from, to, position), window: [from, to], observable: false };
}

/** Stable, human-legible event ids so React keys and focus survive a re-run. */
export function eventId(kind: string, key: string, instant: Instant): string {
  return `${kind}:${key}:${Math.round(instant / 60_000)}`;
}

/** "0.51°" or "31′" — whichever reads better at that size. */
export function formatAngle(degrees: number): string {
  if (degrees < 1) return `${(degrees * 60).toFixed(0)}′`;
  return `${degrees.toFixed(2)}°`;
}

export function formatAltAz(altitude: number, azimuth: number): string {
  return `alt ${altitude.toFixed(0)}° · az ${azimuth.toFixed(0)}°`;
}
