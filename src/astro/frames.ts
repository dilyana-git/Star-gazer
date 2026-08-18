/**
 * The coordinate pipeline (spec §5). Test this before building anything on it.
 *
 *   J2000 unit vector (from the catalogue)
 *     → precession + nutation to the equator of date
 *     → rotate by local sidereal time and latitude
 *     → topocentric horizontal (alt, az)
 *     → atmospheric refraction, at the display edge only
 *
 * The first three steps are a single 3×3 rotation, obtained once per
 * (site, instant) and applied to the whole star array in a flat loop. That is
 * both the correct approach and the fast one.
 *
 * EQJ vs EQD (§5.1): the catalogue is EQJ. Several convenience functions in
 * astronomy-engine expect EQD. Feeding J2000 coordinates to an of-date function
 * costs about 0.35° at epoch 2026 — small enough to look plausible on screen,
 * large enough to be wrong. `naiveOfDateAltAz` below exists only so a test can
 * prove the two paths differ; nothing in the app calls it.
 *
 * Annual aberration is not applied to stars. Its maximum is 20.5 arcseconds,
 * a third of an arcminute, below the tier this app targets. Planets get it from
 * the library, which computes it properly.
 */
import * as A from 'astronomy-engine';
import type { Horizontal, Instant, Site, Vec3 } from './types';

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

/** Geometric altitude of a body's centre at rise/set, degrees (spec §5.3). */
export const RISE_SET_ALTITUDE_STAR = -0.5667;

export function observerFor(site: Site): A.Observer {
  return new A.Observer(site.latitude, site.longitude, site.elevation);
}

export function timeOf(instant: Instant): A.AstroTime {
  return A.MakeTime(new Date(instant));
}

/**
 * Row-major 3×3 rotation from J2000 equatorial to horizontal, for one
 * (site, instant). The horizontal frame is x = north, y = west, z = zenith.
 *
 * Compute once, then apply to every catalogue vector. Calling a per-object
 * conversion function instead recomputes sidereal time nine thousand times a
 * frame, which is the difference between 60fps and a slideshow.
 */
export function rotationEqjToHor(site: Site, instant: Instant): Float64Array {
  const m = A.Rotation_EQJ_HOR(timeOf(instant), observerFor(site)).rot;
  // astronomy-engine stores rot[i][j] as column i, row j.
  return new Float64Array([
    m[0][0], m[1][0], m[2][0],
    m[0][1], m[1][1], m[2][1],
    m[0][2], m[1][2], m[2][2],
  ]);
}

/** Inverse of {@link rotationEqjToHor}: horizontal back to J2000 equatorial. */
export function rotationHorToEqj(site: Site, instant: Instant): Float64Array {
  const m = A.Rotation_HOR_EQJ(timeOf(instant), observerFor(site)).rot;
  return new Float64Array([
    m[0][0], m[1][0], m[2][0],
    m[0][1], m[1][1], m[2][1],
    m[0][2], m[1][2], m[2][2],
  ]);
}

/** Apply a row-major 3×3 to a vector. Allocates; not for the render loop. */
export function rotate(r: Float64Array, v: Vec3): Vec3 {
  return [
    r[0] * v[0] + r[1] * v[1] + r[2] * v[2],
    r[3] * v[0] + r[4] * v[1] + r[5] * v[2],
    r[6] * v[0] + r[7] * v[1] + r[8] * v[2],
  ];
}

/**
 * Horizontal-frame vector (x north, y west, z up) → geometric alt/az.
 * Azimuth is measured clockwise from north, so east is +90°.
 * This is *unrefracted*: it is the true direction, which is what angular
 * separations must be computed from (§5.3).
 */
export function altAzFromHorVector(x: number, y: number, z: number): Horizontal {
  const altitude = Math.asin(Math.max(-1, Math.min(1, z))) * RAD;
  let azimuth = Math.atan2(-y, x) * RAD;
  if (azimuth < 0) azimuth += 360;
  return { altitude, azimuth };
}

/** J2000 RA (hours) / Dec (degrees) → unit vector. */
export function vectorFromRaDec(raHours: number, decDeg: number): Vec3 {
  const ra = raHours * 15 * DEG;
  const dec = decDeg * DEG;
  const cd = Math.cos(dec);
  return [cd * Math.cos(ra), cd * Math.sin(ra), Math.sin(dec)];
}

/** Unit vector → J2000 RA (hours) / Dec (degrees). */
export function raDecFromVector(v: Vec3): { ra: number; dec: number } {
  let ra = Math.atan2(v[1], v[0]) * RAD;
  if (ra < 0) ra += 360;
  return { ra: ra / 15, dec: Math.asin(Math.max(-1, Math.min(1, v[2]))) * RAD };
}

/** The whole pipeline for one J2000 position. Geometric, unrefracted. */
export function eqjToHorizontal(site: Site, instant: Instant, raHours: number, decDeg: number): Horizontal {
  const r = rotationEqjToHor(site, instant);
  const [x, y, z] = rotate(r, vectorFromRaDec(raHours, decDeg));
  return altAzFromHorVector(x, y, z);
}

/** Inverse of {@link eqjToHorizontal}, for the round-trip invariant. */
export function horizontalToEqj(
  site: Site,
  instant: Instant,
  altitude: number,
  azimuth: number,
): { ra: number; dec: number } {
  const alt = altitude * DEG;
  const az = azimuth * DEG;
  const ca = Math.cos(alt);
  // Back to the x=north, y=west, z=up frame.
  const hor: Vec3 = [ca * Math.cos(az), -ca * Math.sin(az), Math.sin(alt)];
  return raDecFromVector(rotate(rotationHorToEqj(site, instant), hor));
}

/**
 * The wrong path, kept only so a test can prove precession is applied:
 * J2000 catalogue coordinates fed to an of-date rotation. Never call this.
 */
export function naiveOfDateAltAz(site: Site, instant: Instant, raHours: number, decDeg: number): Horizontal {
  const m = A.Rotation_EQD_HOR(timeOf(instant), observerFor(site)).rot;
  const r = new Float64Array([
    m[0][0], m[1][0], m[2][0],
    m[0][1], m[1][1], m[2][1],
    m[0][2], m[1][2], m[2][2],
  ]);
  const [x, y, z] = rotate(r, vectorFromRaDec(raHours, decDeg));
  return altAzFromHorVector(x, y, z);
}

/**
 * Apparent altitude, for display and for rise/set. Refraction is applied here
 * and nowhere else — an unrefracted separation is what "how far apart are they
 * really" means (§5.3).
 */
export function apparentAltitude(geometricAltitude: number): number {
  return geometricAltitude + A.Refraction('normal', geometricAltitude);
}

/** Angular separation between two unit vectors, degrees. True, not apparent. */
export function separation(a: Vec3, b: Vec3): number {
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return Math.acos(dot) * RAD;
}

/**
 * Topocentric J2000 unit vector for a solar-system body, with aberration and
 * light-travel handled by the library. Rotate it with the same EQJ→HOR matrix
 * the stars use.
 */
export function bodyVectorEqj(body: A.Body, instant: Instant, site: Site): Vec3 {
  const eq = A.Equator(body, timeOf(instant), observerFor(site), false, true);
  const v = eq.vec;
  const n = Math.hypot(v.x, v.y, v.z) || 1;
  return [v.x / n, v.y / n, v.z / n];
}

/** Distance to a solar-system body in AU, topocentric. */
export function bodyDistanceAu(body: A.Body, instant: Instant, site: Site): number {
  return A.Equator(body, timeOf(instant), observerFor(site), false, true).dist;
}

/** Alt/az of a solar-system body. Geometric unless `apparent` is set. */
export function bodyAltAz(body: A.Body, instant: Instant, site: Site, apparent = false): Horizontal {
  const r = rotationEqjToHor(site, instant);
  const [x, y, z] = rotate(r, bodyVectorEqj(body, instant, site));
  const h = altAzFromHorVector(x, y, z);
  return apparent ? { ...h, altitude: apparentAltitude(h.altitude) } : h;
}

/** Apparent angular radius of the Moon in degrees, as seen from the site. */
export function moonAngularRadius(instant: Instant, site: Site): number {
  const distKm = bodyDistanceAu(A.Body.Moon, instant, site) * A.KM_PER_AU;
  const MOON_RADIUS_KM = 1737.4;
  return Math.asin(MOON_RADIUS_KM / distKm) * RAD;
}

/** Compass point for an azimuth, for the plain-language event copy. */
export function compassPoint(azimuth: number): string {
  const points = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  return points[Math.round(((azimuth % 360) + 360) % 360 / 45) % 8];
}
