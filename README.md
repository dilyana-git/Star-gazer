# Sidereal

**A local sky atlas: what's overhead, and what's worth going outside for.**

Given where you are, what day it is and what time it is, Sidereal answers two
questions:

1. *What is above me right now?* — a rendered sky with constellations, planets,
   Moon and the brighter deep-sky objects, correctly oriented for the horizon
   you are standing on.
2. *Is anything unusual happening?* — a ranked list of events, filtered to what
   is actually observable **from your location, on your date, at your
   light-pollution level**.

The second question is the product. Every planetarium app does the first. The
differentiator is a notability engine that knows the difference between "the
Moon rises tonight" (happens every night, score 0) and "the Moon occults
Antares during astronomical darkness at 40° altitude" (score 80, go outside).

---

## Running it

```sh
npm install
npm run build:catalogs   # once — fetches and reduces the source catalogues
npm run dev
```

`build:catalogs` writes to `src/data/generated/`, and those outputs are
committed, so a fresh checkout only needs `npm install && npm run dev`. Re-run
it when you want to refresh the catalogues; downloads are cached in `.cache/`.

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck and production build |
| `npm test` | The correctness suite — fast, hermetic, 140+ tests |
| `npm run test:e2e` | Builds, then drives a real browser: offline, permalinks, search, print |
| `npm run build:catalogs` | Rebuild the star, constellation, DSO, shower and city data |
| `npm run build:fonts` | Re-vendor the three typefaces into `public/fonts/` |

Everything is bundled. Once loaded, the app needs no network at all — no API
keys, no rate limits, nothing to go stale. It installs as a PWA and a service
worker precaches every catalogue, so it works with the network cut; there is an
end-to-end test that proves it, because the first version silently did not.

---

## How it fits together

```
src/
  astro/
    frames.ts        the coordinate pipeline: EQJ → HOR, refraction, separation
    twilight.ts      darkness, observing windows, limiting magnitude
    time.ts          the only place timezones exist
    objects.ts       one shared type for anything you can select
    events/          the notability engine — one module per detector
  render/
    project.ts       stereographic projection, full-sky and zoomed
    sky.ts           the Canvas 2D draw
    labels.ts        greedy label placement against an occupancy grid
    colors.ts        the palette, and star colour from B−V
  data/
    catalog.ts       loading the generated artifacts
    search.ts        the object index — names, designations, catalogue numbers
    generated/       build artifacts — committed, never fetched at runtime
  state/
    store.ts         the application state
    permalink.ts     the whole view, encoded into the URL hash
  ui/                three surfaces: the sky, the ribbon, the events panel
scripts/
  build-catalogs.ts  the data pipeline
  fetch-fonts.ts     vendors the three typefaces, so nothing loads from a CDN
vite.config.ts       also generates the offline service worker at build time
```

### The two things most likely to be wrong, and what stops them

**Precession.** The star catalogue is J2000 (EQJ); several convenience
functions in `astronomy-engine` expect coordinates of date (EQD). Feeding one to
the other costs about 0.35° at epoch 2026 — small enough to look plausible on
screen, large enough to be wrong, and growing 1.4° per century.
`tests/frames.test.ts` asserts that the correct path and the naive one differ by
exactly that much, so the mistake cannot be reintroduced as a "simplification".

**Mirroring.** A sky chart shows the dome from underneath. With north at the top
of the screen, **east is on the left** — the opposite of a ground map. Get it
wrong and everything renders plausibly but mirrored. There is an explicit test.

---

## Correctness

Two tiers, per the specification.

**Invariants** (`tests/frames.test.ts`, `tests/twilight.test.ts`) — derivable
from first principles, no external data needed, and between them they catch
nearly every real coordinate bug: Polaris at the observer's latitude,
circumpolarity, the equatorial↔horizontal round trip, the sidereal rate, solar
noon, equinox sunrise, the southern hemisphere, mirroring, and precession.

**Golden fixtures** (`fixtures/`) — externally sourced expected values. Empty at
present, with the reason and the shape recorded in `fixtures/README.md`: the
authorities the spec names are not reachable from this build environment, and a
fabricated fixture is worse than a missing one, because it passes forever and
proves nothing.

---

## Data and licensing

Every catalogue is fetched once by `scripts/build-catalogs.ts`, reduced, and
committed. See **[ATTRIBUTION.md](ATTRIBUTION.md)** for sources, licences and
obligations — several are share-alike, and that share-alike travels with the
generated data files rather than with this application's source.

See **[NOTES.md](NOTES.md)** for deviations from the specification, the source
substitutions forced by this environment's network policy, the modelling
decisions the spec left open, and the deliberate gaps — including why satellite
passes are not built.

---

## Out of scope

Named so they do not creep in: telescope control, mount alignment,
astrophotography planning, comets and asteroids beyond the brightest, variable
stars, seeing forecasts, weather, accounts, sync, posting to social platforms,
3D globes, VR, and anything astrological.

Sharing a *link* is in scope and built — it is a URL that encodes where and when,
with no account and nothing sent anywhere.
