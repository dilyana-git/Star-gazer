/**
 * Planets: greatest elongations, oppositions, and plain "well placed" windows
 * (spec §7.3).
 *
 * The last of those is the one that earns its keep. Most nights there is no
 * eclipse and no occultation, but there is very often a bright planet sitting
 * high in a dark sky, and that is a reason to go outside.
 */
import * as A from 'astronomy-engine';
import { compassPoint } from '../frames';
import { formatDateTime, DAY } from '../time';
import type { Instant, Site } from '../types';
import type { Detector, SkyEvent } from './types';
import { interferenceFrom, RECURRENCE, score } from './scoring';
import { bestMoment, bestObservableMoment, eventId, formatAltAz, nightsBetween, positionOf } from './common';

const INNER = [A.Body.Mercury, A.Body.Venus];
const OUTER = [A.Body.Mars, A.Body.Jupiter, A.Body.Saturn, A.Body.Uranus, A.Body.Neptune];

export const detectElongations: Detector = ({ site, from, to }) => {
  return [
    ...greatestElongations(site, from, to),
    ...oppositions(site, from, to),
    ...wellPlaced(site, from, to),
  ];
};

function greatestElongations(site: Site, from: Instant, to: Instant): SkyEvent[] {
  const events: SkyEvent[] = [];

  for (const body of INNER) {
    let e = A.SearchMaxElongation(body, new Date(from - 30 * DAY));
    for (let guard = 0; guard < 8; guard++) {
      const peak = e.time.date.getTime();
      if (peak > to) break;
      if (peak >= from) {
        const event = elongationEvent(site, body, e);
        if (event) events.push(event);
      }
      e = A.SearchMaxElongation(body, e.time.AddDays(1));
    }
  }
  return events;
}

function elongationEvent(site: Site, body: A.Body, e: A.ElongationEvent): SkyEvent | null {
  const peak = e.time.date.getTime();
  const evening = e.visibility === 'evening';

  // Best seen in the twilight either side of the Sun, so the useful window is
  // the couple of hours after sunset or before sunrise on that date.
  // Greatest elongation is a geometric instant, and it lands wherever it lands
  // — very often at nine in the morning. What the reader needs is the twilight
  // on the correct side of it, which can be most of a day away, so the bracket
  // reaches twenty hours in that direction and lets the search find the dusk.
  const REACH = 20 * 3_600_000;
  const bracket: [Instant, Instant] = evening ? [peak, peak + REACH] : [peak - REACH, peak];
  const { moment: best, window, observable } = bestObservableMoment(
    site,
    positionOf(body, site),
    bracket[0],
    bracket[1],
  );
  // Mercury and Venus at elongation are twilight objects. If there is no
  // twilight moment with the planet above the horizon, there is no event here.
  if (!observable) return null;
  const illum = A.Illumination(body, e.time);

  const interference = interferenceFrom({
    site,
    instant: best.instant,
    targetAltitude: best.altitude,
    targetMagnitude: illum.mag,
  });

  const scored = score({
    recurrenceDays: body === A.Body.Mercury ? RECURRENCE.mercuryElongation : RECURRENCE.venusElongation,
    bestAltitude: best.altitude,
    equipment: body === A.Body.Mercury ? 'binocular' : 'naked-eye',
    interference,
    notes: [
      `${e.elongation.toFixed(1)}° from the Sun — as far from it as this apparition gets.`,
      `Magnitude ${illum.mag.toFixed(1)}, ${Math.round(illum.phase_fraction * 100)}% lit.`,
    ],
  });

  if (scored.score <= 0) return null;

  return {
    id: eventId('elongation', body, peak),
    kind: 'elongation',
    title: `${body} at greatest ${evening ? 'evening' : 'morning'} elongation`,
    detail:
      body === A.Body.Mercury
        ? `Mercury's best showing of this apparition — ${e.elongation.toFixed(0)}° from the Sun, low in the ${compassPoint(best.azimuth)} ${evening ? 'after sunset' : 'before dawn'}. It is the planet most people have never knowingly seen; this is the fortnight to fix that.`
        : `Venus stands ${e.elongation.toFixed(0)}° from the Sun, ${Math.round(best.altitude)}° up in the ${compassPoint(best.azimuth)} ${evening ? 'after sunset' : 'before dawn'}. In binoculars it shows a distinct half-disc.`,
    data: `${e.elongation.toFixed(1)}° elongation · mag ${illum.mag.toFixed(1)} · ${formatAltAz(best.altitude, best.azimuth)} · best ${formatDateTime(best.instant, site.timezone)}`,
    peak: best.instant,
    window,
    bestAltitude: best.altitude,
    bestAzimuth: best.azimuth,
    equipment: body === A.Body.Mercury ? 'binocular' : 'naked-eye',
    score: scored.score,
    components: scored.components,
  };
}

function oppositions(site: Site, from: Instant, to: Instant): SkyEvent[] {
  const events: SkyEvent[] = [];

  for (const body of OUTER) {
    let cursor = new Date(from - 30 * DAY);
    for (let guard = 0; guard < 6; guard++) {
      // Opposition is relative ecliptic longitude 180° from the Sun as seen
      // from Earth — which this function finds directly.
      const t = A.SearchRelativeLongitude(body, 0, cursor);
      const peak = t.date.getTime();
      if (peak > to) break;
      if (peak >= from) {
        const event = oppositionEvent(site, body, peak);
        if (event) events.push(event);
      }
      cursor = t.AddDays(30).date;
    }
  }
  return events;
}

function oppositionEvent(site: Site, body: A.Body, peak: Instant): SkyEvent | null {
  // At opposition the planet transits around local midnight, so look either
  // side of it for the highest point.
  const { moment: best, window, observable } = bestObservableMoment(
    site,
    positionOf(body, site),
    peak - 12 * 3_600_000,
    peak + 12 * 3_600_000,
  );
  if (!observable) return null;
  const illum = A.Illumination(body, new Date(peak));

  const recurrence =
    body === A.Body.Mars
      ? RECURRENCE.marsOpposition
      : body === A.Body.Jupiter
        ? RECURRENCE.jupiterOpposition
        : body === A.Body.Saturn
          ? RECURRENCE.saturnOpposition
          : RECURRENCE.outerOpposition;

  const equipment = illum.mag > 5.5 ? 'telescope' : illum.mag > 4 ? 'binocular' : 'naked-eye';

  const interference = interferenceFrom({
    site,
    instant: best.instant,
    targetAltitude: best.altitude,
    targetMagnitude: illum.mag,
  });

  const scored = score({
    recurrenceDays: recurrence,
    bestAltitude: best.altitude,
    equipment,
    interference,
    notes: [
      `Opposite the Sun, so it rises at sunset and sets at sunrise — up all night.`,
      `Magnitude ${illum.mag.toFixed(1)} at ${illum.geo_dist.toFixed(2)} AU, the closest and brightest of this cycle.`,
    ],
  });

  if (scored.score <= 0) return null;

  return {
    id: eventId('opposition', body, peak),
    kind: 'opposition',
    title: `${body} at opposition`,
    detail: `${body} is closest to Earth for this cycle and up all night, reaching ${Math.round(best.altitude)}° in the ${compassPoint(best.azimuth)} around midnight. ${detailFor(body)}`,
    data: `mag ${illum.mag.toFixed(1)} · ${illum.geo_dist.toFixed(2)} AU · ${formatAltAz(best.altitude, best.azimuth)} · highest ${formatDateTime(best.instant, site.timezone)}`,
    peak: best.instant,
    window,
    bestAltitude: best.altitude,
    bestAzimuth: best.azimuth,
    equipment,
    score: scored.score,
    components: scored.components,
  };
}

function detailFor(body: A.Body): string {
  switch (body) {
    case A.Body.Jupiter:
      return 'Steady binoculars will show the four Galilean moons strung out either side of it.';
    case A.Body.Saturn:
      return 'The rings need a telescope, but even at low power they are unmistakable.';
    case A.Body.Mars:
      return 'The colour is obvious to the naked eye; surface detail needs good seeing and patience.';
    default:
      return 'Faint enough to need optical help, but this is the easiest it gets all year.';
  }
}

/**
 * Plain "this planet is well placed tonight": above 20° during darkness and
 * brighter than magnitude 2. Low-scoring by construction — it is context, not
 * an alarm — but it is the answer on most ordinary nights.
 */
function wellPlaced(site: Site, from: Instant, to: Instant): SkyEvent[] {
  const events: SkyEvent[] = [];
  const nights = nightsBetween(site, from, to);

  for (const night of nights) {
    const observing = night.astronomicalNight[0] ?? night.darkWindows[0];
    if (!observing) continue;

    for (const body of [...INNER, ...OUTER]) {
      const illum = A.Illumination(body, new Date(observing[0]));
      if (illum.mag > 2) continue;

      const best = bestMoment(site, observing[0], observing[1], positionOf(body, site));
      if (best.altitude < 20) continue;

      const interference = interferenceFrom({
        site,
        instant: best.instant,
        targetAltitude: best.altitude,
        targetMagnitude: illum.mag,
      });

      const scored = score({
        recurrenceDays: RECURRENCE.daily * 3,
        bestAltitude: best.altitude,
        equipment: 'naked-eye',
        interference,
        notes: [`Magnitude ${illum.mag.toFixed(1)}, ${Math.round(best.altitude)}° up during darkness.`],
      });

      if (scored.score <= 0) continue;

      events.push({
        id: eventId('planet-well-placed', body, observing[0]),
        kind: 'planet-well-placed',
        title: `${body} well placed`,
        detail: `${body} sits ${Math.round(best.altitude)}° up in the ${compassPoint(best.azimuth)} while the sky is properly dark — bright, steady, and easy to find.`,
        data: `mag ${illum.mag.toFixed(1)} · ${formatAltAz(best.altitude, best.azimuth)} · best ${formatDateTime(best.instant, site.timezone)}`,
        peak: best.instant,
        window: observing,
        bestAltitude: best.altitude,
        bestAzimuth: best.azimuth,
        equipment: 'naked-eye',
        score: scored.score,
        components: scored.components,
      });
    }
  }

  // Per night, deliberately — see the note in dso.ts. Collapsing the repeats
  // belongs to the panel, which knows which night is on screen.
  return events;
}
