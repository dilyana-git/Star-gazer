/**
 * The Moon: phases, perigee and apogee, and the nights when the terminator is
 * best for craters (spec §7.3).
 *
 * These score low on purpose. They are context — the thing the ribbon is
 * already telling you — not alarms. A full moon is not news; it is the reason
 * the rest of tonight's list is short.
 */
import * as A from 'astronomy-engine';
import { bodyAltAz, compassPoint } from '../frames';
import { formatDateTime, DAY, HOUR } from '../time';
import { nightWindowFor } from '../twilight';
import { phaseName } from '../../render/sky';
import type { Instant, Site } from '../types';
import type { Detector, SkyEvent } from './types';
import { interferenceFrom, RECURRENCE, score } from './scoring';
import { bestObservableMoment, eventId, formatAltAz, positionOf } from './common';

/** A perigee closer than this counts as a supermoon, in km. */
const SUPERMOON_KM = 361_000;

export const detectLunar: Detector = ({ site, from, to }) => {
  return [...phases(site, from, to), ...apsides(site, from, to), ...terminatorNights(site, from, to)];
};

function phases(site: Site, from: Instant, to: Instant): SkyEvent[] {
  const events: SkyEvent[] = [];
  let quarter = A.SearchMoonQuarter(new Date(from - DAY));

  for (let guard = 0; guard < 40; guard++) {
    const t = quarter.time.date.getTime();
    if (t > to) break;

    if (t >= from) {
      const event = phaseEvent(site, quarter, t);
      if (event) events.push(event);
    }
    quarter = A.NextMoonQuarter(quarter);
  }
  return events;
}

function phaseEvent(site: Site, quarter: A.MoonQuarter, t: Instant): SkyEvent | null {
  // A new moon is not something to look at — it is something that makes
  // everything else easier to look at. Report it as such, at the lowest score.
  const isNew = quarter.quarter === 0;
  const observed = bestObservableMoment(site, positionOf(A.Body.Moon, site), t - 12 * HOUR, t + 12 * HOUR);
  const illum = A.Illumination(A.Body.Moon, quarter.time);
  const name = phaseName(A.MoonPhase(quarter.time));

  // A new moon is never observable — that is the entire point of it. Its
  // "target" is the whole sky, so it is reported at the zenith rather than at
  // whatever daylight altitude the invisible Moon happens to occupy.
  const nightOf = nightWindowFor(site, t);
  const darkWindow = nightOf.darkWindows[0] ?? nightOf.astronomicalNight[0] ?? null;
  const best = isNew
    ? {
        instant: darkWindow ? (darkWindow[0] + darkWindow[1]) / 2 : t,
        altitude: 90,
        azimuth: 0,
      }
    : observed.moment;
  const window = isNew && darkWindow ? darkWindow : observed.window;
  if (!isNew && !observed.observable) return null;

  const interference = interferenceFrom({
    site,
    instant: best.instant,
    targetAltitude: best.altitude,
    targetMagnitude: -10,
    moonIsTarget: true,
  });

  const scored = score({
    recurrenceDays: RECURRENCE.lunarPhase,
    bestAltitude: best.altitude,
    equipment: 'naked-eye',
    interference,
    notes: [
      isNew
        ? 'New moon — the darkest skies of the month, either side of tonight. Scored against the whole sky rather than the Moon, which is not visible tonight by definition.'
        : `${Math.round(illum.phase_fraction * 100)}% of the disc lit.`,
    ],
  });

  if (scored.score <= 0) return null;

  return {
    id: eventId('moon-phase', String(quarter.quarter), t),
    kind: 'moon-phase',
    title: name,
    detail: isNew
      ? 'No moon in the sky all night. This is the week to go looking for faint things — galaxies, the Milky Way, meteors with no competition.'
      : quarter.quarter === 2
        ? `A full moon washes out everything faint, but it is worth looking at in its own right — and it is up all night, ${Math.round(best.altitude)}° at best in the ${compassPoint(best.azimuth)}.`
        : `Half the disc lit, which puts the terminator right down the middle — the best crater shadows of the month in binoculars.`,
    data: isNew
      ? `0% lit · the whole sky is the target · ${formatDateTime(t, site.timezone)}`
      : `${Math.round(illum.phase_fraction * 100)}% lit · ${formatAltAz(best.altitude, best.azimuth)} · ${formatDateTime(t, site.timezone)}`,
    peak: best.instant,
    window,
    bestAltitude: best.altitude,
    bestAzimuth: best.azimuth,
    equipment: 'naked-eye',
    score: scored.score,
    components: scored.components,
  };
}

function apsides(site: Site, from: Instant, to: Instant): SkyEvent[] {
  const events: SkyEvent[] = [];
  let apsis = A.SearchLunarApsis(new Date(from - DAY));

  for (let guard = 0; guard < 40; guard++) {
    const t = apsis.time.date.getTime();
    if (t > to) break;

    // Only perigees close enough to matter, and only when the Moon is near
    // full — a perigee at new moon is invisible by definition.
    if (t >= from && apsis.kind === A.ApsisKind.Pericenter && apsis.dist_km < SUPERMOON_KM) {
      const illum = A.Illumination(A.Body.Moon, apsis.time);
      if (illum.phase_fraction > 0.9) {
        const event = supermoonEvent(site, apsis, t, illum);
        if (event) events.push(event);
      }
    }
    apsis = A.NextLunarApsis(apsis);
  }
  return events;
}

function supermoonEvent(
  site: Site,
  apsis: A.Apsis,
  t: Instant,
  illum: A.IlluminationInfo,
): SkyEvent | null {
  const { moment: best, window } = bestObservableMoment(
    site,
    positionOf(A.Body.Moon, site),
    t - 12 * HOUR,
    t + 12 * HOUR,
  );

  const interference = interferenceFrom({
    site,
    instant: best.instant,
    targetAltitude: best.altitude,
    targetMagnitude: -12,
    moonIsTarget: true,
  });

  const scored = score({
    recurrenceDays: RECURRENCE.supermoon,
    bestAltitude: best.altitude,
    equipment: 'naked-eye',
    interference,
    notes: [
      `Perigee at ${Math.round(apsis.dist_km).toLocaleString()} km, against a mean of about 384,400.`,
      'Roughly 7% wider than an average full moon — real, but less dramatic than the name suggests.',
    ],
  });

  if (scored.score <= 0) return null;

  return {
    id: eventId('supermoon', 'perigee', t),
    kind: 'supermoon',
    title: 'Supermoon',
    detail: `Full moon within a day of perigee — about 7% wider and 15% brighter than average. The effect is genuine but modest; it looks most impressive low down, near the horizon, where your eye supplies the rest.`,
    data: `${Math.round(apsis.dist_km).toLocaleString()} km · ${Math.round(illum.phase_fraction * 100)}% lit · ${formatAltAz(best.altitude, best.azimuth)} · ${formatDateTime(t, site.timezone)}`,
    peak: best.instant,
    window,
    bestAltitude: best.altitude,
    bestAzimuth: best.azimuth,
    equipment: 'naked-eye',
    score: scored.score,
    components: scored.components,
  };
}

/**
 * The two or three nights a month when the terminator falls across the most
 * interesting ground. Around first quarter for the evening observer, and again
 * a couple of days either side.
 */
function terminatorNights(site: Site, from: Instant, to: Instant): SkyEvent[] {
  const events: SkyEvent[] = [];
  let quarter = A.SearchMoonQuarter(new Date(from - DAY));

  for (let guard = 0; guard < 40; guard++) {
    const t = quarter.time.date.getTime();
    if (t > to) break;

    // Only the quarters: at first and last quarter the shadows are longest
    // right across the middle of the visible disc.
    if (t >= from && (quarter.quarter === 1 || quarter.quarter === 3)) {
      const evening = quarter.quarter === 1;
      const { moment: best, window } = bestObservableMoment(
        site,
        positionOf(A.Body.Moon, site),
        t,
        t + 18 * HOUR,
      );

      if (best.altitude >= 15) {
        const interference = interferenceFrom({
          site,
          instant: best.instant,
          targetAltitude: best.altitude,
          targetMagnitude: -10,
          moonIsTarget: true,
        });

        const scored = score({
          recurrenceDays: RECURRENCE.lunarPhase / 2,
          bestAltitude: best.altitude,
          equipment: 'binocular',
          interference,
          notes: ['The terminator crosses the middle of the disc, so crater shadows are at their longest.'],
        });

        if (scored.score > 0) {
          events.push({
            id: eventId('terminator', String(quarter.quarter), t),
            kind: 'terminator',
            title: 'Best crater shadows of the month',
            detail: `With the Moon at ${evening ? 'first' : 'last'} quarter, the line between lunar day and night runs straight down the middle of the disc. Point binoculars along it: the craters that look flat at full moon are all rim and shadow tonight.`,
            data: `${formatAltAz(best.altitude, best.azimuth)} · best ${formatDateTime(best.instant, site.timezone)}`,
            peak: best.instant,
            window,
            bestAltitude: best.altitude,
            bestAzimuth: best.azimuth,
            equipment: 'binocular',
            score: scored.score,
            components: scored.components,
          });
        }
      }
    }
    quarter = A.NextMoonQuarter(quarter);
  }
  return events;
}

export { bodyAltAz };
