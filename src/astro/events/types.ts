/** The notability engine's public shape (spec §7.1). */
import type { Instant, Site } from '../types';

export type EventKind =
  | 'conjunction'
  | 'occultation'
  | 'shower'
  | 'lunar-eclipse'
  | 'solar-eclipse'
  | 'elongation'
  | 'opposition'
  | 'planet-well-placed'
  | 'moon-phase'
  | 'supermoon'
  | 'terminator'
  | 'dso';

export type Equipment = 'naked-eye' | 'binocular' | 'telescope';

/**
 * Why something scored what it did. Non-negotiable: the UI must be able to
 * explain a 72, and a scoring model you cannot inspect is a scoring model you
 * cannot tune.
 */
export interface ScoreBreakdown {
  /** 0–100, from the typical recurrence interval. */
  rarity: number;
  /** Recurrence interval the rarity came from, in days. */
  recurrenceDays: number;
  /** 0–1, from the best altitude reached during the window. */
  visibility: number;
  /** 0–1, penalty for moonlight and twilight weighted by how faint the target is. */
  interference: number;
  /** 0–1, from the equipment needed. */
  accessibility: number;
  /** Human-readable one-liners, in the order they should be shown. */
  notes: string[];
}

export interface SkyEvent {
  id: string;
  kind: EventKind;
  /** "Moon occults Antares" — what to look for. */
  title: string;
  /** One sentence, plain language, no coordinates. */
  detail: string;
  /** Numbers, for the secondary line. Tabular figures applied by CSS. */
  data: string;
  peak: Instant;
  /** When it is observable from this site. */
  window: [Instant, Instant];
  /** Degrees at the best moment within the window. */
  bestAltitude: number;
  bestAzimuth: number;
  equipment: Equipment;
  /** 0–100. */
  score: number;
  components: ScoreBreakdown;
}

export interface DetectorContext {
  site: Site;
  from: Instant;
  to: Instant;
}

export type Detector = (ctx: DetectorContext) => SkyEvent[];
