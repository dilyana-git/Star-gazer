/**
 * Sidereal catalogue build — run with `npm run build:catalogs`.
 *
 * Fetches every external catalogue once, reduces it, and writes generated
 * artifacts to src/data/generated/. Those outputs are committed; the app never
 * fetches astronomical data at runtime (spec §3).
 *
 * Sources, licences and the two substitutions forced by this build
 * environment's egress policy are declared in scripts/sources.ts; obligations
 * are restated in ATTRIBUTION.md.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildStars, MAG_LIMIT, STAR_STRIDE } from './steps/stars.js';
import { buildConstellations } from './steps/constellations.js';
import { buildDsos, DSO_MAG_LIMIT } from './steps/dsos.js';
import { buildCities, CITY_LIMIT } from './steps/cities.js';
import { buildMilkyWay } from './steps/milkyway.js';
import { SKYCULTURES, SOURCES } from './sources.js';

const OUT = join(process.cwd(), 'src', 'data', 'generated');

async function writeJson(name: string, value: unknown): Promise<number> {
  const body = JSON.stringify(value);
  await writeFile(join(OUT, name), body);
  return Buffer.byteLength(body);
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} kB`;
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const sizes: Record<string, number> = {};

  console.log('stars');
  const stars = await buildStars();
  await writeFile(join(OUT, 'stars.bin'), stars.bin);
  sizes['stars.bin'] = stars.bin.byteLength;
  sizes['stars.meta.json'] = await writeJson('stars.meta.json', stars.meta);
  console.log(
    `  ${stars.count} stars ≤ mag ${MAG_LIMIT} (${stars.magMin.toFixed(2)} … ${stars.magMax.toFixed(2)}), ` +
      `${stars.named} with designations, ${kb(stars.bin.byteLength)}`,
  );

  console.log('constellations');
  const cultures = [];
  for (const { id, label } of SKYCULTURES) {
    const c = await buildConstellations(id, stars.hipVector);
    cultures.push({ id, label, count: c.constellations.length });
    sizes[`constellations.${id}.json`] = await writeJson(`constellations.${id}.json`, {
      id,
      label,
      constellations: c.constellations,
    });
    sizes[`boundaries.${id}.json`] = await writeJson(`boundaries.${id}.json`, c.boundaries);
    console.log(
      `  ${id}: ${c.constellations.length} figures, ${c.boundaries.length} boundary edges ` +
        `precessed B1875→J2000 by ${c.boundaryShiftDeg.toFixed(3)}° mean` +
        (c.droppedHips.length ? `, ${c.droppedHips.length} figure vertices below the mag cut` : ''),
    );
  }

  console.log('deep sky objects');
  const dsos = await buildDsos();
  sizes['dsos.json'] = await writeJson('dsos.json', dsos);
  console.log(`  ${dsos.length} objects ≤ mag ${DSO_MAG_LIMIT}, ${kb(sizes['dsos.json'])}`);

  console.log('milky way');
  const mw = await buildMilkyWay();
  sizes['milkyway.json'] = await writeJson('milkyway.json', mw);
  console.log(`  ${mw.length} isophote levels, ${kb(sizes['milkyway.json'])}`);

  console.log('meteor showers');
  const showerSrc = JSON.parse(
    await readFile(join(process.cwd(), 'src', 'data', 'source', 'showers.json'), 'utf8'),
  ) as { showers: Array<Record<string, unknown>> };
  validateShowers(showerSrc.showers);
  sizes['showers.json'] = await writeJson('showers.json', showerSrc.showers);
  console.log(`  ${showerSrc.showers.length} showers`);

  console.log('cities');
  const cities = await buildCities();
  sizes['cities.json'] = await writeJson('cities.json', cities);
  console.log(`  ${cities.length} cities (top ${CITY_LIMIT} by population), ${kb(sizes['cities.json'])}`);

  const meta = {
    builtAt: new Date().toISOString(),
    stars: {
      count: stars.count,
      stride: STAR_STRIDE,
      magLimit: MAG_LIMIT,
      magMin: Number(stars.magMin.toFixed(3)),
      magMax: Number(stars.magMax.toFixed(3)),
      named: stars.named,
    },
    skycultures: cultures,
    dsos: { count: dsos.length, magLimit: DSO_MAG_LIMIT },
    showers: { count: showerSrc.showers.length },
    cities: { count: cities.length },
    sizes,
    sources: Object.fromEntries(
      Object.entries(SOURCES).map(([k, v]) => [
        k,
        { name: v.name, licence: v.licence, ...('note' in v ? { note: v.note } : {}) },
      ]),
    ),
  };
  sizes['catalog.meta.json'] = await writeJson('catalog.meta.json', meta);

  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  console.log(`\ndone — ${kb(total)} of generated data in src/data/generated/`);
}

function validateShowers(showers: Array<Record<string, unknown>>): void {
  const required = ['code', 'name', 'ra', 'dec', 'peak', 'begin', 'end', 'zhr', 'r'];
  for (const s of showers) {
    for (const k of required) {
      if (s[k] === undefined) throw new Error(`shower ${String(s.code)} is missing ${k}`);
    }
    const dec = s.dec as number;
    const ra = s.ra as number;
    if (dec < -90 || dec > 90) throw new Error(`shower ${String(s.code)} has an impossible declination`);
    if (ra < 0 || ra >= 360) throw new Error(`shower ${String(s.code)} has an impossible right ascension`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
