/**
 * Where, when and how dark — as a full-height sheet rather than a control bar.
 *
 * On a phone there is no room for a row of controls above the sky, and the sky
 * is what you came for. These live behind one tap on the status line instead,
 * with every target at least 44px so they can be hit one-handed in the dark.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { loadCities, type CityTuple } from '../data/catalog';
import { formatDate, localParts, zonedTimeToUtc, HOUR } from '../astro/time';
import { bortleBaseMag } from '../astro/twilight';
import { timezoneFor, useStore } from '../state/store';

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

export function ControlsSheet({ onClose }: { onClose(): void }) {
  const site = useStore((s) => s.site);
  const instant = useStore((s) => s.instant);
  const setSite = useStore((s) => s.setSite);
  const setInstant = useStore((s) => s.setInstant);
  const nightMode = useStore((s) => s.nightMode);
  const setNightMode = useStore((s) => s.setNightMode);
  const permalink = useStore((s) => s.permalink);

  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const local = useMemo(() => localParts(instant, site.timezone), [instant, site.timezone]);
  const pad = (n: number) => String(n).padStart(2, '0');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="controls-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="controls-sheet" role="dialog" aria-label="Location, time and sky" ref={panelRef} tabIndex={-1}>
        <div className="controls-sheet-head">
          <h2>Where and when</h2>
          <button type="button" className="tap-target controls-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <CityPicker />

        <label className="field">
          <span className="field-label">Date</span>
          <input
            type="date"
            className="mono tap-target"
            value={`${local.year}-${pad(local.month)}-${pad(local.day)}`}
            onChange={(e) => {
              const [y, m, d] = e.target.value.split('-').map(Number);
              if (y && m && d) setInstant(zonedTimeToUtc({ ...local, year: y, month: m, day: d }, site.timezone));
            }}
          />
        </label>

        <label className="field">
          <span className="field-label">Time</span>
          <input
            type="time"
            className="mono tap-target"
            value={`${pad(local.hour)}:${pad(local.minute)}`}
            onChange={(e) => {
              const [h, mi] = e.target.value.split(':').map(Number);
              if (!Number.isNaN(h) && !Number.isNaN(mi)) {
                setInstant(zonedTimeToUtc({ ...local, hour: h, minute: mi, second: 0 }, site.timezone));
              }
            }}
          />
        </label>

        <div className="field-row">
          <button type="button" className="tap-target" onClick={() => setInstant(Date.now())}>
            Now
          </button>
          <button type="button" className="tap-target" onClick={() => setInstant(instant - HOUR)}>
            −1 hour
          </button>
          <button type="button" className="tap-target" onClick={() => setInstant(instant + HOUR)}>
            +1 hour
          </button>
        </div>

        <label className="field">
          <span className="field-label">
            Light pollution — Bortle <b>{site.bortle}</b>
          </span>
          <span className="field-hint">
            {BORTLE_NAMES[site.bortle]} · naked eye to magnitude {bortleBaseMag(site.bortle).toFixed(1)}
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
          className={`tap-target wide${nightMode ? ' is-on' : ''}`}
          aria-pressed={nightMode}
          onClick={() => setNightMode(!nightMode)}
        >
          {nightMode ? 'Night vision on' : 'Night vision — red light'}
        </button>

        <div className="field-row">
          <button
            type="button"
            className="tap-target"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(permalink());
                setCopied(true);
                setTimeout(() => setCopied(false), 2200);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? 'Link copied' : 'Copy link'}
          </button>
          <button type="button" className="tap-target" onClick={() => window.print()}>
            Print plan
          </button>
        </div>

        <p className="controls-foot mono">
          {site.timezone} · {formatDate(instant, site.timezone)}
        </p>
      </div>
    </div>
  );
}

function CityPicker() {
  const site = useStore((s) => s.site);
  const setSite = useStore((s) => s.setSite);

  const [query, setQuery] = useState('');
  const [cities, setCities] = useState<CityTuple[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2 || cities) return;
    loadCities().then(setCities);
  }, [query, cities]);

  const matches = useMemo(() => {
    if (!cities || query.trim().length < 2) return [];
    const q = query.trim().toLowerCase();
    const out: CityTuple[] = [];
    for (const c of cities) {
      if (c[0].toLowerCase().startsWith(q)) {
        out.push(c);
        if (out.length === 8) break;
      }
    }
    return out;
  }, [cities, query]);

  const locate = () => {
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
      },
      () => setBusy(false),
      { timeout: 10_000, enableHighAccuracy: true },
    );
  };

  return (
    <div className="field">
      <span className="field-label">Location — {site.label}</span>

      {'geolocation' in navigator && (
        <button type="button" className="tap-target wide" onClick={locate} disabled={busy}>
          {busy ? 'Locating…' : 'Use my location'}
        </button>
      )}

      <input
        type="search"
        className="tap-target"
        placeholder="…or search a city"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search for a city"
      />

      {query.trim().length >= 2 && cities === null && <p className="field-hint">Loading cities…</p>}

      {matches.length > 0 && (
        <ul className="city-results">
          {matches.map((c) => (
            <li key={`${c[0]}-${c[1]}-${c[3]}-${c[4]}`}>
              <button
                type="button"
                className="tap-target"
                onClick={() => {
                  setSite({
                    latitude: c[3],
                    longitude: c[4],
                    elevation: 0,
                    timezone: timezoneFor(c[3], c[4]),
                    label: `${c[0]}, ${c[1]}`,
                  });
                  setQuery('');
                }}
              >
                <span>{c[0]}</span>
                <span className="mono city-meta">{c[1]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
