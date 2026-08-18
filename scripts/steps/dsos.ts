/**
 * Deep sky objects (spec §3.4). OpenNGC, filtered to mag ≤ 10 with a known type.
 *
 * Angular size is kept because it decides whether an object is actually
 * reachable: a magnitude-8 galaxy spread over 20 arcminutes has its light
 * smeared over 400× the area of a magnitude-8 point source, and the surface
 * brightness derived here is what §7.4's visibility logic reasons about.
 */
import { fetchText } from '../lib/fetch-cache.js';
import { parseDecDms, parseRaHms, round, unitVector } from '../lib/sphere.js';
import { SOURCES } from '../sources.js';

export const DSO_MAG_LIMIT = 10;

/** OpenNGC type codes we surface, mapped to plain language. */
const TYPES: Record<string, string> = {
  G: 'galaxy',
  GPair: 'galaxy pair',
  GTrpl: 'galaxy triplet',
  GGroup: 'galaxy group',
  GCl: 'globular cluster',
  OCl: 'open cluster',
  Cl: 'star cluster',
  'Cl+N': 'cluster with nebulosity',
  PN: 'planetary nebula',
  Neb: 'nebula',
  EmN: 'emission nebula',
  RfN: 'reflection nebula',
  SNR: 'supernova remnant',
  HII: 'HII region',
  DrkN: 'dark nebula',
  Ast: 'asterism',
  '*Ass': 'stellar association',
};

export interface DsoOut {
  /** Display id: Messier number where there is one, else NGC/IC. */
  id: string;
  /** Catalogue designation, always NGC/IC form. */
  ngc: string;
  name: string;
  type: string;
  x: number;
  y: number;
  z: number;
  mag: number;
  /** Major axis, arcminutes. 0 when the catalogue has no size. */
  size: number;
  /** Surface brightness, mag per square arcsecond; 0 when not derivable. */
  sb: number;
  con: string;
}

export async function buildDsos(): Promise<DsoOut[]> {
  // The addendum carries objects with no NGC/IC number at all — the Pleiades,
  // the Hyades, Melotte and Collinder clusters — several of which are among the
  // brightest things in the sky and would otherwise be missing entirely.
  const [main, addendum] = await Promise.all([
    fetchText(SOURCES.dsos.url),
    fetchText(SOURCES.dsos.addendumUrl),
  ]);

  const out: DsoOut[] = [];
  for (const csv of [main, addendum]) parseCatalogue(csv, out);

  // Brightest first: the renderer draws in array order and the events engine
  // walks the head of the list.
  return out.sort((a, b) => a.mag - b.mag);
}

function parseCatalogue(csv: string, out: DsoOut[]): void {
  const [headerLine, ...rows] = csv.split('\n').filter((l) => l.trim().length > 0);
  const header = headerLine.split(';');
  const col = (r: string[], k: string) => r[header.indexOf(k)] ?? '';

  for (const line of rows) {
    const r = line.split(';');
    const type = col(r, 'Type').trim();
    if (!TYPES[type]) continue;

    const vmag = Number.parseFloat(col(r, 'V-Mag'));
    const bmag = Number.parseFloat(col(r, 'B-Mag'));
    // B magnitudes run brighter than visual for most extended objects; the
    // 0.5 offset is the usual rough correction when only B is catalogued.
    const mag = Number.isFinite(vmag) ? vmag : Number.isFinite(bmag) ? bmag - 0.5 : NaN;
    if (!Number.isFinite(mag) || mag > DSO_MAG_LIMIT) continue;

    const raStr = col(r, 'RA').trim();
    const decStr = col(r, 'Dec').trim();
    if (!raStr || !decStr) continue;

    const [x, y, z] = unitVector(parseRaHms(raStr), parseDecDms(decStr));

    const maj = Number.parseFloat(col(r, 'MajAx'));
    const min = Number.parseFloat(col(r, 'MinAx'));
    const size = Number.isFinite(maj) ? maj : 0;
    const catSb = Number.parseFloat(col(r, 'SurfBr'));
    const sb = Number.isFinite(catSb)
      ? catSb
      : size > 0
        ? surfaceBrightness(mag, size, Number.isFinite(min) ? min : size)
        : 0;

    const messier = col(r, 'M').trim();
    const ngc = col(r, 'Name').trim();
    const common = col(r, 'Common names').split(',')[0].trim();

    out.push({
      id: messier ? `M${Number(messier)}` : tidyName(ngc),
      ngc: tidyName(ngc),
      name: common,
      type: TYPES[type],
      x: round(x, 7),
      y: round(y, 7),
      z: round(z, 7),
      mag: round(mag, 2),
      size: round(size, 2),
      sb: round(sb, 2),
      con: col(r, 'Const').trim(),
    });
  }
}

/** Mean surface brightness in mag/arcsec² for an ellipse of the given axes (arcmin). */
function surfaceBrightness(mag: number, majArcmin: number, minArcmin: number): number {
  const areaArcsec2 = Math.PI * (majArcmin * 30) * (minArcmin * 30);
  if (areaArcsec2 <= 0) return 0;
  return mag + 2.5 * Math.log10(areaArcsec2);
}

/** "IC0001" → "IC 1", "NGC0224" → "NGC 224". */
function tidyName(raw: string): string {
  const m = /^(NGC|IC)(\d+)(.*)$/.exec(raw);
  return m ? `${m[1]} ${Number(m[2])}${m[3]}` : raw;
}
