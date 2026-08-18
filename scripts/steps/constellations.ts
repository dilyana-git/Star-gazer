/**
 * Constellation line figures and IAU boundaries.
 *
 * Lines (spec §3.2): Stellarium's skyculture index.json gives each figure as
 * chains of Hipparcos ids. We join them against the star catalogue at build time
 * and emit unit vectors, so the renderer never has to look a star up by id.
 * Line figures only — no artwork, per the licensing note in the spec.
 *
 * Boundaries (spec §3.3): the same file carries the IAU edges (Delporte via
 * P. Barbier), and they are given for epoch B1875 — Delporte drew them along
 * B1875 coordinate lines. Each edge is therefore a segment of constant RA
 * ("meridian") or constant declination ("parallel") *in the B1875 frame*, which
 * is a curve once precessed. We subdivide each edge in its own frame and precess
 * every sample point to J2000. Skipping this leaves Orion's boundary about 1.5°
 * off its stars.
 */
import * as A from 'astronomy-engine';
import { fetchJson } from '../lib/fetch-cache.js';
import { normalize, parseDecDms, parseRaHms, round, unitVector, type Vec3 } from '../lib/sphere.js';
import { SOURCES } from '../sources.js';

/**
 * B1875.0 as UT days since J2000 (the time argument astronomy-engine wants).
 * Besselian epoch B1875.0 = JD 2405889.25855; J2000.0 = JD 2451545.0.
 */
const B1875_UT = 2405889.25855 - 2451545.0;

/** Max angular step when subdividing a boundary edge, degrees. */
const EDGE_STEP_DEG = 2;

interface SkycultureFile {
  id: string;
  constellations: Array<{
    id: string; // "CON modern Aql"
    lines: number[][]; // chains of HIP ids
    common_name?: { english?: string; native?: string };
  }>;
  edges_epoch?: string;
  edges?: string[];
}

export interface ConstellationOut {
  /** IAU three-letter abbreviation, e.g. "Ori". */
  id: string;
  /** English name shown on the chart. */
  name: string;
  /** Latin/native name, for the detail card. */
  native: string;
  /** Polylines of J2000 unit vectors, flattened [x,y,z, x,y,z, …]. */
  lines: number[][];
  /** Centroid of the line figure (normalised), where the label wants to sit. */
  labelAt: Vec3;
  /** Angular radius of the figure about its centroid, degrees — a label is only
   *  drawn when the figure is big enough on screen (spec §8.4). */
  extent: number;
}

export interface BoundaryOut {
  /** The two constellations this edge separates. */
  between: [string, string];
  /** Flattened J2000 unit vectors. */
  v: number[];
}

export interface ConstellationsResult {
  skyculture: string;
  constellations: ConstellationOut[];
  boundaries: BoundaryOut[];
  droppedHips: number[];
  /** Mean precession applied to boundaries, degrees — asserted in tests. */
  boundaryShiftDeg: number;
}

export async function buildConstellations(
  skycultureId: string,
  hipVector: Map<number, Vec3>,
): Promise<ConstellationsResult> {
  const sc = await fetchJson<SkycultureFile>(SOURCES.skyculture.url(skycultureId));

  const dropped = new Set<number>();
  const constellations: ConstellationOut[] = [];

  for (const c of sc.constellations) {
    const abbr = c.id.split(' ').pop() ?? c.id;
    const lines: number[][] = [];
    const verts: Vec3[] = [];

    for (const chain of c.lines) {
      const flat: number[] = [];
      for (const hip of chain) {
        const v = hipVector.get(hip);
        if (!v) {
          // A figure vertex fainter than our magnitude cut: break the polyline
          // here rather than drawing a segment to nowhere.
          dropped.add(hip);
          if (flat.length >= 6) lines.push(flat.slice());
          flat.length = 0;
          continue;
        }
        flat.push(v[0], v[1], v[2]);
        verts.push(v);
      }
      if (flat.length >= 6) lines.push(flat);
    }

    if (lines.length === 0) continue;

    const centroid = normalize(
      verts.reduce<Vec3>((a, v) => [a[0] + v[0], a[1] + v[1], a[2] + v[2]], [0, 0, 0]),
    );
    const extent = Math.max(
      ...verts.map((v) => {
        const dot = Math.min(1, Math.max(-1, v[0] * centroid[0] + v[1] * centroid[1] + v[2] * centroid[2]));
        return (Math.acos(dot) * 180) / Math.PI;
      }),
    );

    constellations.push({
      id: abbr,
      name: c.common_name?.english ?? abbr,
      native: c.common_name?.native ?? c.common_name?.english ?? abbr,
      lines,
      labelAt: centroid.map((n) => round(n, 6)) as Vec3,
      extent: round(extent, 2),
    });
  }

  const { boundaries, shift } = buildBoundaries(sc);

  return {
    skyculture: sc.id,
    constellations: constellations.sort((a, b) => a.id.localeCompare(b.id)),
    boundaries,
    droppedHips: [...dropped].sort((a, b) => a - b),
    boundaryShiftDeg: shift,
  };
}

function buildBoundaries(sc: SkycultureFile): { boundaries: BoundaryOut[]; shift: number } {
  if (!sc.edges?.length) return { boundaries: [], shift: 0 };
  if (sc.edges_epoch && sc.edges_epoch !== 'B1875') {
    throw new Error(`Unexpected boundary epoch ${sc.edges_epoch}; precession assumes B1875.`);
  }

  // Rotation from the equator/equinox of B1875 to J2000. (This is the *true*
  // equator of date, so it carries B1875 nutation too — under 20 arcseconds,
  // far below the arcminute tier this app targets.)
  const rot = A.Rotation_EQD_EQJ(new A.AstroTime(B1875_UT));
  const t = new A.AstroTime(B1875_UT);

  const precess = (raDeg: number, decDeg: number): Vec3 => {
    const [x, y, z] = unitVector(raDeg, decDeg);
    const out = A.RotateVector(rot, new A.Vector(x, y, z, t));
    return [out.x, out.y, out.z];
  };

  const boundaries: BoundaryOut[] = [];
  let shiftSum = 0;
  let shiftN = 0;

  for (const raw of sc.edges) {
    const parts = raw.trim().split(/\s+/);
    if (parts.length < 8) continue;
    const [, , ra1s, dec1s, ra2s, dec2s, conA, conB] = parts;

    const ra1 = parseRaHms(ra1s);
    const ra2 = parseRaHms(ra2s);
    const dec1 = parseDecDms(dec1s);
    const dec2 = parseDecDms(dec2s);

    // Shortest way round in RA, so an edge crossing 0h does not wrap the sky.
    let dRa = ra2 - ra1;
    if (dRa > 180) dRa -= 360;
    if (dRa < -180) dRa += 360;
    const dDec = dec2 - dec1;

    // Arc length of the edge in its own frame decides the sample count.
    const arc =
      Math.abs(dDec) > 1e-9
        ? Math.abs(dDec)
        : Math.abs(dRa) * Math.cos(((dec1 + dec2) / 2) * (Math.PI / 180));
    const steps = Math.max(1, Math.ceil(arc / EDGE_STEP_DEG));

    const v: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const p = precess(ra1 + dRa * f, dec1 + dDec * f);
      v.push(round(p[0], 6), round(p[1], 6), round(p[2], 6));
    }

    // Track how far precession moved the endpoint, as a build-time sanity check.
    const before = unitVector(ra1, dec1);
    const after: Vec3 = [v[0], v[1], v[2]];
    const dot = Math.min(1, before[0] * after[0] + before[1] * after[1] + before[2] * after[2]);
    shiftSum += (Math.acos(dot) * 180) / Math.PI;
    shiftN++;

    boundaries.push({ between: [conA, conB], v });
  }

  return { boundaries, shift: round(shiftSum / Math.max(1, shiftN), 4) };
}
