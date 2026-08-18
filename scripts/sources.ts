/**
 * Every external source the catalogue build touches, in one place, with the
 * licence and the substitution note where the spec's first-choice source was
 * unreachable. See ATTRIBUTION.md for the obligations and NOTES.md §1 for why
 * the substitutions were made.
 */
export const SOURCES = {
  stars: {
    url: 'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/stars.8.json',
    name: 'd3-celestial stars.8.json (HYG-derived, mag ≤ 8)',
    licence: 'BSD-3-Clause (Olaf Frohn); underlying data HYG / Hipparcos',
    note: 'Spec §3.1 asks for HYG v4.2 from codeberg.org, which this build environment cannot reach (egress policy). d3-celestial ships the same HYG reduction with HIP id, magnitude and B−V.',
  },
  starNames: {
    url: 'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/starnames.json',
    name: 'd3-celestial starnames.json',
    licence: 'BSD-3-Clause (Olaf Frohn)',
  },
  skyculture: {
    // Stellarium's "modern" skyculture is the plain western one. `modern_st`
    // is deliberately avoided (spec §3.2): its shapes derive from Sky & Telescope.
    url: (id: string) =>
      `https://raw.githubusercontent.com/Stellarium/stellarium/master/skycultures/${id}/index.json`,
    name: 'Stellarium skyculture index.json',
    licence: 'Line figures usable under MIT per the Stellarium maintainers; artwork NOT included',
  },
  dsos: {
    url: 'https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv',
    addendumUrl:
      'https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/addendum.csv',
    name: 'OpenNGC NGC.csv + addendum.csv',
    licence: 'CC BY-SA 4.0 (Mattia Verga)',
  },
  milkyway: {
    url: 'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/milkyway.json',
    name: 'd3-celestial milkyway.json (isophote outlines)',
    licence: 'BSD-3-Clause (Olaf Frohn)',
  },
  cities: {
    url: 'https://raw.githubusercontent.com/lmfmaier/cities-json/master/cities500.json',
    name: 'cities-json cities500.json (GeoNames-derived)',
    licence: 'CC BY 4.0 (GeoNames)',
    note: 'Spec §3.6 asks for GeoNames cities5000 from download.geonames.org, unreachable from this build environment (egress policy). This mirror carries the same GeoNames fields plus population.',
  },
} as const;

/** Skycultures to bundle. The pipeline is generic; v1 ships western only. */
export const SKYCULTURES = [{ id: 'modern', label: 'Western' }] as const;
