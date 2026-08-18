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
import { DEFAULT_LAYERS, FULL_SKY, type SkyLayers, type SkyViewState } from '../render/sky';
import type { SkyObject } from '../astro/objects';
import { DAY } from '../astro/time';
import { decodePermalink, encodePermalink, type PermalinkState } from './permalink';

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
  selected: SkyObject | null;
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
  select(target: SkyObject | null): void;
  focusEvent(id: string | null): void;
  /** The current view as a shareable URL. */
  permalink(): string;
  /** Adopt a shared link's site, time and view. */
  applyPermalink(state: Partial<PermalinkState>): void;
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

/**
 * A permalink outranks anything remembered locally: somebody followed a link to
 * see a particular sky, and showing them their own last session instead would
 * be ignoring what they clicked.
 */
const shared = typeof location !== 'undefined' ? decodePermalink(location.hash) : null;

export const useStore = create<AppState>((set, get) => ({
  site: { ...DEFAULT_SITE, ...stored.site, ...shared?.site },
  instant: shared?.instant ?? Date.now(),
  view: { ...FULL_SKY, ...shared?.view },
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

  permalink() {
    const { site, instant, view } = get();
    return `${location.origin}${location.pathname}${encodePermalink({ site, instant, view })}`;
  },

  applyPermalink(shared) {
    if (!shared) return;
    set({
      site: shared.site ? { ...get().site, ...shared.site } : get().site,
      instant: shared.instant != null ? clampInstant(shared.instant) : get().instant,
      view: shared.view ?? get().view,
      // A shared link is a new place and a new time; whatever was selected
      // belonged to the old one.
      selected: null,
      focusedEventId: null,
    });
    persist(get());
  },
}));

/**
 * Keep the address bar in step with the state, without flooding the history:
 * `replaceState` rather than `pushState`, so the back button still leaves the
 * app instead of walking back through every second of a scrub.
 */
export function syncPermalinkToUrl(): () => void {
  let frame = 0;
  const write = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const { site, instant, view } = useStore.getState();
      const hash = encodePermalink({ site, instant, view });
      if (hash !== location.hash) history.replaceState(null, '', hash);
    });
  };

  /**
   * Someone pasting a shared link while the app is already open is a
   * same-document navigation: the page does not reload, so reading the hash
   * once at startup would silently ignore it. `replaceState` does not fire this
   * event, so there is no loop with our own writes.
   */
  const read = () => {
    const shared = decodePermalink(location.hash);
    if (shared) useStore.getState().applyPermalink(shared);
  };

  write();
  const unsubscribe = useStore.subscribe(write);
  window.addEventListener('hashchange', read);

  return () => {
    cancelAnimationFrame(frame);
    unsubscribe();
    window.removeEventListener('hashchange', read);
  };
}
