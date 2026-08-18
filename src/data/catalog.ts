/**
 * Loading the generated catalogues (built by `npm run build:catalogs`).
 *
 * Nothing here touches the network beyond the app's own origin — the catalogues
 * are build artifacts served as static assets, so the app works offline once
 * loaded. Star positions arrive as a packed binary; everything else is JSON,
 * code-split so that the cities list is only fetched when someone opens the
 * location search.
 *
 * Stars are unpacked into three parallel typed arrays rather than kept
 * interleaved: the render loop touches xyz on every star every frame and
 * magnitude only for the survivors, and splitting them keeps the hot pass
 * walking contiguous memory (spec §8.1).
 */
import starsUrl from './generated/stars.bin?url';
import catalogMeta from './generated/catalog.meta.json';

export interface StarCatalog {
  count: number;
  /** J2000 unit vectors, [x, y, z] × count. */
  xyz: Float32Array;
  mag: Float32Array;
  /** B−V colour index. */
  ci: Float32Array;
}

export interface StarMeta {
  /** Proper name — "Vega". */
  n?: string;
  /** Bayer letter — "α". */
  b?: string;
  /** Flamsteed number. */
  f?: string;
  /** IAU constellation abbreviation. */
  c?: string;
  /** Hipparcos id. */
  h: string;
}

export interface ConstellationFigure {
  id: string;
  name: string;
  native: string;
  lines: number[][];
  labelAt: [number, number, number];
  extent: number;
}

export interface BoundaryEdge {
  between: [string, string];
  v: number[];
}

export interface Dso {
  id: string;
  ngc: string;
  name: string;
  type: string;
  x: number;
  y: number;
  z: number;
  mag: number;
  /** Major axis, arcminutes. */
  size: number;
  /** Surface brightness, mag/arcsec². */
  sb: number;
  con: string;
}

export interface Shower {
  code: string;
  name: string;
  ra: number;
  dec: number;
  /** Solar longitude of the peak, degrees. */
  peak: number;
  begin: number;
  end: number;
  zhr: number;
  /** Population index. */
  r: number;
  parent?: string;
}

export interface MilkyWayLevel {
  level: number;
  rings: number[][];
}

/** [name, countryCode, admin1, lat, lon, population] */
export type CityTuple = [string, string, string, number, number, number];

export const CATALOG_META = catalogMeta;

let starsPromise: Promise<StarCatalog> | null = null;

export function loadStars(): Promise<StarCatalog> {
  starsPromise ??= fetch(starsUrl)
    .then((r) => {
      if (!r.ok) throw new Error(`stars.bin: ${r.status}`);
      return r.arrayBuffer();
    })
    .then((buf) => {
      const packed = new Float32Array(buf);
      const stride = catalogMeta.stars.stride;
      const count = packed.length / stride;

      const xyz = new Float32Array(count * 3);
      const mag = new Float32Array(count);
      const ci = new Float32Array(count);

      for (let i = 0; i < count; i++) {
        const o = i * stride;
        xyz[i * 3] = packed[o];
        xyz[i * 3 + 1] = packed[o + 1];
        xyz[i * 3 + 2] = packed[o + 2];
        mag[i] = packed[o + 3];
        ci[i] = packed[o + 4];
      }

      return { count, xyz, mag, ci };
    });
  return starsPromise;
}

const once = <T>(load: () => Promise<T>): (() => Promise<T>) => {
  let p: Promise<T> | null = null;
  return () => (p ??= load());
};

export const loadStarMeta = once(
  async (): Promise<Record<string, StarMeta>> => (await import('./generated/stars.meta.json')).default,
);

export const loadConstellations = once(async (): Promise<ConstellationFigure[]> => {
  const file = await import('./generated/constellations.modern.json');
  return file.default.constellations as ConstellationFigure[];
});

export const loadBoundaries = once(
  async (): Promise<BoundaryEdge[]> =>
    (await import('./generated/boundaries.modern.json')).default as BoundaryEdge[],
);

export const loadDsos = once(
  async (): Promise<Dso[]> => (await import('./generated/dsos.json')).default as Dso[],
);

export const loadShowers = once(
  async (): Promise<Shower[]> => (await import('./generated/showers.json')).default as Shower[],
);

export const loadMilkyWay = once(
  async (): Promise<MilkyWayLevel[]> => (await import('./generated/milkyway.json')).default as MilkyWayLevel[],
);

export const loadCities = once(
  async (): Promise<CityTuple[]> => (await import('./generated/cities.json')).default as CityTuple[],
);

/** Everything the sky view needs before it can draw a frame. */
export interface SkyData {
  stars: StarCatalog;
  starMeta: Record<string, StarMeta>;
  constellations: ConstellationFigure[];
  boundaries: BoundaryEdge[];
  dsos: Dso[];
  milkyWay: MilkyWayLevel[];
}

export const loadSkyData = once(async (): Promise<SkyData> => {
  const [stars, starMeta, constellations, boundaries, dsos, milkyWay] = await Promise.all([
    loadStars(),
    loadStarMeta(),
    loadConstellations(),
    loadBoundaries(),
    loadDsos(),
    loadMilkyWay(),
  ]);
  return { stars, starMeta, constellations, boundaries, dsos, milkyWay };
});
