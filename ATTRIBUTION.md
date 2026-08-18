# Attribution

Sidereal bundles reduced copies of several public astronomical catalogues. The
obligations below attach to the **generated data files** in `src/data/generated/`,
not to the application source. Where a licence is share-alike, that share-alike
travels with the derived data file.

| Asset | File(s) | Source | Licence | Obligation |
|---|---|---|---|---|
| Stars | `stars.bin`, `stars.meta.json` | HYG database (Hipparcos / Yale Bright Star / Gliese), via the [d3-celestial](https://github.com/ofrohn/d3-celestial) reduction by Olaf Frohn | HYG: CC BY-SA 4.0 · d3-celestial: BSD-3-Clause | Attribute HYG and d3-celestial; **share-alike applies to `stars.bin` and `stars.meta.json`** |
| Constellation lines | `constellations.modern.json` | [Stellarium](https://stellarium.org) `modern` skyculture | Stellarium is GPL-2; the maintainers have stated the western line figures may also be used under MIT | Attribute Stellarium. **Line figures only — no constellation artwork is included or permitted here** (the illustrations are separately licensed and require clearance from Johan Meuris) |
| Constellation boundaries | `boundaries.modern.json` | IAU boundaries (Delporte, epoch B1875), as distributed by Stellarium from P. Barbier's `edges_18.txt`, precessed to J2000 by our build script | Permission-based; not a blanket open licence | Attribute the IAU / Delporte boundary data and Stellarium. **Verify before commercial use** |
| Deep sky objects | `dsos.json` | [OpenNGC](https://github.com/mattiaverga/OpenNGC) by Mattia Verga | CC BY-SA 4.0 | Attribute OpenNGC; **share-alike applies to `dsos.json`** |
| Milky Way outlines | `milkyway.json` | [d3-celestial](https://github.com/ofrohn/d3-celestial) isophote outlines by Olaf Frohn | BSD-3-Clause | Retain the copyright notice |
| Cities | `cities.json` | [GeoNames](https://www.geonames.org), via the [cities-json](https://github.com/lmfmaier/cities-json) mirror | CC BY 4.0 | Attribute GeoNames |
| Meteor showers | `showers.json` | IMO Working List of Visual Meteor Showers, hand-authored (`src/data/source/showers.json`) | Facts; attributed as a courtesy | Attribute the International Meteor Organization |
| Ephemeris | (library) | [astronomy-engine](https://github.com/cosinekitty/astronomy) by Don Cross | MIT | Attribute in the licences file |
| Timezones | (library) | [tz-lookup](https://github.com/darkskyapp/tz-lookup) | CC0 / MIT | — |

## Full notices

**d3-celestial** — Copyright (c) 2015, Olaf Frohn. All rights reserved.
Redistributed under the BSD 3-Clause License. Neither the name of the copyright
holder nor the names of its contributors may be used to endorse or promote
products derived from this software without specific prior written permission.

**HYG database** — Compiled by David Nash / Astronexus from the Hipparcos, Yale
Bright Star and Gliese catalogues. Licensed CC BY-SA 4.0.

**Stellarium** — Constellation figures from the `modern` skyculture. Stellarium
is free software under the GNU GPL v2 or later. The `modern_st` skyculture is
deliberately *not* used: its shapes derive from Sky & Telescope, a commercial
source with less clear redistribution provenance.

**IAU constellation boundaries** — Originally defined by Eugène Delporte (1930)
along coordinate lines of epoch B1875, digitised by A. C. Davenhall and
S. K. Leggett (Royal Observatory Edinburgh, 1989). Some prior redistributions
describe these as "used with permission"; that qualification is recorded here
and carried forward.

**OpenNGC** — Copyright Mattia Verga, licensed CC BY-SA 4.0.

**GeoNames** — Licensed under Creative Commons Attribution 4.0.

**astronomy-engine** — Copyright (c) 2019-2023 Don Cross. MIT License.
