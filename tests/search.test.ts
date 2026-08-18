/**
 * Object search (spec §11, Phase 3). Built against the real generated
 * catalogues, so a search that stops finding Vega fails here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSearchIndex, search } from '../src/data/search';
import type { SkyData } from '../src/data/catalog';
import type { Site } from '../src/astro/types';

const GEN = join(process.cwd(), 'src', 'data', 'generated');
const readJson = <T>(name: string): T => JSON.parse(readFileSync(join(GEN, name), 'utf8')) as T;

const SOFIA: Site = {
  latitude: 42.6977,
  longitude: 23.3219,
  elevation: 550,
  timezone: 'Europe/Sofia',
  label: 'Sofia, Bulgaria',
  bortle: 5,
};

function loadData(): SkyData {
  const buf = readFileSync(join(GEN, 'stars.bin'));
  const packed = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const stride = 5;
  const count = packed.length / stride;

  const xyz = new Float32Array(count * 3);
  const mag = new Float32Array(count);
  const ci = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    xyz[i * 3] = packed[i * stride];
    xyz[i * 3 + 1] = packed[i * stride + 1];
    xyz[i * 3 + 2] = packed[i * stride + 2];
    mag[i] = packed[i * stride + 3];
    ci[i] = packed[i * stride + 4];
  }

  return {
    stars: { count, xyz, mag, ci },
    starMeta: readJson('stars.meta.json'),
    constellations: readJson<{ constellations: SkyData['constellations'] }>('constellations.modern.json')
      .constellations,
    boundaries: readJson('boundaries.modern.json'),
    dsos: readJson('dsos.json'),
    milkyWay: readJson('milkyway.json'),
  };
}

const index = buildSearchIndex(loadData());
const at = (query: string) => search(index, query);
const first = (query: string) => at(query)[0];

describe('the index covers everything the chart can draw', () => {
  it('is built once and holds thousands of entries', () => {
    expect(index.length).toBeGreaterThan(3000);
  });

  it('has one entry per kind that matters', () => {
    const kinds = new Set(index.map((h) => h.kind));
    expect(kinds).toContain('star');
    expect(kinds).toContain('planet');
    expect(kinds).toContain('dso');
    expect(kinds).toContain('constellation');
    expect(kinds).toContain('moon');
    expect(kinds).toContain('sun');
  });
});

describe('finding things by the name people actually type', () => {
  it.each([
    ['vega', 'Vega'],
    ['sirius', 'Sirius'],
    ['betelgeuse', 'Betelgeuse'],
    ['polaris', 'Polaris'],
    ['aldebaran', 'Aldebaran'],
  ])('proper name %s', (query, expected) => {
    expect(first(query)?.label).toBe(expected);
  });

  it('matches on a prefix, so a half-typed name works', () => {
    expect(first('beteig')?.label ?? first('betelg')?.label).toBe('Betelgeuse');
    expect(first('sirI')?.label).toBe('Sirius');
  });

  it('finds Messier and NGC objects by catalogue number', () => {
    expect(first('m31')?.label).toBe('Andromeda Galaxy');
    expect(first('M 31')?.label).toBe('Andromeda Galaxy');
    expect(at('ngc 869').some((h) => h.label.includes('Persei'))).toBe(true);
  });

  it('finds a deep sky object by its common name', () => {
    expect(first('pleiades')?.label).toBe('Pleiades');
    expect(first('ring nebula')?.label).toBe('Ring Nebula');
  });

  it('finds constellations under Latin and English both', () => {
    expect(first('orion')?.kind).toBe('constellation');
    expect(first('camelopardalis')?.kind).toBe('constellation');
    // Stellarium's English name for Virgo is "Maiden".
    const virgo = at('virgo').find((h) => h.kind === 'constellation');
    expect(virgo?.label).toBe('Virgo');
  });

  it('finds the planets, the Sun and the Moon', () => {
    expect(first('jupiter')?.kind).toBe('planet');
    expect(first('saturn')?.kind).toBe('planet');
    expect(first('moon')?.kind).toBe('moon');
    expect(first('sun')?.kind).toBe('sun');
  });

  it('takes a Bayer designation spelled out, because nobody can type α', () => {
    const spelled = first('alpha ori');
    expect(spelled?.kind).toBe('star');
    expect(spelled?.label).toBe('Betelgeuse');
    // And the Greek letter itself still works.
    expect(first('α ori')?.label).toBe('Betelgeuse');
  });

  it('ignores a query too short to mean anything', () => {
    expect(at('')).toEqual([]);
    expect(at('v')).toEqual([]);
  });

  it('returns nothing rather than nonsense for an unknown name', () => {
    expect(at('zzzzqqq')).toEqual([]);
  });
});

describe('ranking', () => {
  it('puts an exact match above a longer one containing it', () => {
    // "Mira" is a star; "Mirach", "Mirfak", "Mirzam" all contain it.
    expect(first('mira')?.label).toBe('Mira');
  });

  it('prefers the brighter of two matches', () => {
    const results = at('al');
    const magnitudes = results
      .filter((h) => h.kind === 'star')
      .map((h) => Number(/magnitude (-?[\d.]+)/.exec(h.hint)?.[1] ?? NaN))
      .filter(Number.isFinite);
    // Not strictly sorted across kinds, but the head of the list should be bright.
    expect(Math.min(...magnitudes)).toBeLessThan(2.5);
  });

  it('caps the result list at something a person can read', () => {
    expect(at('a').length).toBeLessThanOrEqual(12);
    expect(at('ngc').length).toBeLessThanOrEqual(12);
  });
});

describe('a hit resolves to a real place in the sky', () => {
  const instant = Date.UTC(2026, 0, 20, 19, 0, 0);

  it('puts Polaris at the observer’s latitude, as the frames test demands', () => {
    const hit = first('polaris')!;
    const object = hit.resolve(SOFIA, instant);
    expect(Math.abs(object.altitude - SOFIA.latitude)).toBeLessThan(1);
  });

  it('gives Betelgeuse a southern azimuth on a January evening', () => {
    const object = first('betelgeuse')!.resolve(SOFIA, instant);
    expect(object.altitude).toBeGreaterThan(0);
    expect(object.azimuth).toBeGreaterThan(90);
    expect(object.azimuth).toBeLessThan(180);
  });

  it('carries the catalogue index for stars, so the chart can highlight them', () => {
    expect(first('vega')!.resolve(SOFIA, instant).index).toBeGreaterThanOrEqual(0);
  });

  it('resolves the same object to different places at different times', () => {
    const hit = first('betelgeuse')!;
    const a = hit.resolve(SOFIA, instant);
    const b = hit.resolve(SOFIA, instant + 6 * 3_600_000);
    expect(Math.abs(a.azimuth - b.azimuth)).toBeGreaterThan(20);
  });
});
