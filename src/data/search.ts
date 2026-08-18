/**
 * Object search (spec §11, Phase 3).
 *
 * An index over everything the chart can draw: named stars, Bayer and Flamsteed
 * designations, deep sky objects under all their catalogue names, the planets,
 * the Sun and Moon, and the constellations under both their Latin and English
 * names.
 *
 * The index is positions-free — it is built once from the catalogues and holds
 * no site or instant. A hit is resolved to an actual place in the sky only when
 * it is chosen, which is what lets the same index serve any date the scrubber
 * lands on.
 */
import * as A from 'astronomy-engine';
import { altAzOfVector, describePlanet, PLANET_NAMES, type SkyObject } from '../astro/objects';
import { bodyVectorEqj } from '../astro/frames';
import type { Instant, Site, Vec3 } from '../astro/types';
import type { SkyData } from './catalog';

export interface SearchHit {
  /** What is shown in the result row. */
  label: string;
  /** Secondary line — designation, catalogue number, magnitude. */
  hint: string;
  kind: SkyObject['kind'];
  /** Lower sorts first among equally good matches: brightness, mostly. */
  rank: number;
  /** Every string this entry should match on, lowercased. */
  terms: string[];
  resolve(site: Site, instant: Instant): SkyObject;
}

/** Build the index. Cheap enough to do once on load; memoised by identity. */
export function buildSearchIndex(data: SkyData): SearchHit[] {
  const hits: SearchHit[] = [];

  // ── the Sun, the Moon and the planets ─────────────────────────────────────
  hits.push({
    label: 'The Sun',
    hint: 'Our star',
    kind: 'sun',
    rank: -30,
    terms: ['sun', 'sol', 'the sun'],
    resolve: (site, instant) => ({
      kind: 'sun',
      name: 'The Sun',
      detail: 'Our star. Never look at it through binoculars or a telescope.',
      ...altAzOfBodyAt(site, instant, A.Body.Sun),
    }),
  });

  hits.push({
    label: 'The Moon',
    hint: 'Earth’s satellite',
    kind: 'moon',
    rank: -29,
    terms: ['moon', 'luna', 'the moon'],
    resolve: (site, instant) => {
      const illum = A.Illumination(A.Body.Moon, new Date(instant));
      return {
        kind: 'moon',
        name: 'The Moon',
        detail: `${Math.round(illum.phase_fraction * 100)}% lit`,
        ...altAzOfBodyAt(site, instant, A.Body.Moon),
      };
    },
  });

  for (const [body, name] of PLANET_NAMES) {
    hits.push({
      label: name,
      hint: 'Planet',
      kind: 'planet',
      rank: -28,
      terms: [name.toLowerCase()],
      resolve: (site, instant) => ({
        kind: 'planet',
        name,
        detail: describePlanet(body, instant),
        ...altAzOfBodyAt(site, instant, body),
      }),
    });
  }

  // ── stars ─────────────────────────────────────────────────────────────────
  const { mag, xyz } = data.stars;
  for (const [key, meta] of Object.entries(data.starMeta)) {
    const i = Number(key);
    const terms: string[] = [];
    if (meta.n) terms.push(meta.n.toLowerCase());
    if (meta.b) {
      terms.push(meta.b.toLowerCase());
      if (meta.c) terms.push(`${meta.b} ${meta.c}`.toLowerCase());
      const latin = GREEK_TO_LATIN[meta.b];
      // "alpha Ori" should find α Ori — few people can type a Greek letter.
      if (latin) {
        terms.push(latin);
        if (meta.c) terms.push(`${latin} ${meta.c}`.toLowerCase());
      }
    }
    if (meta.f && meta.c) terms.push(`${meta.f} ${meta.c}`.toLowerCase());
    terms.push(`hip ${meta.h}`);
    if (terms.length === 0) continue;

    const designation = [
      meta.b ? `${meta.b} ${meta.c ?? ''}`.trim() : null,
      meta.f ? `${meta.f} ${meta.c ?? ''}`.trim() : null,
      `HIP ${meta.h}`,
    ]
      .filter(Boolean)
      .join(' · ');

    const v: Vec3 = [xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2]];
    const m = mag[i];

    hits.push({
      label: meta.n ?? designation.split(' · ')[0],
      hint: `${designation} — magnitude ${m.toFixed(2)}`,
      kind: 'star',
      // Brighter stars win ties, and named ones beat bare designations.
      rank: m + (meta.n ? -2 : 0),
      terms,
      resolve: (site, instant) => ({
        kind: 'star',
        name: meta.n ?? designation.split(' · ')[0],
        detail: `${designation} — magnitude ${m.toFixed(2)}`,
        index: i,
        ...altAzOfVector(site, instant, v),
      }),
    });
  }

  // ── deep sky ──────────────────────────────────────────────────────────────
  for (const dso of data.dsos) {
    const terms = [dso.id.toLowerCase(), dso.ngc.toLowerCase()];
    if (dso.name) terms.push(dso.name.toLowerCase());
    // "M31" and "m 31" should both work.
    terms.push(dso.id.toLowerCase().replace(/\s+/g, ''), dso.ngc.toLowerCase().replace(/\s+/g, ''));

    const v: Vec3 = [dso.x, dso.y, dso.z];
    const detail = `${dso.id}${dso.ngc !== dso.id ? ` · ${dso.ngc}` : ''} — ${dso.type}, magnitude ${dso.mag.toFixed(1)}${
      dso.size ? `, ${dso.size >= 60 ? `${(dso.size / 60).toFixed(1)}°` : `${dso.size.toFixed(0)}′`} across` : ''
    }`;

    hits.push({
      label: dso.name || dso.id,
      hint: detail,
      kind: 'dso',
      rank: dso.mag,
      terms,
      resolve: (site, instant) => ({
        kind: 'dso',
        name: dso.name || dso.id,
        detail,
        ...altAzOfVector(site, instant, v),
      }),
    });
  }

  // ── constellations ────────────────────────────────────────────────────────
  for (const c of data.constellations) {
    const v = c.labelAt as Vec3;
    hits.push({
      label: c.native,
      hint: `Constellation — ${c.name}`,
      kind: 'constellation',
      rank: 8,
      terms: [c.native.toLowerCase(), c.name.toLowerCase(), c.id.toLowerCase()],
      resolve: (site, instant) => ({
        kind: 'constellation',
        name: c.native,
        detail:
          c.name === c.native
            ? `The whole figure spans about ${Math.round(c.extent * 2)}° of sky.`
            : `“${c.name}” — the whole figure spans about ${Math.round(c.extent * 2)}° of sky.`,
        ...altAzOfVector(site, instant, v),
      }),
    });
  }

  return hits;
}

function altAzOfBodyAt(site: Site, instant: Instant, body: A.Body) {
  return altAzOfVector(site, instant, bodyVectorEqj(body, instant, site));
}

/**
 * Rank matches for a query.
 *
 * A term that *starts with* the query beats one that merely contains it, and
 * within each band the brighter object wins. That is enough to put Vega first
 * for "veg" and M31 first for "m31" without any scoring machinery.
 */
export function search(index: SearchHit[], query: string, limit = 12): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  // People type "M 31" and "m31" and "NGC869" interchangeably, so whitespace is
  // matched on both sides. Each entry already carries a squashed form of its
  // catalogue names for the other direction.
  const squashed = q.replace(/\s+/g, '');
  const forms = squashed === q ? [q] : [q, squashed];

  const scored: Array<{ hit: SearchHit; band: number }> = [];
  for (const hit of index) {
    let band = 3;
    for (const term of hit.terms) {
      for (const form of forms) {
        if (term === form) {
          band = 0;
          break;
        }
        if (term.startsWith(form)) band = Math.min(band, 1);
        else if (term.includes(form)) band = Math.min(band, 2);
      }
      if (band === 0) break;
    }
    if (band < 3) scored.push({ hit, band });
  }

  return scored
    .sort((a, b) => a.band - b.band || a.hit.rank - b.hit.rank)
    .slice(0, limit)
    .map((s) => s.hit);
}

/** Greek letters spelled out, so "alpha Cen" finds α Cen. */
const GREEK_TO_LATIN: Record<string, string> = {
  α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', ζ: 'zeta',
  η: 'eta', θ: 'theta', ι: 'iota', κ: 'kappa', λ: 'lambda', μ: 'mu',
  ν: 'nu', ξ: 'xi', ο: 'omicron', π: 'pi', ρ: 'rho', σ: 'sigma',
  τ: 'tau', υ: 'upsilon', φ: 'phi', χ: 'chi', ψ: 'psi', ω: 'omega',
};
