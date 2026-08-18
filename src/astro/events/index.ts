/**
 * The notability engine (spec §7). Everything else in the app is a viewer.
 *
 * Each detector is a module exporting `detect(ctx)`. They are independent by
 * design: a detector that throws is a detector that is missing from the list,
 * not an app that fails to load.
 */
import type { Detector, SkyEvent } from './types';
import type { Instant, Site } from '../types';

import { detectConjunctions } from './conjunctions';
import { detectShowers } from './showers';
import { detectEclipses } from './eclipses';
import { detectElongations } from './elongations';
import { detectLunar } from './lunar';
import { detectDsos } from './dso';

const DETECTORS: Array<[string, Detector]> = [
  ['conjunctions', detectConjunctions],
  ['showers', detectShowers],
  ['eclipses', detectEclipses],
  ['elongations', detectElongations],
  ['lunar', detectLunar],
  ['dso', detectDsos],
];

/** Ranked, most notable first. */
export function findEvents(site: Site, from: Instant, to: Instant): SkyEvent[] {
  const ctx = { site, from, to };
  const events: SkyEvent[] = [];

  for (const [name, detect] of DETECTORS) {
    try {
      events.push(...detect(ctx));
    } catch (error) {
      // One bad detector should cost its own events and nothing else.
      console.error(`[sidereal] the ${name} detector failed`, error);
    }
  }

  return events
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score || a.peak - b.peak);
}

export type { SkyEvent } from './types';
