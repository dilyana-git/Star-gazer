/**
 * Close approaches and occultations (spec §7.3).
 *
 * Pairwise angular separation across the Moon, the seven planets, and the four
 * bright ecliptic stars the Moon can pass in front of. Sampled at six-hour
 * steps, local minima refined by ternary search, reported under 3°.
 *
 * Separations are *true* — computed from unrefracted topocentric vectors —
 * because "how far apart are they really" is what the number means (§5.3).
 * Topocentric matters here more than anywhere else in the app: the Moon's
 * parallax reaches a degree, which is the difference between an occultation and
 * a near miss.
 */
import * as A from 'astronomy-engine';
import { bodyVectorEqj, compassPoint, moonAngularRadius, separation } from '../frames';
import { formatDateTime, HOUR } from '../time';
import type { Instant, Site, Vec3 } from '../types';
import type { Detector, SkyEvent } from './types';
import { interferenceFrom, RECURRENCE, score } from './scoring';
import {
  bestObservableMoment,
  ECLIPTIC_STARS,
  eventId,
  formatAltAz,
  formatAngle,
  PLANET_BODIES,
  refineMinimum,
} from './common';

/** Report anything closer than this. */
const REPORT_BELOW_DEG = 3;
const SAMPLE_STEP = 6 * HOUR;

interface Target {
  key: string;
  name: string;
  /** Approximate magnitude, for the interference weighting. */
  mag: number;
  isMoon: boolean;
  at(instant: Instant): Vec3;
}

export const detectConjunctions: Detector = ({ site, from, to }) => {
  const targets = buildTargets(site);

  // Cache every body's position at every sample instant once, rather than
  // recomputing it for each of the sixty-odd pairs.
  const times: Instant[] = [];
  for (let t = from; t <= to + SAMPLE_STEP; t += SAMPLE_STEP) times.push(t);

  const cache = new Map<string, Vec3[]>();
  for (const target of targets) {
    cache.set(
      target.key,
      times.map((t) => target.at(t)),
    );
  }

  const events: SkyEvent[] = [];

  for (let i = 0; i < targets.length; i++) {
    for (let j = i + 1; j < targets.length; j++) {
      const a = targets[i];
      const b = targets[j];
      // Two fixed stars never approach each other.
      if (!a.isMoon && !isMoving(a) && !isMoving(b)) continue;

      const va = cache.get(a.key)!;
      const vb = cache.get(b.key)!;
      const sep = times.map((_, k) => separation(va[k], vb[k]));

      for (let k = 1; k < times.length - 1; k++) {
        if (!(sep[k] < sep[k - 1] && sep[k] <= sep[k + 1])) continue;
        // Skip minima that are nowhere near close; refining them costs work and
        // yields nothing reportable.
        if (sep[k] > REPORT_BELOW_DEG + 8) continue;

        const f = (t: Instant) => separation(a.at(t), b.at(t));
        const min = refineMinimum(times[k - 1], times[k + 1], f);
        if (min.value > REPORT_BELOW_DEG) continue;
        if (min.instant < from || min.instant > to) continue;

        const event = buildEvent(site, a, b, min.instant, min.value);
        if (event) events.push(event);
      }
    }
  }

  return dedupe(events);
};

function isMoving(t: Target): boolean {
  return !t.key.startsWith('star:');
}

function buildTargets(site: Site): Target[] {
  const moon: Target = {
    key: 'Moon',
    name: 'the Moon',
    mag: -12,
    isMoon: true,
    at: (t) => bodyVectorEqj(A.Body.Moon, t, site),
  };

  const planets: Target[] = PLANET_BODIES.map((body) => ({
    key: body,
    name: body,
    mag: approximateMagnitude(body),
    isMoon: false,
    at: (t: Instant) => bodyVectorEqj(body, t, site),
  }));

  const stars: Target[] = ECLIPTIC_STARS.map((s) => ({
    key: `star:${s.name}`,
    name: s.name,
    mag: s.mag,
    isMoon: false,
    at: () => s.vector,
  }));

  return [moon, ...planets, ...stars];
}

function approximateMagnitude(body: A.Body): number {
  // Only used to weight the interference penalty, so a representative value is
  // enough; the real magnitude at the peak goes into the copy.
  const typical: Partial<Record<A.Body, number>> = {
    [A.Body.Mercury]: 0,
    [A.Body.Venus]: -4,
    [A.Body.Mars]: 0.5,
    [A.Body.Jupiter]: -2.2,
    [A.Body.Saturn]: 0.6,
    [A.Body.Uranus]: 5.7,
    [A.Body.Neptune]: 7.8,
  };
  return typical[body] ?? 3;
}

function buildEvent(
  site: Site,
  a: Target,
  b: Target,
  peak: Instant,
  sepDeg: number,
): SkyEvent | null {
  const moonRadius = a.isMoon || b.isMoon ? moonAngularRadius(peak, site) : 0;
  const isOccultation = moonRadius > 0 && sepDeg < moonRadius;

  // An occultation is over in minutes and has to be watched as it happens.
  // A conjunction does not: two planets half a degree apart at two in the
  // afternoon are still three-quarters of a degree apart at dusk, and dusk is
  // when you can see them. So the bracket reaches out to the twilight either
  // side of the closest approach rather than stopping three hours short of it.
  const halfWindow = isOccultation ? 90 * 60_000 : 12 * HOUR;
  const position = (t: Instant) => (a.isMoon ? b.at(t) : a.at(t));
  const { moment: best, window, observable } = bestObservableMoment(
    site,
    position,
    peak - halfWindow,
    peak + halfWindow,
  );

  // If there is no dark moment in the whole day around the closest approach
  // when both bodies are up, this is not an event *from here*. Drop it rather
  // than list it with a daylight altitude and a low score — the panel is a
  // recommendation, and an unobservable recommendation is noise.
  if (!observable) return null;

  // How far apart the pair is when you can actually look at them, which is not
  // the same number as the closest approach if that happened in daylight.
  const sepWhenSeen = separation(a.at(best.instant), b.at(best.instant));

  // The pair can drift well apart between the closest approach and the next
  // dark sky. If they are no longer close by the time anyone can look, there is
  // nothing here to report — the headline would be describing a moment nobody
  // in this timezone can see.
  if (!isOccultation && sepWhenSeen > REPORT_BELOW_DEG) return null;

  const faintest = Math.max(a.isMoon ? -99 : a.mag, b.isMoon ? -99 : b.mag);
  const equipment = faintest > 5.5 ? 'telescope' : faintest > 4 ? 'binocular' : 'naked-eye';

  // How often a pairing like this comes round. The Moon sweeps past everything
  // on the ecliptic monthly, so its ordinary conjunctions are common; a genuine
  // near-miss, and an occultation of one of the four bright ecliptic stars, are
  // not.
  const involvesMoon = a.isMoon || b.isMoon;
  const recurrence = isOccultation
    ? RECURRENCE.occultationBrightStar
    : involvesMoon
      ? sepWhenSeen < 0.5
        ? RECURRENCE.moonCloseConjunction
        : RECURRENCE.moonConjunction
      : sepWhenSeen < 0.5
        ? RECURRENCE.closeConjunction
        : RECURRENCE.brightConjunction;

  const interference = interferenceFrom({
    site,
    instant: best.instant,
    targetAltitude: best.altitude,
    targetMagnitude: faintest,
    moonIsTarget: a.isMoon || b.isMoon ? false : undefined,
  });

  const scored = score({
    recurrenceDays: recurrence,
    bestAltitude: best.altitude,
    equipment,
    interference,
    notes: [
      isOccultation
        ? `${capitalise(b.isMoon ? a.name : b.name)} passes behind the Moon's disc.`
        : `Closest approach ${formatAngle(sepDeg)}.`,
      ...(Math.abs(sepWhenSeen - sepDeg) > 1 / 60
        ? [`${formatAngle(sepWhenSeen)} apart by the time the sky is dark enough to look.`]
        : []),
    ],
  });

  if (scored.score <= 0) return null;

  const other = a.isMoon ? b : b.isMoon ? a : null;
  const title = isOccultation
    ? `Moon occults ${other?.name ?? 'a bright star'}`
    : `${capitalise(a.name)} and ${b.name} pass within ${formatAngle(Math.max(sepDeg, sepWhenSeen))}`;

  return {
    id: eventId(isOccultation ? 'occultation' : 'conjunction', `${a.key}-${b.key}`, peak),
    kind: isOccultation ? 'occultation' : 'conjunction',
    title,
    detail: writeDetail(a, b, sepWhenSeen, best.altitude, best.azimuth, isOccultation),
    data: `${formatAngle(sepDeg)} at closest · ${formatAltAz(best.altitude, best.azimuth)} · ${formatDateTime(best.instant, site.timezone)}`,
    // Pin the event to when it can be watched; the closest-approach instant is
    // in the copy for anyone who wants it.
    peak: best.instant,
    window,
    bestAltitude: best.altitude,
    bestAzimuth: best.azimuth,
    equipment,
    score: scored.score,
    components: scored.components,
  };
}

function writeDetail(
  a: Target,
  b: Target,
  sepDeg: number,
  altitude: number,
  azimuth: number,
  isOccultation: boolean,
): string {
  const where =
    altitude < 0
      ? 'but it happens below the horizon from here'
      : altitude < 15
        ? `low in the ${compassPoint(azimuth)}`
        : `${Math.round(altitude)}° up in the ${compassPoint(azimuth)}`;

  if (isOccultation) {
    const star = a.isMoon ? b.name : a.name;
    return `The Moon slides in front of ${star} and hides it — ${where}. Worth watching the moment it reappears on the far limb.`;
  }

  const closeness =
    sepDeg < 0.5
      ? 'close enough to cover with a fingertip'
      : sepDeg < 1.5
        ? 'a thumb-width apart'
        : 'a comfortable pair in binoculars';

  return `${capitalise(a.name)} and ${b.name} sit ${closeness}, ${where}.`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The sampler can find the same approach from two adjacent minima when a pair
 * hangs close for days. Keep the closest.
 */
function dedupe(events: SkyEvent[]): SkyEvent[] {
  const byPair = new Map<string, SkyEvent>();
  for (const e of events) {
    const pair = e.id.split(':')[1];
    const day = Math.floor(e.peak / (24 * HOUR));
    const key = `${pair}@${day}`;
    const existing = byPair.get(key);
    if (!existing || e.score > existing.score) byPair.set(key, e);
  }
  return [...byPair.values()];
}
