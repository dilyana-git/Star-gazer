/**
 * Application state. Small, no ceremony.
 *
 * The one invariant worth restating: `instant` is UTC epoch milliseconds, and
 * `site.timezone` is only ever consulted by formatters and by the date/time
 * input. Nothing here stores a local time.
 */
import { create } from 'zustand';
import tzlookup from 'tz-lookup';
import type { Instant, Site } from '../astro/types';
import { DEFAULT_LAYERS, FULL_SKY, type SkyLayers, type SkyViewState, type PickTarget } from '../render/sky';
import { DAY } from '../astro/time';

/** Historical range, per the §14.2 decision: ±100 years around now. */
export const RANGE_YEARS = 100;

const DEFAULT_SITE: Site = {
  latitude: 42.6977,
  longitude: 23.3219,
  elevation: 550,
  timezone: 'Europe/Sofia',
  label: 'Sofia, Bulgaria',
  bortle: 5,
};

export interface AppState {
  site: Site;
  instant: Instant;
  view: SkyViewState;
  layers: SkyLayers;
  /** Red-light mode, to preserve dark adaptation in the field. */
  nightMode: boolean;
  selected: PickTarget | null;
  /** The event the user is currently looking at, if any. */
  focusedEventId: string | null;

  setSite(site: Partial<Site>): void;
  setInstant(instant: Instant): void;
  nudgeInstant(ms: number): void;
  setView(view: Partial<SkyViewState>): void;
  lookAt(altitude: number, azimuth: number, fieldRadius?: number): void;
  resetView(): void;
  toggleLayer(layer: keyof SkyLayers): void;
  setNightMode(on: boolean): void;
  select(target: PickTarget | null): void;
  focusEvent(id: string | null): void;
}

const STORAGE_KEY = 'sidereal:v1';

interface Persisted {
  site: Site;
  layers: SkyLayers;
  nightMode: boolean;
}

function loadPersisted(): Partial<Persisted> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<Persisted>) : {};
  } catch {
    return {};
  }
}

function persist(state: AppState): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ site: state.site, layers: state.layers, nightMode: state.nightMode }),
    );
  } catch {
    // Private browsing, quota, whatever. Persistence is a nicety.
  }
}

export function clampInstant(t: Instant): Instant {
  const now = Date.now();
  const span = RANGE_YEARS * 365.25 * DAY;
  return Math.max(now - span, Math.min(now + span, t));
}

/** Resolve the IANA zone for a coordinate, offline. */
export function timezoneFor(latitude: number, longitude: number): string {
  try {
    return tzlookup(latitude, longitude);
  } catch {
    // tz-lookup throws for a handful of ocean coordinates.
    return 'UTC';
  }
}

const stored = loadPersisted();

export const useStore = create<AppState>((set, get) => ({
  site: { ...DEFAULT_SITE, ...stored.site },
  instant: Date.now(),
  view: { ...FULL_SKY },
  layers: { ...DEFAULT_LAYERS, ...stored.layers },
  nightMode: stored.nightMode ?? false,
  selected: null,
  focusedEventId: null,

  setSite(patch) {
    const site = { ...get().site, ...patch };
    // A new coordinate implies a new zone unless the caller supplied one.
    if ((patch.latitude !== undefined || patch.longitude !== undefined) && patch.timezone === undefined) {
      site.timezone = timezoneFor(site.latitude, site.longitude);
    }
    set({ site });
    persist(get());
  },

  setInstant(instant) {
    set({ instant: clampInstant(instant) });
  },

  nudgeInstant(ms) {
    set({ instant: clampInstant(get().instant + ms) });
  },

  setView(patch) {
    set({ view: { ...get().view, ...patch } });
  },

  lookAt(altitude, azimuth, fieldRadius) {
    set({
      view: {
        centreAltitude: Math.max(-30, Math.min(90, altitude)),
        centreAzimuth: ((azimuth % 360) + 360) % 360,
        fieldRadius: fieldRadius ?? Math.min(get().view.fieldRadius, 35),
      },
    });
  },

  resetView() {
    set({ view: { ...FULL_SKY } });
  },

  toggleLayer(layer) {
    set({ layers: { ...get().layers, [layer]: !get().layers[layer] } });
    persist(get());
  },

  setNightMode(on) {
    set({ nightMode: on });
    persist(get());
  },

  select(target) {
    set({ selected: target });
  },

  focusEvent(id) {
    set({ focusedEventId: id });
  },
}));
