/**
 * The control bar (spec §9): location, date, time, Bortle. One compact row.
 *
 * The Bortle slider visibly dims the star field as it moves. It is the most
 * honest control in the app, because it shows what you will *actually* see
 * rather than what is theoretically there.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { loadCities, type CityTuple } from '../data/catalog';
import { localParts, zonedTimeToUtc, formatDate, HOUR, MINUTE } from '../astro/time';
import { useStore, timezoneFor } from '../state/store';
import { bortleBaseMag } from '../astro/twilight';

const BORTLE_NAMES = [
  '',
  'Excellent dark sky',
  'Typical truly dark site',
  'Rural sky',
  'Rural / suburban transition',
  'Suburban sky',
  'Bright suburban sky',
  'Suburban / urban transition',
  'City sky',
  'Inner-city sky',
];

export function Controls() {
  const site = useStore((s) => s.site);
  const instant = useStore((s) => s.instant);
  const setSite = useStore((s) => s.setSite);
  const setInstant = useStore((s) => s.setInstant);
  const nightMode = useStore((s) => s.nightMode);
  const setNightMode = useStore((s) => s.setNightMode);

  const local = useMemo(() => localParts(instant, site.timezone), [instant, site.timezone]);

  const dateValue = `${local.year}-${pad(local.month)}-${pad(local.day)}`;
  const timeValue = `${pad(local.hour)}:${pad(local.minute)}`;

  const applyDate = (value: string) => {
    const [y, m, d] = value.split('-').map(Number);
    if (!y || !m || !d) return;
    setInstant(zonedTimeToUtc({ ...local, year: y, month: m, day: d }, site.timezone));
  };

  const applyTime = (value: string) => {
    const [h, mi] = value.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(mi)) return;
    setInstant(zonedTimeToUtc({ ...local, hour: h, minute: mi, second: 0 }, site.timezone));
  };

  return (
    <div className="controls">
      <LocationPicker />

      <label className="control">
        <span className="control-label">Date</span>
        <input type="date" value={dateValue} onChange={(e) => applyDate(e.target.value)} className="mono" />
      </label>

      <label className="control">
        <span className="control-label">Time</span>
        <input type="time" value={timeValue} onChange={(e) => applyTime(e.target.value)} className="mono" />
      </label>

      <div className="control control-now">
        <button type="button" onClick={() => setInstant(Date.now())} title="Jump to now">
          Now
        </button>
        <button type="button" onClick={() => setInstant(instant - HOUR)} aria-label="One hour earlier">
          −1h
        </button>
        <button type="button" onClick={() => setInstant(instant + HOUR)} aria-label="One hour later">
          +1h
        </button>
      </div>

      <label className="control control-bortle">
        <span className="control-label">
          Bortle <b className="mono">{site.bortle}</b>
          <span className="control-hint">
            {BORTLE_NAMES[site.bortle]} · naked eye to mag {bortleBaseMag(site.bortle).toFixed(1)}
          </span>
        </span>
        <input
          type="range"
          min={1}
          max={9}
          step={1}
          value={site.bortle}
          onChange={(e) => setSite({ bortle: Number(e.target.value) })}
        />
      </label>

      <button
        type="button"
        className={`control-toggle${nightMode ? ' is-on' : ''}`}
        onClick={() => setNightMode(!nightMode)}
        aria-pressed={nightMode}
        title="Red light, to preserve dark adaptation"
      >
        Night vision
      </button>

      <span className="control-zone mono" title="Timezone resolved from the coordinates, offline">
        {site.timezone} · {formatDate(instant, site.timezone)}
      </span>
    </div>
  );
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Location entry. Geolocation if the browser offers it, an offline city search
 * otherwise, and raw coordinates for anyone who knows exactly where they are.
 */
function LocationPicker() {
  const site = useStore((s) => s.site);
  const setSite = useStore((s) => s.setSite);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cities, setCities] = useState<CityTuple[] | null>(null);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || cities) return;
    // 1.3 MB, so it is only fetched when somebody actually opens the search.
    loadCities().then(setCities);
  }, [open, cities]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const matches = useMemo(() => {
    if (!cities || query.trim().length < 2) return [];
    const q = query.trim().toLowerCase();
    const out: CityTuple[] = [];
    // Already sorted by population, so the first ten matches are the ten most
    // likely to be meant.
    for (const c of cities) {
      if (c[0].toLowerCase().startsWith(q)) {
        out.push(c);
        if (out.length === 10) break;
      }
    }
    return out;
  }, [cities, query]);

  const useGeolocation = () => {
    if (!navigator.geolocation) return;
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, altitude } = pos.coords;
        setSite({
          latitude,
          longitude,
          elevation: altitude ?? 0,
          timezone: timezoneFor(latitude, longitude),
          label: 'Current location',
        });
        setBusy(false);
        setOpen(false);
      },
      () => setBusy(false),
      { timeout: 10_000 },
    );
  };

  return (
    <div className="control control-location" ref={boxRef}>
      <span className="control-label">Location</span>
      <button type="button" className="location-button" onClick={() => setOpen(!open)} aria-expanded={open}>
        {site.label}
        <span className="mono location-coords">
          {formatCoord(site.latitude, 'NS')} {formatCoord(site.longitude, 'EW')}
        </span>
      </button>

      {open && (
        <div className="location-panel">
          <input
            autoFocus
            type="search"
            placeholder="Search 25,000 cities…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search for a city"
          />

          {query.trim().length >= 2 && cities === null && <p className="location-note">Loading cities…</p>}
          {query.trim().length >= 2 && cities !== null && matches.length === 0 && (
            <p className="location-note">Nothing found. Try fewer letters, or enter coordinates below.</p>
          )}

          <ul className="location-results">
            {matches.map((c) => (
              <li key={`${c[0]}-${c[1]}-${c[3]}-${c[4]}`}>
                <button
                  type="button"
                  onClick={() => {
                    setSite({
                      latitude: c[3],
                      longitude: c[4],
                      elevation: 0,
                      timezone: timezoneFor(c[3], c[4]),
                      label: `${c[0]}, ${c[1]}`,
                    });
                    setOpen(false);
                    setQuery('');
                  }}
                >
                  <span>{c[0]}</span>
                  <span className="location-meta mono">
                    {c[1]} · {c[5].toLocaleString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="location-manual">
            <label>
              <span>Latitude</span>
              <input
                type="number"
                step="0.0001"
                min={-90}
                max={90}
                className="mono"
                value={site.latitude}
                onChange={(e) => setSite({ latitude: clamp(Number(e.target.value), -90, 90), label: 'Custom location' })}
              />
            </label>
            <label>
              <span>Longitude</span>
              <input
                type="number"
                step="0.0001"
                min={-180}
                max={180}
                className="mono"
                value={site.longitude}
                onChange={(e) => setSite({ longitude: clamp(Number(e.target.value), -180, 180), label: 'Custom location' })}
              />
            </label>
            <label>
              <span>Elevation, m</span>
              <input
                type="number"
                step="10"
                className="mono"
                value={site.elevation}
                onChange={(e) => setSite({ elevation: Number(e.target.value) })}
              />
            </label>
          </div>

          {'geolocation' in navigator && (
            <button type="button" className="location-geo" onClick={useGeolocation} disabled={busy}>
              {busy ? 'Locating…' : 'Use my location'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo;
}

export function formatCoord(value: number, axes: 'NS' | 'EW'): string {
  const hemisphere = value >= 0 ? axes[0] : axes[1];
  return `${Math.abs(value).toFixed(3)}°${hemisphere}`;
}

export { MINUTE };
