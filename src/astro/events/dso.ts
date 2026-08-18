/**
 * Deep sky objects worth going out for tonight (spec §7.3).
 *
 * Objects that transit during the dark window above 30°, with a magnitude
 * within reach of this site's sky. This is what turns a light-polluted Tuesday
 * into "you can still get M31 and the Double Cluster".
 *
 * Angular size matters as much as magnitude, which is why the catalogue carries
 * it: a magnitude-8 galaxy spread over 20 arcminutes has its light smeared over
 * four hundred times the area of a magnitude-8 point source, and is far harder.
 */
import { compassPoint } from '../frames';
import { limitingMagnitude } from '../twilight';
import { formatDateTime } from '../time';
import type { Vec3 } from '../types';
import type { Detector, Equipment, SkyEvent } from './types';
import { interferenceFrom, RECURRENCE, score } from './scoring';
import { bestMoment, eventId, formatAltAz, nightsBetween } from './common';
import dsoData from '../../data/generated/dsos.json';
import type { Dso } from '../../data/catalog';

const DSOS = dsoData as Dso[];

/** Only ever show a handful; the panel is a recommendation, not a catalogue. */
const PER_NIGHT = 4;
const MINIMUM_ALTITUDE = 30;

export const detectDsos: Detector = ({ site, from, to }) => {
  const events: SkyEvent[] = [];

  for (const night of nightsBetween(site, from, to)) {
    const window = night.darkWindows[0] ?? night.astronomicalNight[0];
    if (!window) continue;

    const midpoint = window[0] + (window[1] - window[0]) / 2;
    const lm = limitingMagnitude(site, midpoint);

    const candidates: Array<{ dso: Dso; event: SkyEvent }> = [];

    for (const dso of DSOS) {
      // Extended objects are seen against the sky background, so surface
      // brightness is the honest gate. Point-like ones go by magnitude.
      if (!withinReach(dso, lm)) continue;

      const vector: Vec3 = [dso.x, dso.y, dso.z];
      const best = bestMoment(site, window[0], window[1], () => vector);
      if (best.altitude < MINIMUM_ALTITUDE) continue;

      const equipment = equipmentFor(dso, lm);
      const interference = interferenceFrom({
        site,
        instant: best.instant,
        targetAltitude: best.altitude,
        targetMagnitude: dso.mag,
      });

      const scored = score({
        recurrenceDays: RECURRENCE.dsoTransit,
        bestAltitude: best.altitude,
        equipment,
        interference,
        notes: [
          `Magnitude ${dso.mag.toFixed(1)} against a sky reaching magnitude ${lm.toFixed(1)} tonight.`,
          dso.size > 0 ? `${formatSize(dso.size)} across.` : 'Effectively a point source.',
        ],
      });

      // Rarity is 0 for something that transits every night, so the raw score
      // is 0 too. That is right for the ranking axis but wrong for the list:
      // these are the fallback recommendations, so they get a small floor
      // proportional to how good the view actually is.
      const floor = Math.round(
        6 * (interference.value * scored.components.visibility * scored.components.accessibility) +
          Math.max(0, 6 - dso.mag),
      );
      const finalScore = Math.max(scored.score, floor);
      if (finalScore <= 0) continue;

      candidates.push({
        dso,
        event: {
          id: eventId('dso', dso.id, window[0]),
          kind: 'dso',
          title: dso.name ? `${dso.name} is well placed` : `${dso.id} is well placed`,
          detail: writeDetail(dso, best.altitude, best.azimuth, equipment),
          data: `${dso.id}${dso.ngc !== dso.id ? ` · ${dso.ngc}` : ''} · mag ${dso.mag.toFixed(1)}${
            dso.size ? ` · ${formatSize(dso.size)}` : ''
          } · ${formatAltAz(best.altitude, best.azimuth)} · ${formatDateTime(best.instant, site.timezone)}`,
          peak: best.instant,
          window,
          bestAltitude: best.altitude,
          bestAzimuth: best.azimuth,
          equipment,
          score: finalScore,
          components: { ...scored.components, notes: scored.components.notes },
        },
      });
    }

    // Brightest first, and only a few: a list of ninety galaxies is a catalogue,
    // not a recommendation.
    candidates.sort((a, b) => a.dso.mag - b.dso.mag);
    events.push(...candidates.slice(0, PER_NIGHT).map((c) => c.event));
  }

  // One entry per object per night, deliberately. The Pleiades really are well
  // placed on every clear night in autumn, and tonight's panel needs to say so
  // for *tonight*. Collapsing the repeats is the events panel's job, because
  // only the panel knows which night the reader is looking at.
  return events;
};

/**
 * Whether an object is realistically within reach. Extended objects are judged
 * on surface brightness against the sky, point-like ones on magnitude, and both
 * get the ~1.5 magnitudes that averted vision and binoculars buy.
 */
function withinReach(dso: Dso, limitingMag: number): boolean {
  const reach = limitingMag + 1.5;
  if (dso.mag > reach) return false;

  if (dso.size >= 10 && dso.sb > 0) {
    // Surface brightness in mag/arcsec² against a rough sky brightness implied
    // by the limiting magnitude. A dark site reaches about 21.8; each magnitude
    // of naked-eye limit is worth roughly two of sky background.
    const skyBrightness = 15.5 + limitingMag * 0.85;
    return dso.sb < skyBrightness + 2.5;
  }
  return true;
}

function equipmentFor(dso: Dso, limitingMag: number): Equipment {
  if (dso.mag <= limitingMag - 1.5) return 'naked-eye';
  if (dso.mag <= limitingMag + 1.5) return 'binocular';
  return 'telescope';
}

function writeDetail(dso: Dso, altitude: number, azimuth: number, equipment: Equipment): string {
  const where = `${Math.round(altitude)}° up in the ${compassPoint(azimuth)}`;

  // Phrased around the object rather than about it, so the sentence works
  // whether the name is singular ("the Ring Nebula"), plural ("the Pleiades")
  // or a catalogue number ("NGC 869").
  const how =
    equipment === 'naked-eye'
      ? `Findable with the naked eye if you know where to look, ${where}.`
      : equipment === 'binocular'
        ? `An easy binocular target, ${where}.`
        : `Needs a telescope from a sky this bright, ${where}.`;

  return `${how} ${describeType(dso)}`;
}

/** A sentence about what the thing actually is. Always a complete one. */
function describeType(dso: Dso): string {
  if (dso.type.includes('galaxy')) return 'Another galaxy entirely, its light older than our species.';
  if (dso.type.includes('globular')) return 'A ball of several hundred thousand ancient stars, bound together since the galaxy was young.';
  if (dso.type.includes('open cluster')) return 'A loose group of young stars, all born together and still drifting apart.';
  if (dso.type.includes('planetary')) return 'The blown-off shell of a dying star, lit from within.';
  if (dso.type.includes('supernova')) return 'The wreckage of a star that exploded.';
  if (dso.type.includes('nebulosity')) return 'A cluster of young stars still wrapped in the gas that made them.';
  if (dso.type.includes('nebula')) return 'A cloud of gas and dust, lit by the stars inside it.';
  if (dso.type.includes('HII')) return 'A vast cloud of glowing hydrogen, lit from within by hot young stars.';
  if (dso.type.includes('association')) return 'A sprawling association of stars sharing a common origin.';
  if (dso.type.includes('asterism')) return 'A chance alignment rather than a true group — but a memorable shape.';
  return `Catalogued as ${dso.type === 'HII region' ? 'an' : 'a'} ${dso.type}.`;
}

function formatSize(arcmin: number): string {
  return arcmin >= 60 ? `${(arcmin / 60).toFixed(1)}°` : `${arcmin.toFixed(0)}′`;
}

export type { Dso };
export { MINIMUM_ALTITUDE };
