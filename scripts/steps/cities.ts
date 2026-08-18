/**
 * Cities for offline location entry (spec §3.6). Reduced to the largest
 * ~25,000 settlements and emitted as a compact tuple array — an array of
 * objects at this length costs about three times as much over the wire.
 *
 * Timezone is not stored: tz-lookup resolves it from lat/lon at runtime and is
 * already a dependency, so carrying an IANA string per row would be dead weight.
 */
import { fetchJson } from '../lib/fetch-cache.js';
import { round } from '../lib/sphere.js';
import { SOURCES } from '../sources.js';

export const CITY_LIMIT = 25_000;

interface RawCity {
  name: string;
  country: string;
  admin1: string;
  lat: string;
  lon: string;
  pop: string;
}

/** [name, countryCode, admin1, lat, lon, population] */
export type CityTuple = [string, string, string, number, number, number];

export async function buildCities(): Promise<CityTuple[]> {
  const raw = await fetchJson<RawCity[]>(SOURCES.cities.url);

  return raw
    .map((c) => ({ ...c, popN: Number.parseInt(c.pop, 10) || 0 }))
    .filter((c) => c.name && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lon)))
    .sort((a, b) => b.popN - a.popN)
    .slice(0, CITY_LIMIT)
    .map(
      (c): CityTuple => [
        c.name,
        c.country,
        c.admin1 ?? '',
        round(Number(c.lat), 4),
        round(Number(c.lon), 4),
        c.popN,
      ],
    );
}
