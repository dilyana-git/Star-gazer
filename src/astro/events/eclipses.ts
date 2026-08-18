/**
 * Eclipses, lunar and solar (spec §7.3).
 *
 * Solar eclipses are computed as **local** circumstances. An eclipse that is
 * total in Chile is nothing in Sofia, and reporting a global magnitude would be
 * confidently wrong. astronomy-engine's `SearchLocalSolarEclipse` returns the
 * observer's own obscuration and contact times, so the spec's fallback ("report
 * only visible: yes/no") is not needed — see NOTES.md §2.
 */
import * as A from 'astronomy-engine';
import { bodyAltAz, compassPoint, observerFor } from '../frames';
import { formatDateTime, formatTime, DAY } from '../time';
import type { Instant, Site } from '../types';
import type { Detector, SkyEvent } from './types';
import { interferenceFrom, RECURRENCE, score } from './scoring';
import { eventId, formatAltAz } from './common';

export const detectEclipses: Detector = ({ site, from, to }) => {
  return [...lunarEclipses(site, from, to), ...solarEclipses(site, from, to)];
};

function lunarEclipses(site: Site, from: Instant, to: Instant): SkyEvent[] {
  const events: SkyEvent[] = [];
  let eclipse = A.SearchLunarEclipse(new Date(from - DAY));

  for (let guard = 0; guard < 12; guard++) {
    const peak = eclipse.peak.date.getTime();
    if (peak > to) break;

    if (peak >= from) {
      const event = lunarEvent(site, eclipse);
      if (event) events.push(event);
    }
    eclipse = A.NextLunarEclipse(eclipse.peak);
  }
  return events;
}

function lunarEvent(site: Site, eclipse: A.LunarEclipseInfo): SkyEvent | null {
  const peak = eclipse.peak.date.getTime();
  // sd_partial and sd_total are semi-durations in minutes; fall back to the
  // penumbral one for a penumbral eclipse.
  const semi = (eclipse.sd_partial || eclipse.sd_penum) * 60_000;
  const window: [Instant, Instant] = [peak - semi, peak + semi];

  const at = bodyAltAz(A.Body.Moon, peak, site);
  // Sample the window for the best altitude — the Moon can rise mid-eclipse.
  let best = at;
  let bestInstant = peak;
  for (let t = window[0]; t <= window[1]; t += 10 * 60_000) {
    const h = bodyAltAz(A.Body.Moon, t, site);
    if (h.altitude > best.altitude) {
      best = h;
      bestInstant = t;
    }
  }

  const recurrence =
    eclipse.kind === A.EclipseKind.Total
      ? RECURRENCE.lunarEclipseLocal
      : eclipse.kind === A.EclipseKind.Partial
        ? RECURRENCE.lunarEclipseLocal / 2
        : RECURRENCE.lunarPhase * 6;

  const interference = interferenceFrom({
    site,
    instant: bestInstant,
    targetAltitude: best.altitude,
    targetMagnitude: -10,
    // The Moon *is* the target, so moonlight is not interference.
    moonIsTarget: true,
  });

  const scored = score({
    recurrenceDays: recurrence,
    bestAltitude: best.altitude,
    equipment: 'naked-eye',
    interference,
    notes: [
      `${describeKind(eclipse.kind)} lunar eclipse, ${Math.round(eclipse.obscuration * 100)}% of the disc covered at maximum.`,
      best.altitude <= 0
        ? 'The Moon is below the horizon from here at maximum.'
        : `The Moon is ${Math.round(best.altitude)}° up in the ${compassPoint(best.azimuth)}.`,
    ],
  });

  if (scored.score <= 0) return null;

  return {
    id: eventId('lunar-eclipse', eclipse.kind, peak),
    kind: 'lunar-eclipse',
    title: `${capitalise(describeKind(eclipse.kind))} lunar eclipse`,
    detail:
      eclipse.kind === A.EclipseKind.Total
        ? `The Moon passes fully into Earth's shadow and turns a deep copper red for the best part of an hour. No equipment, no filter, no excuse — just look up in the ${compassPoint(best.azimuth)}.`
        : eclipse.kind === A.EclipseKind.Partial
          ? `Earth's shadow takes a visible bite out of the Moon — ${Math.round(eclipse.obscuration * 100)}% of it at maximum, in the ${compassPoint(best.azimuth)}.`
          : `A penumbral eclipse: the Moon dims slightly rather than darkening. Subtle enough that you may only notice it in a photograph.`,
    data: `${Math.round(eclipse.obscuration * 100)}% obscured · ${formatAltAz(best.altitude, best.azimuth)} · maximum ${formatDateTime(peak, site.timezone)}`,
    peak,
    window,
    bestAltitude: best.altitude,
    bestAzimuth: best.azimuth,
    equipment: 'naked-eye',
    score: scored.score,
    components: scored.components,
  };
}

function solarEclipses(site: Site, from: Instant, to: Instant): SkyEvent[] {
  const events: SkyEvent[] = [];
  const observer = observerFor(site);
  let eclipse: A.LocalSolarEclipseInfo;

  try {
    eclipse = A.SearchLocalSolarEclipse(new Date(from - DAY), observer);
  } catch {
    return events;
  }

  for (let guard = 0; guard < 12; guard++) {
    const peak = eclipse.peak.time.date.getTime();
    if (peak > to) break;

    if (peak >= from) {
      const event = solarEvent(site, eclipse);
      if (event) events.push(event);
    }

    try {
      eclipse = A.NextLocalSolarEclipse(eclipse.peak.time, observer);
    } catch {
      break;
    }
  }
  return events;
}

function solarEvent(site: Site, eclipse: A.LocalSolarEclipseInfo): SkyEvent | null {
  const peak = eclipse.peak.time.date.getTime();
  const window: [Instant, Instant] = [
    eclipse.partial_begin.time.date.getTime(),
    eclipse.partial_end.time.date.getTime(),
  ];

  const altitude = eclipse.peak.altitude;
  const { azimuth } = bodyAltAz(A.Body.Sun, peak, site);

  const recurrence =
    eclipse.kind === A.EclipseKind.Total
      ? RECURRENCE.solarEclipseTotalLocal
      : eclipse.kind === A.EclipseKind.Annular
        ? RECURRENCE.solarEclipseTotalLocal / 2
        : RECURRENCE.solarEclipsePartialLocal;

  // Daylight is not interference for a solar eclipse — it is the medium.
  const interference = { value: 1, notes: ['The Sun is the target; daylight is not a penalty here.'] };

  const scored = score({
    recurrenceDays: recurrence,
    bestAltitude: altitude,
    equipment: 'naked-eye',
    interference,
    notes: [
      `${Math.round(eclipse.obscuration * 100)}% of the Sun's disc covered from this location at maximum.`,
      'Local circumstances, computed for these coordinates — not the global maximum.',
    ],
  });

  if (scored.score <= 0) return null;

  const total = eclipse.kind === A.EclipseKind.Total;
  const title = total
    ? 'Total solar eclipse — from here'
    : eclipse.kind === A.EclipseKind.Annular
      ? 'Annular solar eclipse — from here'
      : `Partial solar eclipse, ${Math.round(eclipse.obscuration * 100)}% covered`;

  return {
    id: eventId('solar-eclipse', eclipse.kind, peak),
    kind: 'solar-eclipse',
    title,
    detail: total
      ? `Totality, from where you are standing. Cancel everything. Certified solar filters until the diamond ring goes out — and only then, for the duration of totality, with the naked eye.`
      : `The Moon covers ${Math.round(eclipse.obscuration * 100)}% of the Sun at maximum, ${Math.round(altitude)}° up in the ${compassPoint(azimuth)}. **A certified solar filter is not optional** — no sunglasses, no exposed film, no looking through anything unfiltered.`,
    data: `${Math.round(eclipse.obscuration * 100)}% obscured · ${formatAltAz(altitude, azimuth)} · first contact ${formatTime(window[0], site.timezone)}, maximum ${formatTime(peak, site.timezone)}`,
    peak,
    window,
    bestAltitude: altitude,
    bestAzimuth: azimuth,
    equipment: 'naked-eye',
    score: scored.score,
    components: scored.components,
  };
}

function describeKind(kind: A.EclipseKind): string {
  return kind === A.EclipseKind.Total
    ? 'total'
    : kind === A.EclipseKind.Partial
      ? 'partial'
      : kind === A.EclipseKind.Annular
        ? 'annular'
        : 'penumbral';
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
