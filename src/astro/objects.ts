/**
 * A thing in the sky you can select, however you came to select it.
 *
 * Tapping the chart and searching by name have to arrive at the same place, so
 * they produce the same shape. The renderer adds canvas coordinates to it for
 * hit-testing (`PickTarget`); the search resolves a catalogue entry to it by
 * computing the position for the current site and instant.
 */
import * as A from 'astronomy-engine';
import { altAzFromHorVector, bodyVectorEqj, rotate, rotationEqjToHor } from './frames';
import type { Instant, Site, Vec3 } from './types';

export type ObjectKind = 'star' | 'planet' | 'moon' | 'sun' | 'dso' | 'constellation';

export interface SkyObject {
  kind: ObjectKind;
  name: string;
  /** One line of plain language about what it is. */
  detail: string;
  /** Where it is now, from this site. Degrees. */
  altitude: number;
  azimuth: number;
  /** Index into the packed star catalogue, for stars. */
  index?: number;
}

export const KIND_LABEL: Record<ObjectKind, string> = {
  star: 'Star',
  planet: 'Planet',
  moon: 'Moon',
  sun: 'Sun',
  dso: 'Deep sky object',
  constellation: 'Constellation',
};

/** Alt/az of a J2000 unit vector, for one site and instant. */
export function altAzOfVector(site: Site, instant: Instant, v: Vec3): { altitude: number; azimuth: number } {
  const [x, y, z] = rotate(rotationEqjToHor(site, instant), v);
  return altAzFromHorVector(x, y, z);
}

/** Alt/az of a solar-system body. */
export function altAzOfBody(site: Site, instant: Instant, body: A.Body): { altitude: number; azimuth: number } {
  return altAzOfVector(site, instant, bodyVectorEqj(body, instant, site));
}

/** The planets the app draws, in the order it draws them. */
export const PLANET_NAMES: Array<[A.Body, string]> = [
  [A.Body.Mercury, 'Mercury'],
  [A.Body.Venus, 'Venus'],
  [A.Body.Mars, 'Mars'],
  [A.Body.Jupiter, 'Jupiter'],
  [A.Body.Saturn, 'Saturn'],
  [A.Body.Uranus, 'Uranus'],
  [A.Body.Neptune, 'Neptune'],
];

/** A sentence about a planet, with its magnitude and distance right now. */
export function describePlanet(body: A.Body, instant: Instant): string {
  const illum = A.Illumination(body, new Date(instant));
  return `Magnitude ${illum.mag.toFixed(1)} — ${illum.geo_dist.toFixed(2)} AU away`;
}
