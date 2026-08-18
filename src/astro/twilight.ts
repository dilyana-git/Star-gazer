/**
 * Darkness and observing windows (spec §6). Everything in the event engine
 * depends on this.
 *
 * "A night" runs from local noon to local noon, so an evening and the morning
 * that follows it belong to the same record — which is how an observer thinks
 * about it, and it keeps a 01:00 event on the right night.
 *
 * The degenerate cases are the point. Above about 49° latitude there are summer
 * nights with no astronomical darkness at all; above the Arctic circle there
 * are days with no sunset. Both produce nulls here, deliberately, and the UI
 * says so in words rather than rendering an empty list with no explanation.
 */
import * as A from 'astronomy-engine';
import { bodyAltAz, observerFor, RISE_SET_ALTITUDE_STAR } from './frames';
import { DAY, localNoon, localParts } from './time';
import type { Instant, Site } from './types';

export interface NightWindow {
  /** Local calendar date this night belongs to, `YYYY-MM-DD` (the evening's date). */
  date: string;
  /** Noon-to-noon bounds, so the ribbon knows what it is drawing. */
  bounds: [Instant, Instant];

  sunset: Instant | null;
  civilDusk: Instant | null; // sun at −6°
  nauticalDusk: Instant | null; // −12°
  astronomicalDusk: Instant | null; // −18°
  astronomicalDawn: Instant | null;
  civilDawn: Instant | null;
  sunrise: Instant | null;

  moonrise: Instant | null;
  moonset: Instant | null;
  /** 0–1 at local midnight. */
  moonIllumination: number;
  /** Intervals within the night when the Moon is above the horizon. */
  moonUp: Array<[Instant, Instant]>;

  /** Astronomical darkness minus any interval with the Moon above the horizon. */
  darkWindows: Array<[Instant, Instant]>;
  /** Astronomical darkness, moon or no moon. Empty at high summer latitudes. */
  astronomicalNight: Array<[Instant, Instant]>;

  /** Why there is no darkness, when there is none — for the UI to say out loud. */
  darknessNote: string | null;
}

/** Sun altitude thresholds, degrees. */
const CIVIL = -6;
const NAUTICAL = -12;
const ASTRONOMICAL = -18;

/**
 * Naked-eye limiting magnitude by Bortle class, from the published scale's
 * NELM column rather than an interpolation between the endpoints.
 * Index 0 is unused so the array reads by class number.
 */
export const BORTLE_BASE_MAG = [0, 7.8, 7.3, 6.8, 6.3, 5.8, 5.3, 4.8, 4.3, 4.0];

export function bortleBaseMag(bortle: number): number {
  return BORTLE_BASE_MAG[Math.max(1, Math.min(9, Math.round(bortle)))];
}

/**
 * The single number that drives both what renders and what gets recommended.
 *
 *   limitingMag = bortleBaseMag − moonPenalty
 *   moonPenalty = moonAboveHorizon ? illumination × 2.0 × sin(moonAltitude) : 0
 *
 * ...and then capped by the Sun, because the same honesty that makes the Bortle
 * slider worth having applies at four in the afternoon. A chart that draws nine
 * thousand stars at midday is telling the reader something false.
 */
export function limitingMagnitude(site: Site, instant: Instant): number {
  const base = bortleBaseMag(site.bortle);

  // Geometric altitude, not apparent: the penalty is about how much sky the
  // Moon is lighting, and refraction near the horizon does not change that.
  const moon = bodyAltAz(A.Body.Moon, instant, site);
  let value = base;
  if (moon.altitude > 0) {
    const illumination = A.Illumination(A.Body.Moon, new Date(instant)).phase_fraction;
    value -= illumination * 2.0 * Math.sin((moon.altitude * Math.PI) / 180);
  }

  return Math.min(value, twilightCap(site, instant, base));
}

/**
 * What the sky itself allows, whatever the light pollution: roughly magnitude
 * −4 in daylight (Venus, and only if you know exactly where to look), about 1
 * at civil dusk when the first stars appear, about 4 at nautical dusk, and no
 * cap at all once astronomical night has arrived.
 */
export function twilightCap(site: Site, instant: Instant, base: number): number {
  const sun = bodyAltAz(A.Body.Sun, instant, site).altitude;
  if (sun <= ASTRONOMICAL) return Infinity;

  const stops: Array<[number, number]> = [
    [0, -4],
    [CIVIL, 1.0],
    [NAUTICAL, 4.0],
    [ASTRONOMICAL, base],
  ];

  if (sun >= 0) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [altHi, magHi] = stops[i - 1];
    const [altLo, magLo] = stops[i];
    if (sun >= altLo) {
      const f = (sun - altHi) / (altLo - altHi);
      return magHi + (magLo - magHi) * f;
    }
  }
  return base;
}

/**
 * The night belonging to the local calendar date containing `instant`, unless
 * `instant` is in the small hours — before local noon the night that is still
 * in progress is the *previous* date's.
 */
export function nightWindowFor(site: Site, instant: Instant): NightWindow {
  const p = localParts(instant, site.timezone);
  const anchor = p.hour < 12 ? instant - DAY : instant;
  const a = localParts(anchor, site.timezone);
  return nightWindow(site, a.year, a.month, a.day);
}

export function nightWindow(site: Site, year: number, month: number, day: number): NightWindow {
  const obs = observerFor(site);
  const start = localNoon(year, month, day, site.timezone);
  const end = start + DAY;
  const span = (end - start) / DAY;

  const at = (t: A.AstroTime | null): Instant | null => (t ? t.date.getTime() : null);
  const within = (t: Instant | null): Instant | null => (t != null && t >= start && t <= end ? t : null);

  const sunset = within(at(A.SearchRiseSet(A.Body.Sun, obs, -1, new Date(start), span)));
  const sunrise = within(at(A.SearchRiseSet(A.Body.Sun, obs, +1, new Date(sunset ?? start), span)));

  // Dusk descends after sunset; dawn ascends before sunrise. Anchoring each
  // search to the event it follows keeps them in the right order on nights
  // where one of them does not happen at all.
  const duskFrom = sunset ?? start;
  const civilDusk = within(at(A.SearchAltitude(A.Body.Sun, obs, -1, new Date(duskFrom), span, CIVIL)));
  const nauticalDusk = within(at(A.SearchAltitude(A.Body.Sun, obs, -1, new Date(civilDusk ?? duskFrom), span, NAUTICAL)));
  const astronomicalDusk = within(
    at(A.SearchAltitude(A.Body.Sun, obs, -1, new Date(nauticalDusk ?? duskFrom), span, ASTRONOMICAL)),
  );

  const dawnFrom = astronomicalDusk ?? nauticalDusk ?? civilDusk ?? duskFrom;
  const astronomicalDawn = within(at(A.SearchAltitude(A.Body.Sun, obs, +1, new Date(dawnFrom), span, ASTRONOMICAL)));
  const civilDawn = within(
    at(A.SearchAltitude(A.Body.Sun, obs, +1, new Date(astronomicalDawn ?? dawnFrom), span, CIVIL)),
  );

  const moonrise = within(at(A.SearchRiseSet(A.Body.Moon, obs, +1, new Date(start), span)));
  const moonset = within(at(A.SearchRiseSet(A.Body.Moon, obs, -1, new Date(start), span)));
  const midnight = start + DAY / 2;
  const moonIllumination = A.Illumination(A.Body.Moon, new Date(midnight)).phase_fraction;

  const moonUp = intervalsAboveHorizon(site, A.Body.Moon, start, end);
  const astronomicalNight: Array<[Instant, Instant]> =
    astronomicalDusk != null && astronomicalDawn != null && astronomicalDawn > astronomicalDusk
      ? [[astronomicalDusk, astronomicalDawn]]
      : [];

  // A two-minute gap between moonset and dawn is not an observing window.
  const darkWindows = dropSlivers(subtract(astronomicalNight, moonUp), 10 * 60_000);

  return {
    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    bounds: [start, end],
    sunset,
    civilDusk,
    nauticalDusk,
    astronomicalDusk,
    astronomicalDawn,
    civilDawn,
    sunrise,
    moonrise,
    moonset,
    moonIllumination,
    moonUp,
    darkWindows,
    astronomicalNight,
    darknessNote: darknessNote(site, midnight, { sunset, sunrise, astronomicalNight, darkWindows }),
  };
}

function darknessNote(
  site: Site,
  midnight: Instant,
  n: {
    sunset: Instant | null;
    sunrise: Instant | null;
    astronomicalNight: Array<[Instant, Instant]>;
    darkWindows: Array<[Instant, Instant]>;
  },
): string | null {
  if (n.sunset == null && n.sunrise == null) {
    // Neither a sunset nor a sunrise means the Sun spent the whole day on one
    // side of the horizon. Which side is a question with an answer — ask it,
    // rather than inferring it from the hemisphere and the month.
    return bodyAltAz(A.Body.Sun, midnight, site).altitude > 0
      ? 'The Sun does not set tonight — it is daylight around the clock at this latitude at this time of year.'
      : 'The Sun does not rise at all today. It is dark around the clock.';
  }
  if (n.astronomicalNight.length === 0) {
    return 'No astronomical darkness tonight — the Sun stays above −18°. The sky never gets fully dark here at this time of year.';
  }
  if (n.darkWindows.length === 0) {
    return 'The Moon is above the horizon for the whole of astronomical darkness tonight.';
  }
  return null;
}

/**
 * When a body is above the horizon between two instants. Uses the library's
 * rise/set search rather than sampling, so a moonrise is found to the second
 * rather than to whatever step size we happened to pick.
 */
export function intervalsAboveHorizon(
  site: Site,
  body: A.Body,
  from: Instant,
  to: Instant,
): Array<[Instant, Instant]> {
  const obs = observerFor(site);
  const span = (to - from) / DAY;
  const out: Array<[Instant, Instant]> = [];

  // Match SearchRiseSet's own convention — a body's centre is "up" from a
  // little below the geometric horizon, because its limb clears first and
  // refraction lifts it. Sampling with a different rule than the search uses
  // makes the two disagree at exactly the boundary.
  const threshold = body === A.Body.Sun || body === A.Body.Moon ? -0.8333 : RISE_SET_ALTITUDE_STAR;

  let cursor = from;
  let up = bodyAltAz(body, from, site).altitude > threshold;
  let openedAt = up ? from : null;

  // At most a handful of transitions in a day; the loop bound is a guard, not
  // an expectation.
  for (let guard = 0; guard < 8 && cursor < to; guard++) {
    const next = A.SearchRiseSet(body, obs, up ? -1 : +1, new Date(cursor + 1000), span);
    const t = next ? next.date.getTime() : null;
    if (t == null || t > to) break;

    if (up) {
      out.push([openedAt ?? from, t]);
      openedAt = null;
    } else {
      openedAt = t;
    }
    up = !up;
    cursor = t;
  }

  if (up && openedAt != null) out.push([openedAt, to]);
  return out.filter(([s, e]) => e > s);
}

/** Interval-set difference: `a` minus everything in `b`. */
export function subtract(
  a: Array<[Instant, Instant]>,
  b: Array<[Instant, Instant]>,
): Array<[Instant, Instant]> {
  let out = a.map((iv) => [...iv] as [Instant, Instant]);

  for (const [bs, be] of b) {
    const next: Array<[Instant, Instant]> = [];
    for (const [as_, ae] of out) {
      if (be <= as_ || bs >= ae) {
        next.push([as_, ae]);
        continue;
      }
      if (bs > as_) next.push([as_, bs]);
      if (be < ae) next.push([be, ae]);
    }
    out = next;
  }

  return out;
}

/** Drop intervals too short to be worth going outside for. */
export function dropSlivers(
  intervals: Array<[Instant, Instant]>,
  minimumMs = 60_000,
): Array<[Instant, Instant]> {
  return intervals.filter(([s, e]) => e - s > minimumMs);
}

/** Total duration of a set of intervals, in milliseconds. */
export function totalDuration(intervals: Array<[Instant, Instant]>): number {
  return intervals.reduce((sum, [s, e]) => sum + (e - s), 0);
}

/** Whether `t` falls inside any of the intervals. */
export function inIntervals(intervals: Array<[Instant, Instant]>, t: Instant): boolean {
  return intervals.some(([s, e]) => t >= s && t <= e);
}

/**
 * How dark it is at an instant, 0 (daylight) to 1 (astronomical night).
 * The night ribbon's gradient is this function sampled across the night.
 */
export function darkness(site: Site, instant: Instant): number {
  // Geometric altitude. The twilight thresholds are defined on the Sun's
  // geometric centre, and that is what the dusk/dawn searches above use — take
  // the apparent altitude here instead and the gradient stops lining up with
  // the instants it is supposed to be interpolating between.
  const alt = bodyAltAz(A.Body.Sun, instant, site).altitude;
  if (alt >= 0) return 0;
  if (alt <= ASTRONOMICAL) return 1;
  return Math.min(1, Math.max(0, -alt / -ASTRONOMICAL));
}
