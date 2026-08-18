/**
 * Meteor showers (spec §7.3).
 *
 * The peak is found from solar longitude, not a calendar date — calendar dates
 * drift by a day across the leap-year cycle and solar longitude does not.
 *
 * The rate that matters is not the ZHR on the tin. The IMO correction turns a
 * headline ZHR into what an observer at this site, under this sky, on this
 * night would actually count:
 *
 *   HR = ZHR · sin(hᵣ) / r^(6.5 − limitingMagnitude)
 *
 * A ZHR-100 shower with the radiant at 15° under a gibbous moon works out at a
 * handful an hour, and the score has to say so rather than shouting about a
 * hundred meteors.
 */
import * as A from 'astronomy-engine';
import { compassPoint, vectorFromRaDec } from '../frames';
import { limitingMagnitude, totalDuration } from '../twilight';
import { formatDateTime, formatTime, DAY, HOUR } from '../time';
import type { Instant, Vec3 } from '../types';
import type { Detector, SkyEvent } from './types';
import { interferenceFrom, score, showerRecurrence } from './scoring';
import { altAzOf, bestMoment, eventId, formatAltAz, nightsBetween } from './common';
import showersData from '../../data/generated/showers.json';
import type { Shower } from '../../data/catalog';

const SHOWERS = showersData as Shower[];

export const detectShowers: Detector = ({ site, from, to }) => {
  const events: SkyEvent[] = [];
  const nights = nightsBetween(site, from, to);

  for (const shower of SHOWERS) {
    for (const peak of peaksInRange(shower, from, to)) {
      // Observe the shower on the night the peak falls in — or the night before
      // it, if the peak lands in daylight, which is the usual case.
      const night =
        nights.find((n) => peak >= n.bounds[0] && peak <= n.bounds[1]) ??
        nights.find((n) => Math.abs(n.bounds[0] + DAY / 2 - peak) < DAY);
      if (!night) continue;

      const radiant = vectorFromRaDec(shower.ra / 15, shower.dec) as Vec3;
      const observing = night.astronomicalNight[0] ?? night.darkWindows[0];
      if (!observing) continue;

      const best = bestMoment(site, observing[0], observing[1], () => radiant);
      const lm = limitingMagnitude(site, best.instant);
      const rate = observedRate(shower, best.altitude, lm);

      const interference = interferenceFrom({
        site,
        instant: best.instant,
        targetAltitude: best.altitude,
        // Meteors are a naked-eye phenomenon at around third magnitude, and
        // that is what decides how badly moonlight hurts.
        targetMagnitude: 3,
      });

      const notes = [
        `Nominal ZHR ${shower.zhr}; from here, about ${Math.round(rate)} an hour at best.`,
        `Radiant reaches ${Math.round(best.altitude)}° in the ${compassPoint(best.azimuth)}.`,
      ];
      if (totalDuration(night.darkWindows) === 0 && night.astronomicalNight.length > 0) {
        notes.push('The Moon is up for all of astronomical darkness tonight.');
      }

      const scored = score({
        recurrenceDays: showerRecurrence(rate),
        bestAltitude: best.altitude,
        equipment: 'naked-eye',
        interference,
        notes,
      });

      // A shower delivering under two meteors an hour is not an event, however
      // rare its parent comet is.
      if (scored.score <= 0 || rate < 2) continue;

      events.push({
        id: eventId('shower', shower.code, peak),
        kind: 'shower',
        title: `${shower.name} peak`,
        detail: writeDetail(shower, rate, best.altitude, best.azimuth, observing, site.timezone),
        data: `ZHR ${shower.zhr} · ~${Math.round(rate)}/hr observed · ${formatAltAz(best.altitude, best.azimuth)} · ${formatDateTime(peak, site.timezone)}`,
        peak: clampInto(peak, observing) ?? peak,
        window: observing,
        bestAltitude: best.altitude,
        bestAzimuth: best.azimuth,
        equipment: 'naked-eye',
        score: scored.score,
        components: scored.components,
      });
    }
  }

  return events;
};

/**
 * Every instant in the range at which the Sun reaches the shower's peak solar
 * longitude. Usually one; two if the range spans more than a year.
 */
function peaksInRange(shower: Shower, from: Instant, to: Instant): Instant[] {
  const out: Instant[] = [];
  // Look back far enough that a shower whose activity started before the range
  // is still caught.
  let cursor = new Date(from - 30 * DAY);

  for (let guard = 0; guard < 8; guard++) {
    const found = A.SearchSunLongitude(shower.peak, cursor, 400);
    if (!found) break;
    const t = found.date.getTime();
    if (t > to + 30 * DAY) break;
    if (t >= from - DAY && t <= to + DAY) out.push(t);
    cursor = new Date(t + 30 * DAY);
  }
  return out;
}

/**
 * IMO's zenithal-hourly-rate correction: radiant altitude, then the population
 * index against this sky's limiting magnitude.
 */
export function observedRate(shower: Shower, radiantAltitude: number, limitingMag: number): number {
  if (radiantAltitude <= 0) return 0;
  const sinH = Math.sin((radiantAltitude * Math.PI) / 180);
  return (shower.zhr * sinH) / Math.pow(shower.r, 6.5 - limitingMag);
}

function writeDetail(
  shower: Shower,
  rate: number,
  altitude: number,
  azimuth: number,
  window: [Instant, Instant],
  timezone: string,
): string {
  const when = `between ${formatTime(window[0], timezone)} and ${formatTime(window[1], timezone)}`;
  const parent = shower.parent && shower.parent !== 'unknown' ? ` Debris from ${shower.parent}.` : '';

  if (rate < 5) {
    return `A thin shower — perhaps ${Math.round(rate)} an hour ${when}, with the radiant ${Math.round(altitude)}° up in the ${compassPoint(azimuth)}. Worth a glance if you are out anyway.${parent}`;
  }
  if (rate < 25) {
    return `Around ${Math.round(rate)} meteors an hour ${when}. Look about 40° away from the radiant, which sits ${Math.round(altitude)}° up in the ${compassPoint(azimuth)} — the long trails are off to the side, not at the centre.${parent}`;
  }
  return `The good one. Perhaps ${Math.round(rate)} an hour ${when}, radiant ${Math.round(altitude)}° up in the ${compassPoint(azimuth)}. Lie back, look up, and give your eyes twenty minutes to adapt.${parent}`;
}

function clampInto(t: Instant, window: [Instant, Instant]): Instant | null {
  if (t >= window[0] && t <= window[1]) return t;
  // The peak often falls in daylight. Pin the marker to the darkest hour of the
  // observing window instead of leaving it off the ribbon entirely.
  return window[0] + (window[1] - window[0]) / 2;
}

export { altAzOf, HOUR };
