# Build notes

Deviations from the specification, substitutions forced by the environment, and
gaps deliberately left open. Kept current as phases land.

---

## 1. Data source substitutions (spec §3)

This build environment routes all outbound HTTPS through a policy-enforcing
proxy. Two of the spec's named hosts are **not permitted** by that policy and
return `403` on `CONNECT`:

- `codeberg.org` — the current home of the HYG database (§3.1)
- `download.geonames.org` — GeoNames `cities5000` (§3.6)

Neither is a transient failure, so both were substituted with GitHub-hosted
mirrors of the same underlying data. Every substitution is declared in
`scripts/sources.ts` with its own `note` field, and the licence obligations
travel with the data (see `ATTRIBUTION.md`).

| Spec asks for | Used instead | Consequence |
|---|---|---|
| HYG v4.2, `mag ≤ 6.5`, keeping `hip, proper, bayer, flam, con, ra, dec, mag, ci, dist, spect` | d3-celestial `stars.8.json` + `starnames.json` (the same HYG reduction) | **`dist` and `spect` are not available** in this mirror. Nothing in Phases 0–2 reads them. `pmra`/`pmdec` are likewise absent, so the §5.2 note about retaining proper motions "in the source parse" cannot be honoured — a future "sky in 10,000 years" mode would need the real HYG file. Star count lands at **8,874**, matching the spec's ~9,000 estimate. |
| GeoNames `cities5000` with `timezone` | `cities-json` `cities500.json` (GeoNames-derived), top 25,000 by population | No `timezone` column. This costs nothing: `tz-lookup` is already a dependency and resolves IANA zones from lat/lon offline, which is what §4 specifies anyway. |
| Stellarium `western` skyculture `constellationship.fab` | Stellarium `modern` skyculture `index.json` | The `.fab` format has been retired upstream; `modern` **is** the plain western skyculture (and is not `modern_st`, which §3.2 warns against). `index.json` carries the same HIP-pair line figures, plus the IAU boundary edges, in one file. Artwork is present in the source file and is **not** extracted. |
| ROE / VizieR VI/49 boundaries, precessed B1875 → J2000 | Stellarium's `edges` array (P. Barbier's `edges_18.txt`, the same Delporte data), precessed by our build script | Same data, same epoch, same obligation. Precession **is** applied: each edge is subdivided along its own constant-RA or constant-Dec line *in the B1875 frame* and every sample point is rotated to J2000. Mean displacement across the 781 edges is **1.279°**, consistent with the ~1.5° the spec warns about. Asserted in `tests/catalogs.test.ts`. |

**Meteor showers** (§3.5) are hand-authored as the spec directs, in
`src/data/source/showers.json`. `imo.net` is also unreachable from this
environment, so the figures are transcribed from the published IMO Working List
rather than fetched. The marginal showers (JBO, PHO, AMO, DLM, PUP) carry the
least confidence; the major ones (QUA, LYR, ETA, PER, ORI, GEM, URS) are
well-established. Flagged in the file's own `_verify` field.

## 2. astronomy-engine API (spec §2)

The spec warned that its function names were written from memory. They were
checked against the shipped `astronomy.d.ts` (v2.1.x) and **every name the spec
guesses at exists as written**:

- `Rotation_EQJ_HOR(time, observer)` and `RotateVector(rotation, vector)` — the
  §5.1 "correct approach", used verbatim.
- `SearchRiseSet`, `SearchAltitude`, `SearchHourAngle`, `Illumination`,
  `SearchMoonPhase`, `SearchLunarApsis`, `SearchMaxElongation`,
  `SearchRelativeLongitude`, `SearchLunarEclipse`, `SearchLocalSolarEclipse`,
  `SearchSunLongitude`, `Refraction`, `Constellation`.

One substitution was needed and is noted here: `Rotation_EQD_EQJ` is used to
precess the B1875 boundaries. It rotates from the *true* equator of date, so it
carries B1875 nutation along with precession — under 20 arcseconds, two orders
of magnitude below the arcminute tier this app targets.

`SearchLocalSolarEclipse` **does** return local circumstances including
obscuration, so the §7.3 fallback ("report only visible: yes/no") was not
needed.

## 3. Open decisions (spec §14) — as answered

1. **Mobile priority** — desktop-first and responsive, *plus* a red night-vision
   mode. Device orientation input and phone-first touch targets are out.
2. **Historical range** — ±100 years around now. The time controls clamp to it.
3. **Sky cultures** — the data pipeline is generic over Stellarium skycultures
   (`SKYCULTURES` in `scripts/sources.ts` is a list, and the artifacts are
   emitted per-culture as `constellations.<id>.json`). v1 bundles western only.
4. **The name** — *Sidereal* is kept.

## 4. Test gaps

Per §12.2, a fabricated fixture is worse than a missing one. Gaps as they stand:

- **JPL Horizons planetary fixtures** — `ssd.jpl.nasa.gov` is not reachable from
  this environment, so no externally-sourced topocentric alt/az fixtures could
  be retrieved. The §12.1 invariant suite (which is derivable and needs no
  external data) is implemented in full, and it is the tier that catches
  coordinate bugs. `fixtures/README.md` records what to add and how.
- **USNO / timeanddate rise-set fixtures** — same reason, same gap.
- **NASA eclipse-catalogue fixtures** — same reason. Eclipse detection is
  covered by an internal consistency test (the eclipse the library finds is
  cross-checked against the Moon's phase and the observer's local circumstances)
  rather than against a published time.
