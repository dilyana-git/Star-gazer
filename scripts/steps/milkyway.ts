/**
 * Milky Way isophote outlines, for the faint band under the stars (spec §9).
 * Five nested brightness levels; the renderer fills them with increasing opacity.
 */
import { fetchJson } from '../lib/fetch-cache.js';
import { round, unitVector } from '../lib/sphere.js';
import { SOURCES } from '../sources.js';

interface MwFeature {
  id: string;
  geometry: { type: string; coordinates: number[][][] | number[][][][] };
}

/** Minimum angular step between retained outline points, degrees. */
const MIN_STEP_DEG = 0.35;
const COS_MIN_STEP = Math.cos((MIN_STEP_DEG * Math.PI) / 180);

export interface MilkyWayLevel {
  level: number;
  /** Closed rings of J2000 unit vectors, flattened [x,y,z, …]. */
  rings: number[][];
}

export async function buildMilkyWay(): Promise<MilkyWayLevel[]> {
  const mw = await fetchJson<{ features: MwFeature[] }>(SOURCES.milkyway.url);

  return mw.features
    .map((f) => {
      const level = Number.parseInt(f.id.replace(/\D/g, ''), 10) || 1;
      const polygons: number[][][] =
        f.geometry.type === 'MultiPolygon'
          ? (f.geometry.coordinates as number[][][][]).flat()
          : (f.geometry.coordinates as number[][][]);

      const rings = polygons
        .filter((ring) => ring.length >= 3)
        .map((ring) => {
          const flat: number[] = [];
          let last: number[] | null = null;
          for (const [raSigned, dec] of ring) {
            const ra = raSigned < 0 ? raSigned + 360 : raSigned;
            const v = unitVector(ra, dec);
            // The source is sampled far finer than a diffuse band needs. Drop
            // points within MIN_STEP of the previous one — it costs nothing
            // visually and takes the artifact from ~750 kB to under 200.
            if (last) {
              const dot = last[0] * v[0] + last[1] * v[1] + last[2] * v[2];
              if (dot > COS_MIN_STEP) continue;
            }
            last = v;
            flat.push(round(v[0], 4), round(v[1], 4), round(v[2], 4));
          }
          return flat;
        })
        .filter((flat) => flat.length >= 9);

      return { level, rings };
    })
    .sort((a, b) => a.level - b.level);
}
