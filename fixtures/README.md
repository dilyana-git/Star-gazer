# Golden fixtures

Externally-sourced expected values for the §12.2 correctness tier. Every entry
must record `source`, `retrievedOn`, `query` and the expected values, so a
failing test can be traced back to an authority rather than to somebody's guess.

**Nothing here is invented.** Per spec §12.2, a fabricated fixture is worse than
a missing one — it passes forever and proves nothing.

## Current state: empty, and why

The authorities the spec names are not reachable from this build environment
(the egress proxy denies them):

| Needed | Authority | Status |
|---|---|---|
| Topocentric alt/az for planets | JPL Horizons — https://ssd.jpl.nasa.gov/horizons/ | unreachable |
| Rise / set / twilight times | USNO Astronomical Applications, or timeanddate.com | unreachable |
| Eclipse circumstances | NASA eclipse catalogue | unreachable |

The §12.1 invariant tier — which needs no external data and catches nearly every
real coordinate bug — is implemented in full in `tests/frames.test.ts` and
`tests/twilight.test.ts`.

## Adding a fixture

Drop a JSON file here shaped like:

```json
{
  "source": "JPL Horizons",
  "retrievedOn": "2026-08-18",
  "query": "Target: Jupiter; Center: coord@399, 23.3219,42.6977,0.55km; 2026-Aug-18 22:00 UTC",
  "site": { "latitude": 42.6977, "longitude": 23.3219, "elevation": 550 },
  "instant": "2026-08-18T22:00:00Z",
  "expect": { "altitude": 31.42, "azimuth": 154.88 }
}
```

Tolerances, per spec: **0.05°** for positions, **60 s** for event times.
