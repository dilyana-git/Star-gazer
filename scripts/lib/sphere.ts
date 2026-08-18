/** Build-time spherical geometry helpers. Angles in degrees unless noted. */

export const DEG = Math.PI / 180;

export type Vec3 = [number, number, number];

/** RA/Dec (degrees) on the unit sphere → Cartesian unit vector, x toward RA=0. */
export function unitVector(raDeg: number, decDeg: number): Vec3 {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const cd = Math.cos(dec);
  return [cd * Math.cos(ra), cd * Math.sin(ra), Math.sin(dec)];
}

export function normalize(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

/** "HH:MM:SS.s" → degrees. */
export function parseRaHms(s: string): number {
  const [h, m, sec] = s.trim().split(':').map(Number);
  return (h + m / 60 + (sec || 0) / 3600) * 15;
}

/** "+DD:MM:SS.s" → degrees. */
export function parseDecDms(s: string): number {
  const t = s.trim();
  const sign = t.startsWith('-') ? -1 : 1;
  const [d, m, sec] = t.replace(/^[+-]/, '').split(':').map(Number);
  return sign * (d + m / 60 + (sec || 0) / 3600);
}

export function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
