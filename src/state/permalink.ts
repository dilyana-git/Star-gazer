/**
 * Shareable permalinks (spec §11, Phase 4).
 *
 * The whole view — where, when, how dark, and which way you are looking — lives
 * in the URL hash. Send someone the link and they see the sky you saw.
 *
 * The hash rather than the query string, so a static host never sees it and no
 * server round-trip is needed to honour it. Short keys, because these get
 * pasted into messages.
 */
import type { Instant, Site } from '../astro/types';
import type { SkyViewState } from '../render/sky';
import { timezoneFor } from './store';

export interface PermalinkState {
  site: Site;
  instant: Instant;
  view: SkyViewState;
}

/**
 * `#at=42.6977,23.3219,550&b=5&t=1768935600&v=90,0,90&l=Sofia,%20Bulgaria`
 *
 * The timezone is not encoded: it follows from the coordinates, and carrying it
 * would let a stale link disagree with itself.
 */
export function encodePermalink(state: PermalinkState): string {
  const { site, instant, view } = state;
  const params = new URLSearchParams();

  params.set('at', [round(site.latitude, 4), round(site.longitude, 4), Math.round(site.elevation)].join(','));
  params.set('b', String(site.bortle));
  // Seconds, not milliseconds: nobody shares a link to a particular millisecond.
  params.set('t', String(Math.round(instant / 1000)));
  params.set(
    'v',
    [round(view.centreAltitude, 1), round(view.centreAzimuth, 1), round(view.fieldRadius, 1)].join(','),
  );
  if (site.label) params.set('l', site.label);

  // Commas are legal in a fragment (RFC 3986 sub-delims) and URLSearchParams
  // percent-encodes them anyway. These links get pasted into messages, so it is
  // worth spending a line to keep them readable — `at=42.6977,23.3219,550`
  // rather than `at=42.6977%2C23.3219%2C550`. Both decode identically.
  return `#${params.toString().replace(/%2C/g, ',')}`;
}

/**
 * Parse a hash back into state. Returns only the parts that were present and
 * well-formed — a truncated or hand-edited link degrades to the defaults rather
 * than to an error.
 */
export function decodePermalink(hash: string): Partial<PermalinkState> | null {
  const raw = hash.replace(/^#/, '');
  if (!raw) return null;

  const params = new URLSearchParams(raw);
  const out: Partial<PermalinkState> = {};

  const at = numbers(params.get('at'), 2);
  if (at) {
    const [latitude, longitude, elevation] = at;
    if (Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
      out.site = {
        latitude,
        longitude,
        elevation: Number.isFinite(elevation) ? elevation : 0,
        timezone: timezoneFor(latitude, longitude),
        label: params.get('l') || 'Shared location',
        bortle: clamp(Number(params.get('b')) || 5, 1, 9),
      };
    }
  }

  const seconds = Number(params.get('t'));
  if (Number.isFinite(seconds) && seconds !== 0) out.instant = seconds * 1000;

  const v = numbers(params.get('v'), 3);
  if (v) {
    out.view = {
      centreAltitude: clamp(v[0], -30, 90),
      centreAzimuth: ((v[1] % 360) + 360) % 360,
      fieldRadius: clamp(v[2], 2, 90),
    };
  }

  return Object.keys(out).length > 0 ? out : null;
}

function numbers(value: string | null, minimum: number): number[] | null {
  if (!value) return null;
  const parts = value.split(',').map(Number);
  if (parts.length < minimum || parts.slice(0, minimum).some((n) => !Number.isFinite(n))) return null;
  return parts;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
