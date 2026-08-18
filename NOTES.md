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

## 4. Modelling decisions the spec left open

Where §7's model needed a number the spec did not give, the choice and its
reasoning are here rather than buried in a constant.

**Rarity is about the recurrence of an event *of this notability*, not of that
name.** Two consequences:

- *Meteor showers are graded by what they deliver*, via
  `showerRecurrence(observedRate)`. Any given shower peaks annually, but "a
  display worth setting an alarm for" is not an annual event and "a handful an
  hour" is not a yearly one — there are a score of those. Without the grading a
  ZHR-5 shower scored level with the Geminids.
- *Moon conjunctions are monthly, not five-yearly.* The Moon laps the zodiac
  every 27 days, so it passes each planet and each bright ecliptic star once a
  lunation. Scored against the planet–planet interval, a routine Moon–Jupiter
  pairing outranked the Geminids.
- *A "supermoon" recurs three or four times a year*, not once, and differs from
  an ordinary full moon by 7% of diameter. §7.3 is explicit that lunar events
  are context rather than alarms, and this is the number that keeps one below a
  major shower.

**Events are evaluated at their best *observable* moment, not their
astronomical peak.** Greatest elongation and closest approach land wherever they
land, very often at two in the afternoon. Reporting that moment's altitude
tells the reader Mercury was 63° up — true, and useless, because the Sun was up
too. `bestObservableMoment` finds the part of the bracket that is dark with the
target above the horizon and evaluates there; conjunctions and elongations with
no such moment are dropped rather than listed with a daylight altitude.

**Actual daylight is not deep twilight.** The interference term grades twilight
by how faint the target is, but floors the loss at 0.6 once the Sun is above the
horizon. Without that floor the model rated a magnitude-0 planet 70% as good at
noon as at midnight, and happily recommended it.

**The Sun caps the limiting magnitude.** `twilightCap` holds the naked-eye limit
at about −4 in daylight, 1 at civil dusk, 4 at nautical dusk, and lifts it
entirely once astronomical night arrives. The same honesty that makes the Bortle
slider worth having applies at four in the afternoon: a chart drawing nine
thousand stars at midday tells the reader something false.

**Recurring events are emitted per night and collapsed by the UI.** Saturn
really is well placed on every clear night for months, and tonight's panel has
to be able to say so for tonight. Which repeats to hide is a presentation
decision that only the panel — which knows what night is on screen — can make.

**Deep-sky reachability uses surface brightness, not magnitude, for extended
objects.** A magnitude-8 galaxy spread over 20 arcminutes has its light smeared
over four hundred times the area of a magnitude-8 point source. Point-like
objects are still gated on magnitude.

## 5. Test gaps

Per §12.2, a fabricated fixture is worse than a missing one. Gaps as they stand:

- **JPL Horizons planetary fixtures** — `ssd.jpl.nasa.gov` is not reachable from
  this environment, so no externally-sourced topocentric alt/az fixtures could
  be retrieved. The §12.1 invariant suite (which is derivable and needs no
  external data) is implemented in full, and it is the tier that catches
  coordinate bugs. `fixtures/README.md` records what to add and how.
- **USNO / timeanddate rise-set fixtures** — same reason, same gap.
- **NASA eclipse-catalogue fixtures** — same reason. Eclipse detection leans
  directly on the library's own `SearchLunarEclipse` and
  `SearchLocalSolarEclipse`, which carry their own upstream test suite; what is
  tested here is our handling of the result, not the ephemeris.

## 6. Phase status (spec §11)

| Phase | State |
|---|---|
| 0 — Data | Complete. `npm run build:catalogs` runs clean from an empty `generated/`; counts, magnitude range and file sizes asserted in `tests/catalogs.test.ts`. |
| 1 — The sky | Complete. The §12.1 invariant suite passes in full. Verified by eye against known positions for Sofia on 20 January 2026: Orion and Sirius due south, Leo rising in the east *on the left*, Polaris at the observer's latitude, cardinal points on the ring. |
| 2 — Events | Complete. Both acceptance criteria assert in `tests/events.test.ts`: no event is below the horizon during darkness, and the top-scored event for August 2026 is the Perseid peak (December's is the Geminids). |
| 3 — Depth | Mostly delivered alongside Phases 1–2: object detail cards, tap-to-identify, the DSO layer and the Milky Way band are all in. **Search is not** — the location search exists, but there is no object search. |
| 4 — Optional | Not started. No satellites, no PWA install, no permalinks, no printable night plan. |
