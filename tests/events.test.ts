/**
 * The notability engine (spec §7), including the Phase 2 acceptance criteria.
 */
import { describe, expect, it } from 'vitest';
import * as A from 'astronomy-engine';
import { findEvents } from '../src/astro/events';
import { observedRate } from '../src/astro/events/showers';
import {
  ACCESSIBILITY,
  interferenceFrom,
  rarityFrom,
  RECURRENCE,
  score,
  visibilityFrom,
} from '../src/astro/events/scoring';
import { nightWindow } from '../src/astro/twilight';
import { localParts, DAY } from '../src/astro/time';
import type { Site } from '../src/astro/types';
import type { Shower } from '../src/data/catalog';

const SOFIA: Site = {
  latitude: 42.6977,
  longitude: 23.3219,
  elevation: 550,
  timezone: 'Europe/Sofia',
  label: 'Sofia, Bulgaria',
  bortle: 5,
};

const SYDNEY: Site = {
  ...SOFIA,
  latitude: -33.8688,
  longitude: 151.2093,
  timezone: 'Australia/Sydney',
  label: 'Sydney',
};

describe('rarity is the log of the recurrence interval', () => {
  // The table in spec §7.2, which is the specification of this function.
  it.each([
    ['Moon rises', 1, 0],
    ['Full moon', 29.5, 29],
    ['Major shower peak', 365, 51],
    ['Jupiter opposition', 399, 52],
    ['Mercury at greatest elongation', 116, 41],
    ['Bright planet conjunction under 1°', 5 * 365.25, 65],
    ['Total lunar eclipse at this site', 2.5 * 365.25, 59],
  ])('%s — %d days → about %d', (_label, days, expected) => {
    expect(Math.round(rarityFrom(days))).toBe(expected);
  });

  it('clamps a total solar eclipse to 100 rather than overflowing', () => {
    // 375 years works out at 102 before clamping.
    expect(rarityFrom(RECURRENCE.solarEclipseTotalLocal)).toBe(100);
  });
});

describe('visibility punishes low altitudes', () => {
  it('is zero below 10°, where airmass has taken the object', () => {
    expect(visibilityFrom(9.9)).toBe(0);
    expect(visibilityFrom(0)).toBe(0);
    expect(visibilityFrom(-20)).toBe(0);
  });

  it('rises with altitude and floors at 0.15', () => {
    expect(visibilityFrom(10)).toBeCloseTo(0.174, 2);
    expect(visibilityFrom(45)).toBeCloseTo(0.707, 2);
    expect(visibilityFrom(90)).toBeCloseTo(1, 5);
    expect(visibilityFrom(11)).toBeGreaterThanOrEqual(0.15);
  });
});

describe('accessibility encodes the audience assumption', () => {
  it('is 1.0 / 0.75 / 0.5 for naked eye, binoculars and telescope', () => {
    expect(ACCESSIBILITY['naked-eye']).toBe(1.0);
    expect(ACCESSIBILITY.binocular).toBe(0.75);
    expect(ACCESSIBILITY.telescope).toBe(0.5);
  });
});

describe('interference', () => {
  // A night with a full moon riding high, and one with no moon at all.
  const fullMoon = A.SearchMoonPhase(180, new Date(Date.UTC(2026, 11, 1)), 40)!.date.getTime();
  const newMoon = A.SearchMoonPhase(0, new Date(Date.UTC(2026, 11, 1)), 40)!.date.getTime();

  it('penalises a faint target under a full moon', () => {
    const faint = interferenceFrom({
      site: SOFIA,
      instant: fullMoon,
      targetAltitude: 60,
      targetMagnitude: 5,
    });
    expect(faint.value).toBeLessThan(0.65);
    expect(faint.notes.join(' ')).toMatch(/Moon is \d+% lit/);
  });

  it('barely troubles a bright one', () => {
    const bright = interferenceFrom({
      site: SOFIA,
      instant: fullMoon,
      targetAltitude: 60,
      targetMagnitude: -4,
    });
    const faint = interferenceFrom({
      site: SOFIA,
      instant: fullMoon,
      targetAltitude: 60,
      targetMagnitude: 5,
    });
    expect(bright.value).toBeGreaterThan(faint.value);
  });

  it('costs a lunar eclipse nothing, because the Moon is the target', () => {
    const eclipse = interferenceFrom({
      site: SOFIA,
      instant: fullMoon,
      targetAltitude: 60,
      targetMagnitude: -10,
      moonIsTarget: true,
    });
    expect(eclipse.value).toBeGreaterThan(0.95);
    expect(eclipse.notes.join(' ')).toMatch(/moonlight costs nothing/i);
  });

  it('is clean under a new moon in darkness', () => {
    const night = nightWindow(SOFIA, ...dateOf(newMoon));
    const dark = night.darkWindows[0];
    if (dark) {
      const clean = interferenceFrom({
        site: SOFIA,
        instant: (dark[0] + dark[1]) / 2,
        targetAltitude: 60,
        targetMagnitude: 5,
      });
      expect(clean.value).toBeGreaterThan(0.95);
    }
  });

  it('treats actual daylight as near-fatal, not as deep twilight', () => {
    // Noon at midsummer. A magnitude-0 planet is genuinely 60° up and genuinely
    // unfindable; a model that scores it well will recommend it.
    const noon = Date.UTC(2026, 5, 21, 10);
    const daylight = interferenceFrom({
      site: SOFIA,
      instant: noon,
      targetAltitude: 60,
      targetMagnitude: 0,
    });
    expect(daylight.value).toBeLessThan(0.35);
    expect(daylight.notes.join(' ')).toMatch(/Sun is up/i);
  });
});

describe('score multiplies the four factors and exposes all of them', () => {
  it('reports components that reproduce the score', () => {
    const result = score({
      recurrenceDays: RECURRENCE.showerPeak,
      bestAltitude: 60,
      equipment: 'naked-eye',
      interference: { value: 1, notes: [] },
    });
    const c = result.components;
    expect(Math.round(c.rarity * c.visibility * c.interference * c.accessibility)).toBe(result.score);
  });

  it('zeroes anything that never clears 10°, and says why', () => {
    const result = score({
      recurrenceDays: RECURRENCE.solarEclipseTotalLocal,
      bestAltitude: 4,
      equipment: 'naked-eye',
      interference: { value: 1, notes: [] },
    });
    expect(result.score).toBe(0);
    expect(result.components.notes[0]).toMatch(/too low/i);
  });

  it('always carries a recurrence interval the UI can put into words', () => {
    const result = score({
      recurrenceDays: RECURRENCE.jupiterOpposition,
      bestAltitude: 50,
      equipment: 'binocular',
      interference: { value: 0.8, notes: [] },
    });
    expect(result.components.recurrenceDays).toBe(RECURRENCE.jupiterOpposition);
  });
});

describe('the ZHR correction', () => {
  const perseids: Shower = {
    code: 'PER',
    name: 'Perseids',
    ra: 48.2,
    dec: 58.1,
    peak: 140,
    begin: 114.6,
    end: 151.3,
    zhr: 100,
    r: 2.2,
  };

  it('gives the full rate only at the zenith under a magnitude-6.5 sky', () => {
    expect(observedRate(perseids, 90, 6.5)).toBeCloseTo(100, 5);
  });

  it('halves it as the radiant drops to 30°', () => {
    expect(observedRate(perseids, 30, 6.5)).toBeCloseTo(50, 5);
  });

  it('is nothing with the radiant below the horizon', () => {
    expect(observedRate(perseids, -5, 6.5)).toBe(0);
  });

  it('collapses under a bright sky — this is the point of the correction', () => {
    // A ZHR-100 shower with the radiant at 15° under a moonlit suburban sky.
    const bad = observedRate(perseids, 15, 4.5);
    expect(bad).toBeLessThan(6);
    // The same shower, high, under a dark sky.
    expect(observedRate(perseids, 60, 6.5)).toBeGreaterThan(80);
  });
});

describe('§11 Phase 2 acceptance', () => {
  // August 2026 contains the Perseid peak, and that year it falls on a new moon.
  const from = Date.UTC(2026, 7, 1);
  const to = Date.UTC(2026, 8, 1);
  const events = findEvents(SOFIA, from, to);

  it('reports recurring events once per night, so any given night is complete', () => {
    // Saturn is well placed on every clear night in August, and the panel for
    // the 9th has to be able to say so. The detectors therefore emit one
    // occurrence per night and leave collapsing the repeats to the UI.
    const saturn = events.filter((e) => e.title === 'Saturn well placed');
    expect(saturn.length).toBeGreaterThan(5);
    const nights = new Set(saturn.map((e) => Math.floor(e.peak / DAY)));
    expect(nights.size).toBe(saturn.length);
  });

  it('is a list once collapsed, not a catalogue', () => {
    // What the reader actually sees: distinct things worth going out for.
    const distinct = new Set(events.map((e) => e.title));
    expect(distinct.size).toBeGreaterThan(5);
    expect(distinct.size).toBeLessThan(60);
  });

  it('gives a single night a short, readable list', () => {
    const oneNight = events.filter((e) => e.peak >= Date.UTC(2026, 7, 12) && e.peak < Date.UTC(2026, 7, 14));
    expect(oneNight.length).toBeGreaterThan(0);
    expect(oneNight.length).toBeLessThan(15);
  });

  it('contains no event that is below the horizon during darkness', () => {
    for (const event of events) {
      expect(event.bestAltitude).toBeGreaterThan(0);
    }
  });

  it('ranks the shower peak top in a month containing one', () => {
    expect(events[0].kind).toBe('shower');
    expect(events[0].title).toMatch(/Perseids/);
  });

  it('is sorted by score, descending', () => {
    for (let i = 1; i < events.length; i++) {
      expect(events[i].score).toBeLessThanOrEqual(events[i - 1].score);
    }
  });

  it('gives every event an inspectable breakdown and plain-language copy', () => {
    for (const event of events) {
      expect(event.components.notes.length).toBeGreaterThan(0);
      expect(event.detail.length).toBeGreaterThan(20);
      // The headline says what to look for, not what the numbers are (§7.4).
      expect(event.title).not.toMatch(/alt=|az=|Δ|CONJUNCTION:/);
      expect(event.window[1]).toBeGreaterThan(event.window[0]);
      expect(event.peak).toBeGreaterThanOrEqual(event.window[0] - DAY);
    }
  });

  it('works from the southern hemisphere too', () => {
    const southern = findEvents(SYDNEY, from, to);
    expect(southern.length).toBeGreaterThan(3);
    for (const event of southern) expect(event.bestAltitude).toBeGreaterThan(0);
    // The Perseid radiant barely clears the horizon from Sydney, so the
    // northern-hemisphere headline act should not be top of the list there.
    expect(southern[0].title).not.toMatch(/Perseids/);
  });

  it('finds the Geminids in December and ranks them top', () => {
    const december = findEvents(SOFIA, Date.UTC(2026, 11, 1), Date.UTC(2027, 0, 1));
    expect(december[0].kind).toBe('shower');
    expect(december[0].title).toMatch(/Geminids/);
  });
});

describe('a night with nothing in it is still handled', () => {
  it('returns an empty list rather than throwing at 69°N in June', () => {
    const tromso: Site = { ...SOFIA, latitude: 69.6496, longitude: 18.956, timezone: 'Europe/Oslo' };
    const events = findEvents(tromso, Date.UTC(2026, 5, 15), Date.UTC(2026, 5, 25));
    expect(Array.isArray(events)).toBe(true);
    // No astronomical darkness means nothing deep-sky, but the Moon and the
    // planets are still up there, so an empty list is fine and a crash is not.
    for (const event of events) expect(event.score).toBeGreaterThan(0);
  });
});

function dateOf(instant: number): [number, number, number] {
  const p = localParts(instant, SOFIA.timezone);
  return [p.year, p.month, p.hour < 12 ? p.day - 1 : p.day];
}
