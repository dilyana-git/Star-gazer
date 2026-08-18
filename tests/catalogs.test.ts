/**
 * Phase 0 acceptance (spec §11): the generated artifacts exist, carry the
 * expected shape, and sit in the expected size envelope. These are cheap and
 * they catch a silently-broken build long before anything renders.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const GEN = join(process.cwd(), 'src', 'data', 'generated');
const read = <T>(name: string): T => JSON.parse(readFileSync(join(GEN, name), 'utf8')) as T;
const size = (name: string) => statSync(join(GEN, name)).size;

const meta = read<{
  stars: { count: number; stride: number; magLimit: number; magMin: number; magMax: number; named: number };
  skycultures: Array<{ id: string; count: number }>;
  dsos: { count: number; magLimit: number };
  showers: { count: number };
  cities: { count: number };
}>('catalog.meta.json');

const RAD = 180 / Math.PI;

describe('stars.bin', () => {
  const buf = readFileSync(join(GEN, 'stars.bin'));
  const stars = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const stride = meta.stars.stride;
  const n = stars.length / stride;

  it('holds roughly nine thousand stars, the naked-eye sky', () => {
    expect(n).toBe(meta.stars.count);
    expect(n).toBeGreaterThan(8000);
    expect(n).toBeLessThan(10000);
  });

  it('packs exactly [x, y, z, mag, ci] per star with no remainder', () => {
    expect(stride).toBe(5);
    expect(stars.length % stride).toBe(0);
    expect(buf.byteLength).toBe(n * stride * 4);
  });

  it('respects the magnitude cut and reaches the brightest star', () => {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < n; i++) {
      const m = stars[i * stride + 3];
      if (m < min) min = m;
      if (m > max) max = m;
    }
    expect(max).toBeLessThanOrEqual(6.5);
    // Sirius, at −1.44, must be in there.
    expect(min).toBeLessThan(-1.4);
  });

  it('is sorted brightest-first, so the load animation can reveal a prefix', () => {
    for (let i = 1; i < n; i++) {
      expect(stars[i * stride + 3]).toBeGreaterThanOrEqual(stars[(i - 1) * stride + 3]);
    }
  });

  it('stores unit vectors, not right ascension and declination', () => {
    for (let i = 0; i < n; i += 97) {
      const o = i * stride;
      const len = Math.hypot(stars[o], stars[o + 1], stars[o + 2]);
      expect(len).toBeCloseTo(1, 5);
    }
  });

  it('places Sirius where Sirius is', () => {
    // Brightest star in the catalogue, so index 0. J2000: 06h 45m 08.9s, −16° 42′ 58″.
    const [x, y, z] = [stars[0], stars[1], stars[2]];
    let ra = Math.atan2(y, x) * RAD;
    if (ra < 0) ra += 360;
    expect(ra / 15).toBeCloseTo(6.7525, 2);
    expect(Math.asin(z) * RAD).toBeCloseTo(-16.716, 2);
    expect(stars[3]).toBeCloseTo(-1.44, 2);
  });

  it('stays small enough to fetch on a cold load', () => {
    expect(size('stars.bin')).toBeLessThan(300 * 1024);
  });
});

describe('stars.meta.json', () => {
  const names = read<Record<string, { n?: string; b?: string; f?: string; c?: string; h: string }>>(
    'stars.meta.json',
  );

  it('covers about a thousand named or designated stars, keyed by star index', () => {
    expect(Object.keys(names).length).toBe(meta.stars.named);
    expect(Object.keys(names).length).toBeGreaterThan(1000);
  });

  it('names the brightest star', () => {
    expect(names['0'].n).toBe('Sirius');
    expect(names['0'].c).toBe('CMa');
  });

  it('carries the four bright ecliptic stars the occultation detector needs', () => {
    const wanted = ['Aldebaran', 'Regulus', 'Spica', 'Antares'];
    const found = new Set(Object.values(names).map((v) => v.n));
    for (const w of wanted) expect(found).toContain(w);
  });
});

describe('constellations', () => {
  const file = read<{
    id: string;
    constellations: Array<{ id: string; name: string; lines: number[][]; labelAt: number[]; extent: number }>;
  }>('constellations.modern.json');

  it('has all 88 figures', () => {
    expect(file.constellations.length).toBe(88);
    expect(meta.skycultures[0].count).toBe(88);
  });

  it('resolved every figure vertex to a unit vector', () => {
    for (const c of file.constellations) {
      for (const line of c.lines) {
        expect(line.length % 3).toBe(0);
        expect(line.length).toBeGreaterThanOrEqual(6);
        for (let i = 0; i < line.length; i += 3) {
          expect(Math.hypot(line[i], line[i + 1], line[i + 2])).toBeCloseTo(1, 4);
        }
      }
    }
  });

  it('puts Orion together, at the right size and place', () => {
    const ori = file.constellations.find((c) => c.id === 'Ori');
    expect(ori).toBeDefined();
    expect(ori!.name).toBe('Orion');
    // Orion spans roughly 20°; its centroid sits near the celestial equator.
    expect(ori!.extent).toBeGreaterThan(10);
    expect(ori!.extent).toBeLessThan(30);
    expect(Math.abs(Math.asin(ori!.labelAt[2]) * RAD)).toBeLessThan(15);
  });
});

describe('boundaries', () => {
  const bounds = read<Array<{ between: [string, string]; v: number[] }>>('boundaries.modern.json');

  it('covers the whole sky as edges between named constellations', () => {
    expect(bounds.length).toBeGreaterThan(700);
    const cons = new Set(bounds.flatMap((b) => b.between));
    expect(cons.size).toBeGreaterThanOrEqual(88);
  });

  it('is stored as unit vectors', () => {
    for (const b of bounds.slice(0, 200)) {
      expect(b.v.length % 3).toBe(0);
      for (let i = 0; i < b.v.length; i += 3) {
        expect(Math.hypot(b.v[i], b.v[i + 1], b.v[i + 2])).toBeCloseTo(1, 3);
      }
    }
  });

  it('was precessed from B1875 — Orion’s boundary is not sitting 1.5° off its stars', () => {
    // Orion's western boundary runs along RA 4h 41m in B1875. If precession were
    // skipped, every boundary vertex would still be on its B1875 coordinate line
    // and the whole grid would be displaced by ~1.3°. Sample the Andromeda /
    // Lacerta edge, whose B1875 endpoint is exactly 22h 52m +34° 30′, and assert
    // it has moved by that much.
    const edge = bounds.find((b) => b.between[0] === 'AND' && b.between[1] === 'LAC');
    expect(edge).toBeDefined();

    const raB1875 = (22 + 52 / 60) * 15;
    const decB1875 = 34.5;
    const cd = Math.cos(decB1875 / RAD);
    const b1875 = [cd * Math.cos(raB1875 / RAD), cd * Math.sin(raB1875 / RAD), Math.sin(decB1875 / RAD)];
    const [x, y, z] = edge!.v;
    const sep = Math.acos(Math.min(1, b1875[0] * x + b1875[1] * y + b1875[2] * z)) * RAD;

    expect(sep).toBeGreaterThan(1.0);
    expect(sep).toBeLessThan(1.6);
  });
});

describe('deep sky objects', () => {
  const dsos = read<Array<{ id: string; name: string; mag: number; size: number; type: string }>>('dsos.json');

  it('respects the magnitude cut', () => {
    expect(dsos.length).toBe(meta.dsos.count);
    expect(Math.max(...dsos.map((d) => d.mag))).toBeLessThanOrEqual(10);
  });

  it('includes the objects a binocular observer actually looks for', () => {
    const byId = new Map(dsos.map((d) => [d.id, d]));
    for (const id of ['M31', 'M42', 'M45', 'M13', 'M57']) expect(byId.has(id)).toBe(true);
    // The Double Cluster has no Messier number and lives under NGC.
    expect(dsos.some((d) => d.id === 'NGC 869')).toBe(true);
  });

  it('keeps angular size, which the visibility model needs', () => {
    const m31 = dsos.find((d) => d.id === 'M31')!;
    expect(m31.size).toBeGreaterThan(100); // arcminutes — M31 is enormous
    expect(m31.type).toBe('galaxy');
  });
});

describe('meteor showers', () => {
  const showers = read<Array<{ code: string; peak: number; begin: number; end: number; zhr: number }>>(
    'showers.json',
  );

  it('carries the IMO working list', () => {
    expect(showers.length).toBe(meta.showers.count);
    expect(showers.length).toBeGreaterThanOrEqual(20);
  });

  it('uses solar longitude for peaks, not calendar dates', () => {
    for (const s of showers) {
      expect(s.peak).toBeGreaterThanOrEqual(0);
      expect(s.peak).toBeLessThan(360);
      expect(s.begin).toBeGreaterThanOrEqual(0);
      expect(s.end).toBeLessThan(360);
    }
  });

  it('has the three showers worth setting an alarm for', () => {
    const byCode = new Map(showers.map((s) => [s.code, s]));
    expect(byCode.get('PER')!.zhr).toBeGreaterThanOrEqual(75);
    expect(byCode.get('GEM')!.zhr).toBeGreaterThanOrEqual(100);
    expect(byCode.get('QUA')!.zhr).toBeGreaterThanOrEqual(75);
  });
});

describe('cities', () => {
  const cities = read<Array<[string, string, string, number, number, number]>>('cities.json');

  it('is the top 25,000 by population, in compact tuple form', () => {
    expect(cities.length).toBe(meta.cities.count);
    expect(cities.length).toBe(25_000);
    expect(cities[0].length).toBe(6);
  });

  it('holds plausible coordinates and descending population', () => {
    for (const [name, , , lat, lon] of cities.slice(0, 500)) {
      expect(name.length).toBeGreaterThan(0);
      expect(Math.abs(lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(lon)).toBeLessThanOrEqual(180);
    }
    for (let i = 1; i < 500; i++) expect(cities[i][5]).toBeLessThanOrEqual(cities[i - 1][5]);
  });

  it('can find Sofia', () => {
    const sofia = cities.find((c) => c[0] === 'Sofia' && c[1] === 'BG');
    expect(sofia).toBeDefined();
    expect(sofia![3]).toBeCloseTo(42.7, 0);
    expect(sofia![4]).toBeCloseTo(23.3, 0);
  });
});

describe('total bundle size', () => {
  it('keeps the generated data under three megabytes', () => {
    const files = [
      'stars.bin',
      'stars.meta.json',
      'constellations.modern.json',
      'boundaries.modern.json',
      'dsos.json',
      'milkyway.json',
      'showers.json',
      'cities.json',
      'catalog.meta.json',
    ];
    const total = files.reduce((a, f) => a + size(f), 0);
    expect(total).toBeLessThan(3 * 1024 * 1024);
  });
});
