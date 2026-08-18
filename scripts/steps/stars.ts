/**
 * Star catalogue reduction.
 *
 * Emits two artifacts (spec §3.1):
 *   stars.bin       packed Float32Array of [x, y, z, mag, ci] per star, J2000 unit
 *                   vectors precomputed. Sorted brightest-first so the load
 *                   animation can reveal a prefix of the array (§10, motion).
 *   stars.meta.json names / Bayer / Flamsteed / constellation for the stars that
 *                   have any, keyed by array index. Loaded lazily.
 */
import { fetchJson } from '../lib/fetch-cache.js';
import { round, unitVector } from '../lib/sphere.js';
import { SOURCES } from '../sources.js';

export const MAG_LIMIT = 6.5;
export const STAR_STRIDE = 5; // x, y, z, mag, ci

interface StarFeature {
  id: number; // Hipparcos number
  properties: { mag: number; bv: string };
  geometry: { coordinates: [number, number] }; // [RA°, Dec°], RA in −180..180
}

interface NameRecord {
  name?: string;
  bayer?: string;
  flam?: string;
  desig?: string;
  c?: string;
}

export interface StarsResult {
  bin: Buffer;
  meta: unknown;
  count: number;
  magMin: number;
  magMax: number;
  /** hip → index into the packed array, for the constellation-line join. */
  hipIndex: Map<number, number>;
  /** hip → J2000 unit vector, for constellation lines and named-star lookups. */
  hipVector: Map<number, [number, number, number]>;
  named: number;
}

export async function buildStars(): Promise<StarsResult> {
  const stars = await fetchJson<{ features: StarFeature[] }>(SOURCES.stars.url);
  const names = await fetchJson<Record<string, NameRecord>>(SOURCES.starNames.url);

  const kept = stars.features
    .filter((f) => Number.isFinite(f.properties.mag) && f.properties.mag <= MAG_LIMIT)
    .sort((a, b) => a.properties.mag - b.properties.mag);

  const buf = Buffer.alloc(kept.length * STAR_STRIDE * 4);
  const view = new Float32Array(buf.buffer, buf.byteOffset, kept.length * STAR_STRIDE);

  const hipIndex = new Map<number, number>();
  const hipVector = new Map<number, [number, number, number]>();
  const meta: Record<string, Record<string, string>> = {};

  kept.forEach((f, i) => {
    const [raSigned, dec] = f.geometry.coordinates;
    const ra = raSigned < 0 ? raSigned + 360 : raSigned;
    const v = unitVector(ra, dec);
    const bv = Number.parseFloat(f.properties.bv);

    const o = i * STAR_STRIDE;
    view[o] = v[0];
    view[o + 1] = v[1];
    view[o + 2] = v[2];
    view[o + 3] = f.properties.mag;
    view[o + 4] = Number.isFinite(bv) ? bv : 0.0;

    hipIndex.set(f.id, i);
    hipVector.set(f.id, [round(v[0], 7), round(v[1], 7), round(v[2], 7)]);

    const n = names[String(f.id)];
    if (!n) return;
    const entry: Record<string, string> = {};
    if (n.name) entry.n = n.name;
    if (n.bayer) entry.b = n.bayer;
    if (n.flam) entry.f = n.flam;
    if (n.c) entry.c = n.c;
    entry.h = String(f.id);
    if (entry.n || entry.b || entry.f) meta[String(i)] = entry;
  });

  const mags = kept.map((f) => f.properties.mag);

  return {
    bin: buf,
    meta,
    count: kept.length,
    magMin: Math.min(...mags),
    magMax: Math.max(...mags),
    hipIndex,
    hipVector,
    named: Object.keys(meta).length,
  };
}
