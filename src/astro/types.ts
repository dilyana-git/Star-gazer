/** Core domain model (spec §4). */

/**
 * All times are UTC epoch milliseconds. Local time exists only at display
 * edges — formatting, and parsing user input. Every bug of the form "the sky is
 * one hour wrong in summer" comes from violating this.
 */
export type Instant = number;

export interface Site {
  /** Degrees, north positive. */
  latitude: number;
  /** Degrees, east positive. */
  longitude: number;
  /** Metres above sea level. */
  elevation: number;
  /** IANA zone, resolved via tz-lookup. */
  timezone: string;
  /** "Sofia, Bulgaria" or "Custom location". */
  label: string;
  /** Bortle class 1–9; drives limiting magnitude. */
  bortle: number;
}

/** Degrees. Azimuth 0 = north, 90 = east. */
export interface Horizontal {
  altitude: number;
  azimuth: number;
}

/** Degrees / hours as catalogued. */
export interface Equatorial {
  ra: number; // hours
  dec: number; // degrees
}

export type Vec3 = [number, number, number];
