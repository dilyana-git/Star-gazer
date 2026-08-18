/**
 * Stereographic projection (spec §8.2).
 *
 *   r = tan((90° − altitude) / 2)
 *
 * normalised so the horizon lands on the ring. That is the zenith-centred case;
 * the general form below is the same projection about an arbitrary view
 * direction, so the full-sky and zoomed views share one code path.
 *
 * ⚠ The mirroring trap. A sky chart shows the dome from *underneath*. Looking
 * up with north at the top of the screen puts **east on the left**, the
 * opposite of a ground map. Get this wrong and everything renders plausibly but
 * mirrored, and it is startlingly hard to notice. `tests/frames.test.ts` asserts
 * it explicitly.
 *
 * All input vectors are in the horizontal frame: x = north, y = west, z = up.
 */
import type { Horizontal, Vec3 } from '../astro/types';

const DEG = Math.PI / 180;

export interface Point {
  x: number;
  y: number;
}

export interface View {
  /** Centre of the view, degrees. */
  centre: Horizontal;
  /** Angular radius mapped to `radius` pixels. 90° gives the full-sky chart. */
  fieldRadius: number;
  /** Canvas radius in pixels. */
  radius: number;
}

/** Horizontal angles → unit vector in the horizontal frame. */
export function horVector(h: Horizontal): Vec3 {
  const alt = h.altitude * DEG;
  const az = h.azimuth * DEG;
  const c = Math.cos(alt);
  // Azimuth runs clockwise from north; the frame's y axis points west.
  return [c * Math.cos(az), -c * Math.sin(az), Math.sin(alt)];
}

/**
 * Zenith-centred projection, the full-sky chart. North up, east left,
 * horizon on the ring of the given radius.
 */
export function projectStereographic(h: Horizontal, horizonRadius: number): Point {
  const r = Math.tan(((90 - h.altitude) / 2) * DEG) * horizonRadius;
  const az = h.azimuth * DEG;
  return { x: -r * Math.sin(az), y: -r * Math.cos(az) };
}

/**
 * A projector for one view, with the screen basis computed once. The returned
 * function is allocation-free per call so it can run over nine thousand stars.
 */
export interface Projector {
  /** Screen position of a horizontal-frame unit vector, relative to centre. */
  project(x: number, y: number, z: number, out: Point): boolean;
  /** Screen back to a sky direction — for taps and drags. */
  unproject(x: number, y: number): Horizontal;
  /** Angular radius of the view, degrees. */
  fieldRadius: number;
  radius: number;
}

export function createProjector(view: View): Projector {
  const c = horVector(view.centre);

  // Screen-up is the zenith, flattened into the plane perpendicular to the view
  // direction. Looking (near enough) straight up that has no answer, so the
  // full-sky chart takes the conventional one: north at the top.
  let up: Vec3;
  const dotZenith = c[2];
  if (Math.abs(dotZenith) > 0.999999) {
    up = [1, 0, 0]; // north
    if (dotZenith < 0) up = [-1, 0, 0];
  } else {
    up = [-dotZenith * c[0], -dotZenith * c[1], 1 - dotZenith * c[2]];
    const n = Math.hypot(up[0], up[1], up[2]);
    up = [up[0] / n, up[1] / n, up[2] / n];
  }

  // right = centre × up. With centre at the zenith and up pointing north this
  // comes out as west, which is what puts east on the left.
  const right: Vec3 = [
    c[1] * up[2] - c[2] * up[1],
    c[2] * up[0] - c[0] * up[2],
    c[0] * up[1] - c[1] * up[0],
  ];

  const scale = view.radius / Math.tan((view.fieldRadius / 2) * DEG);
  // Everything more than this far from the centre is off-canvas; the caller
  // culls on it before doing any further work per object.
  const cullDot = Math.cos(Math.min(179, view.fieldRadius * 1.5) * DEG);

  return {
    fieldRadius: view.fieldRadius,
    radius: view.radius,

    project(x: number, y: number, z: number, out: Point): boolean {
      const dot = c[0] * x + c[1] * y + c[2] * z;
      if (dot <= cullDot) return false;

      // tan(θ/2) from the dot product, without an acos: for a unit vector,
      // tan(θ/2) = sin θ / (1 + cos θ), and the in-plane components already
      // carry sin θ.
      const a = right[0] * x + right[1] * y + right[2] * z;
      const b = up[0] * x + up[1] * y + up[2] * z;
      const k = scale / (1 + dot);

      out.x = a * k;
      out.y = -b * k;
      return true;
    },

    unproject(px: number, py: number): Horizontal {
      // Invert the stereographic map: a screen radius ρ came from θ = 2·atan(ρ/scale).
      const rho = Math.hypot(px, py);
      const theta = 2 * Math.atan(rho / scale);
      const s = Math.sin(theta);
      const cosT = Math.cos(theta);
      const ux = rho === 0 ? 0 : px / rho;
      const uy = rho === 0 ? 0 : -py / rho;

      const v: Vec3 = [
        c[0] * cosT + (right[0] * ux + up[0] * uy) * s,
        c[1] * cosT + (right[1] * ux + up[1] * uy) * s,
        c[2] * cosT + (right[2] * ux + up[2] * uy) * s,
      ];

      const altitude = Math.asin(Math.max(-1, Math.min(1, v[2]))) / DEG;
      let azimuth = Math.atan2(-v[1], v[0]) / DEG;
      if (azimuth < 0) azimuth += 360;
      return { altitude, azimuth };
    },
  };
}
