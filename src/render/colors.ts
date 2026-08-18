/**
 * The palette, and star colour from the catalogue's B−V index (spec §8.3, §10).
 *
 * Real stars read as near-white to the eye. A chart with saturated blue and
 * orange dots looks like a candy jar, not a sky — so the blackbody colour is
 * computed properly and then desaturated hard, to about 15%. What survives is
 * the *relative* warmth of Betelgeuse against Rigel, which is all the eye gets
 * anyway.
 */

export const PALETTE = {
  void: '#050311',
  gold: '#c9a24c',
  goldLit: '#e8cb7a',
  cream: '#ede4d0',
  horizon: '#1a1230',
} as const;

/** How much of the true blackbody colour survives. 0 = white, 1 = full. */
const SATURATION = 0.15;

/**
 * B−V colour index → effective temperature, via Ballesteros' formula.
 * Good to a few percent across the range the catalogue actually contains.
 */
export function temperatureFromBv(bv: number): number {
  const b = Math.max(-0.4, Math.min(2.0, bv));
  return 4600 * (1 / (0.92 * b + 1.7) + 1 / (0.92 * b + 0.62));
}

/** Blackbody temperature → sRGB, Tanner Helland's piecewise approximation. */
export function rgbFromTemperature(kelvin: number): [number, number, number] {
  const t = Math.max(1000, Math.min(40000, kelvin)) / 100;

  const r = t <= 66 ? 255 : clamp(329.698727446 * Math.pow(t - 60, -0.1332047592));
  const g =
    t <= 66
      ? clamp(99.4708025861 * Math.log(t) - 161.1195681661)
      : clamp(288.1221695283 * Math.pow(t - 60, -0.0755148492));
  const b = t >= 66 ? 255 : t <= 19 ? 0 : clamp(138.5177312231 * Math.log(t - 10) - 305.0447927307);

  return [r, g, b];
}

function clamp(n: number): number {
  return Math.max(0, Math.min(255, n));
}

/**
 * The colour a star is actually drawn in: blackbody, pulled most of the way
 * back to the cream of the palette.
 */
export function starColor(bv: number): string {
  const [r, g, b] = rgbFromTemperature(temperatureFromBv(bv));
  // Mix toward the palette cream rather than toward pure white, so the star
  // field belongs to the same page as the type.
  const [cr, cg, cb] = [0xed, 0xe4, 0xd0];
  return `rgb(${mix(cr, r)},${mix(cg, g)},${mix(cb, b)})`;
}

function mix(base: number, target: number): number {
  return Math.round(base + (target - base) * SATURATION);
}

/**
 * Star colours quantised into buckets, built once. Setting `fillStyle` is the
 * single most expensive thing in the draw loop, so nine thousand stars share a
 * few dozen strings and the loop sorts naturally into runs.
 */
const BUCKETS = 24;
const BV_MIN = -0.4;
const BV_MAX = 2.0;

export const STAR_COLORS: string[] = Array.from({ length: BUCKETS }, (_, i) =>
  starColor(BV_MIN + ((BV_MAX - BV_MIN) * (i + 0.5)) / BUCKETS),
);

export function starColorBucket(bv: number): number {
  const f = (bv - BV_MIN) / (BV_MAX - BV_MIN);
  return Math.max(0, Math.min(BUCKETS - 1, Math.floor(f * BUCKETS)));
}

/** `rgba()` from a hex string in the palette. */
export function alpha(hex: string, a: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
