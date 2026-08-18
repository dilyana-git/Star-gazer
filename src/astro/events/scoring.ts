/**
 * Scoring (spec §7.2).
 *
 *   score = rarity × visibility × interference × accessibility
 *
 * Every factor is exposed on the event's `components`, because the UI has to be
 * able to explain why something scored 72 — and a scoring model you cannot
 * inspect is a scoring model you cannot tune.
 */
import * as A from 'astronomy-engine';
import { bodyAltAz } from '../frames';
import { darkness } from '../twilight';
import type { Instant, Site } from '../types';
import type { Equipment, ScoreBreakdown } from './types';

/** Typical recurrence intervals, in days. The rarity axis reads off these. */
export const RECURRENCE = {
  daily: 1,
  lunarPhase: 29.53,
  showerPeak: 365.25,
  jupiterOpposition: 398.9,
  saturnOpposition: 378.1,
  marsOpposition: 780,
  outerOpposition: 369,
  mercuryElongation: 115.9,
  venusElongation: 584,
  brightConjunction: 5 * 365.25,
  closeConjunction: 12 * 365.25,
  /**
   * The Moon laps the whole zodiac every month, so it passes each planet and
   * each bright ecliptic star once a lunation. Scoring those against the
   * planet-planet interval would put a routine monthly pairing above the
   * Geminids.
   */
  moonConjunction: 27.3,
  moonCloseConjunction: 2 * 365.25,
  occultationBrightStar: 8 * 365.25,
  lunarEclipseLocal: 2.5 * 365.25,
  solarEclipsePartialLocal: 3 * 365.25,
  solarEclipseTotalLocal: 375 * 365.25,
  /**
   * "Supermoon" by the usual definition (a full moon within about 90% of
   * perigee) happens three or four times a year, not once — and the difference
   * from an ordinary full moon is 7% of diameter. Spec §7.3 is explicit that
   * lunar events are context rather than alarms, and this is the number that
   * keeps one below a major shower.
   */
  supermoon: 100,
  dsoTransit: 1,

  /**
   * Shower peaks, graded by what they actually deliver.
   *
   * Rarity asks how often an event *of this notability* comes round. Any given
   * shower peaks annually, but "a display worth setting an alarm for" is not an
   * annual event and "a handful of meteors an hour" is not a yearly one either
   * — there are a score of those every year. Without this grading a ZHR-5
   * shower scores level with the Geminids.
   */
  majorShower: 365.25,
  goodShower: 120,
  modestShower: 45,
  minorShower: 18,
} as const;

/** Recurrence interval for a shower peak delivering `rate` meteors an hour. */
export function showerRecurrence(observedRatePerHour: number): number {
  if (observedRatePerHour >= 40) return RECURRENCE.majorShower;
  if (observedRatePerHour >= 15) return RECURRENCE.goodShower;
  if (observedRatePerHour >= 5) return RECURRENCE.modestShower;
  return RECURRENCE.minorShower;
}

export function rarityFrom(recurrenceDays: number): number {
  return clamp(20 * Math.log10(Math.max(1, recurrenceDays)), 0, 100);
}

export const ACCESSIBILITY: Record<Equipment, number> = {
  'naked-eye': 1.0,
  binocular: 0.75,
  telescope: 0.5,
};

/**
 * Visibility from the best altitude reached during the window.
 *
 * Zero if the target never clears 10°: airmass makes a 5° object dramatically
 * worse than a 45° one, and below 10° the atmosphere has effectively taken it.
 * Above that it is sin(altitude) with a floor, so a low-but-real event still
 * registers instead of vanishing.
 */
export function visibilityFrom(bestAltitude: number): number {
  if (bestAltitude < 10) return 0;
  return Math.max(0.15, Math.sin((bestAltitude * Math.PI) / 180));
}

export interface InterferenceInput {
  site: Site;
  /** When the event peaks. */
  instant: Instant;
  /** Altitude of the target at its best moment, degrees. */
  targetAltitude: number;
  /**
   * How faint the thing being looked at is, as a magnitude. Used to weight the
   * penalties: a full moon ruins a meteor shower and does nothing to Jupiter.
   */
  targetMagnitude: number;
  /** True when the Moon *is* the target — a lunar eclipse takes no moon penalty. */
  moonIsTarget?: boolean;
}

export interface InterferenceResult {
  value: number;
  notes: string[];
}

/**
 * Moonlight and twilight, weighted by how faint the target is.
 *
 * Full penalty for a meteor shower under a full moon; near zero for a lunar
 * eclipse, where the Moon is the point.
 */
export function interferenceFrom(input: InterferenceInput): InterferenceResult {
  const { site, instant, targetMagnitude, moonIsTarget } = input;
  const notes: string[] = [];

  // How much this target cares about sky brightness. Magnitude −4 (Venus) is
  // untroubled; magnitude 5 and fainter is at the mercy of it.
  const sensitivity = clamp((targetMagnitude + 2) / 7, 0, 1);

  const dark = darkness(site, instant);
  const sunUp = bodyAltAz(A.Body.Sun, instant, site).altitude > 0;

  // Twilight is graded by how much the target cares. Actual daylight is not:
  // with the Sun above the horizon almost nothing is findable, and a model that
  // says a magnitude-0 planet is 70% as good at noon as at midnight is a model
  // that will happily recommend it. The floor of 0.6 is what stops that.
  const twilightLoss = sunUp
    ? clamp(0.6 + 0.4 * sensitivity, 0, 1)
    : (1 - dark) * sensitivity;

  if (twilightLoss > 0.12) {
    notes.push(
      sunUp
        ? 'The Sun is up at this moment — this is a daylight event from here.'
        : dark < 0.35
          ? 'Bright twilight is washing it out.'
          : 'Twilight is still brightening the sky.',
    );
  }

  let moonLoss = 0;
  if (!moonIsTarget) {
    const moon = bodyAltAz(A.Body.Moon, instant, site);
    if (moon.altitude > 0) {
      const illumination = A.Illumination(A.Body.Moon, new Date(instant)).phase_fraction;
      // Height matters as much as phase: a full moon at 5° lights far less sky
      // than the same moon at 60°.
      const height = Math.sin((moon.altitude * Math.PI) / 180);
      moonLoss = illumination * height * sensitivity;
      if (moonLoss > 0.12) {
        notes.push(
          `The Moon is ${Math.round(illumination * 100)}% lit and ${Math.round(moon.altitude)}° up.`,
        );
      }
    }
  } else {
    notes.push('The Moon is the target, so moonlight costs nothing.');
  }

  const value = clamp(1 - twilightLoss - moonLoss, 0, 1);
  if (value > 0.9 && notes.length === 0) notes.push('Dark sky, no interference.');

  return { value, notes };
}

export interface ScoreInput {
  recurrenceDays: number;
  bestAltitude: number;
  equipment: Equipment;
  interference: InterferenceResult;
  /** Extra explanation to surface above the computed notes. */
  notes?: string[];
}

export interface Scored {
  score: number;
  components: ScoreBreakdown;
}

export function score(input: ScoreInput): Scored {
  const rarity = rarityFrom(input.recurrenceDays);
  const visibility = visibilityFrom(input.bestAltitude);
  const accessibility = ACCESSIBILITY[input.equipment];
  const value = rarity * visibility * input.interference.value * accessibility;

  const notes = [...(input.notes ?? []), ...input.interference.notes];
  if (visibility === 0) {
    notes.unshift(
      input.bestAltitude <= 0
        ? 'Below the horizon from here for the whole event.'
        : `Never gets above ${Math.round(input.bestAltitude)}° — too low to be worth it.`,
    );
  }

  return {
    score: Math.round(clamp(value, 0, 100)),
    components: {
      rarity: Math.round(rarity),
      recurrenceDays: input.recurrenceDays,
      visibility: round2(visibility),
      interference: round2(input.interference.value),
      accessibility,
      notes,
    },
  };
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Human phrasing for a recurrence interval, for the breakdown panel. */
export function describeRecurrence(days: number): string {
  if (days <= 1.5) return 'happens every night';
  if (days < 45) return `about every ${Math.round(days)} days`;
  if (days < 500) return `about once a year`;
  const years = days / 365.25;
  if (years < 20) return `roughly every ${years.toFixed(years < 5 ? 1 : 0)} years`;
  return `roughly every ${Math.round(years)} years from one place`;
}
