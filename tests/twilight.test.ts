/**
 * Darkness and observing windows (spec §6). The degenerate cases matter more
 * than the ordinary ones — an app that silently renders an empty list at 65°N
 * in June is worse than one that says "no astronomical darkness tonight".
 */
import { describe, expect, it } from 'vitest';
import {
  bortleBaseMag,
  darkness,
  intervalsAboveHorizon,
  limitingMagnitude,
  nightWindow,
  nightWindowFor,
  dropSlivers,
  subtract,
  totalDuration,
} from '../src/astro/twilight';
import { formatTime, localNoon, localParts, zonedTimeToUtc, zoneOffsetMs, DAY, HOUR } from '../src/astro/time';
import * as A from 'astronomy-engine';
import { bodyAltAz } from '../src/astro/frames';
import type { Site } from '../src/astro/types';

const SOFIA: Site = {
  latitude: 42.6977,
  longitude: 23.3219,
  elevation: 550,
  timezone: 'Europe/Sofia',
  label: 'Sofia, Bulgaria',
  bortle: 5,
};

const TROMSO: Site = { ...SOFIA, latitude: 69.6496, longitude: 18.956, timezone: 'Europe/Oslo', label: 'Tromsø' };
const ROVANIEMI: Site = { ...SOFIA, latitude: 65.0, longitude: 25.7, timezone: 'Europe/Helsinki', label: '65°N' };
const SYDNEY: Site = { ...SOFIA, latitude: -33.8688, longitude: 151.2093, timezone: 'Australia/Sydney', label: 'Sydney' };

describe('time is stored in UTC and localised only at the edges', () => {
  it('applies the standard-time offset', () => {
    // 15 January, Sofia is UTC+2.
    expect(zoneOffsetMs(Date.UTC(2026, 0, 15, 12), 'Europe/Sofia')).toBe(2 * HOUR);
  });

  it('applies the summer-time offset — the "sky is an hour wrong in summer" bug', () => {
    // 15 July, Sofia is UTC+3.
    expect(zoneOffsetMs(Date.UTC(2026, 6, 15, 12), 'Europe/Sofia')).toBe(3 * HOUR);
  });

  it('round-trips wall-clock time through UTC across a DST boundary', () => {
    for (const [month, day] of [[0, 15], [6, 15], [2, 29], [9, 25]] as const) {
      const parts = { year: 2026, month: month + 1, day, hour: 21, minute: 30, second: 0 };
      const utc = zonedTimeToUtc(parts, 'Europe/Sofia');
      const back = localParts(utc, 'Europe/Sofia');
      expect(back.hour).toBe(21);
      expect(back.minute).toBe(30);
      expect(back.day).toBe(day);
    }
  });

  it('puts local noon at 12:00 local, whatever the offset', () => {
    for (const [m, d] of [[0, 15], [6, 15]] as const) {
      expect(formatTime(localNoon(2026, m + 1, d, 'Europe/Sofia'), 'Europe/Sofia')).toBe('12:00');
    }
  });
});

describe('an ordinary night at a mid-latitude site', () => {
  const n = nightWindow(SOFIA, 2026, 3, 15); // 15 April 2026

  it('produces every event, in order', () => {
    const sequence = [
      n.sunset,
      n.civilDusk,
      n.nauticalDusk,
      n.astronomicalDusk,
      n.astronomicalDawn,
      n.civilDawn,
      n.sunrise,
    ];
    for (const t of sequence) expect(t).not.toBeNull();
    for (let i = 1; i < sequence.length; i++) {
      expect(sequence[i]!).toBeGreaterThan(sequence[i - 1]!);
    }
  });

  it('runs noon to noon, so an 01:00 event is on the right night', () => {
    expect(formatTime(n.bounds[0], SOFIA.timezone)).toBe('12:00');
    expect(n.bounds[1] - n.bounds[0]).toBe(DAY);
    expect(n.sunset!).toBeGreaterThan(n.bounds[0]);
    expect(n.sunrise!).toBeLessThan(n.bounds[1]);
  });

  it('has real astronomical darkness and no complaint to make', () => {
    expect(n.astronomicalNight.length).toBe(1);
    expect(totalDuration(n.astronomicalNight)).toBeGreaterThan(2 * HOUR);
    expect(n.darknessNote).toBeNull();
  });

  it('puts the sun below −18° through the whole dark window', () => {
    for (const [s, e] of n.astronomicalNight) {
      for (const t of [s + 60_000, (s + e) / 2, e - 60_000]) {
        expect(darkness(SOFIA, t)).toBeCloseTo(1, 2);
      }
    }
  });

  it('assigns the small hours to the night that is still in progress', () => {
    // 02:00 on the 16th belongs to the night of the 15th.
    const smallHours = zonedTimeToUtc({ year: 2026, month: 4, day: 16, hour: 2, minute: 0, second: 0 }, SOFIA.timezone);
    expect(nightWindowFor(SOFIA, smallHours).date).toBe('2026-04-15');

    const evening = zonedTimeToUtc({ year: 2026, month: 4, day: 16, hour: 22, minute: 0, second: 0 }, SOFIA.timezone);
    expect(nightWindowFor(SOFIA, evening).date).toBe('2026-04-16');
  });
});

describe('degenerate cases, stated rather than swallowed', () => {
  it('65°N in June has no astronomical darkness, and says so', () => {
    const n = nightWindow(ROVANIEMI, 2026, 6, 20);
    expect(n.astronomicalDusk).toBeNull();
    expect(n.astronomicalNight).toEqual([]);
    expect(n.darkWindows).toEqual([]);
    expect(n.darknessNote).toMatch(/no astronomical darkness/i);
  });

  it('inside the Arctic circle in June the Sun does not set at all', () => {
    const n = nightWindow(TROMSO, 2026, 6, 20);
    expect(n.sunset).toBeNull();
    expect(n.sunrise).toBeNull();
    expect(n.darkWindows).toEqual([]);
    expect(n.darknessNote).toMatch(/does not set/i);
  });

  it('and in December the same site gets darkness all day', () => {
    const n = nightWindow(TROMSO, 2026, 12, 20);
    expect(totalDuration(n.astronomicalNight)).toBeGreaterThan(6 * HOUR);
  });

  it('the southern hemisphere gets its long nights in June, not December', () => {
    const june = totalDuration(nightWindow(SYDNEY, 2026, 6, 20).astronomicalNight);
    const december = totalDuration(nightWindow(SYDNEY, 2026, 12, 20).astronomicalNight);
    expect(june).toBeGreaterThan(december);
  });
});

describe('the Moon is subtracted from the dark window', () => {
  it('a full moon that is up all night leaves no dark window', () => {
    // Find a full moon, then look at that night from Sofia. A full moon rises
    // at sunset and sets at sunrise, so it covers the whole of darkness.
    const full = A.SearchMoonPhase(180, new Date(Date.UTC(2026, 5, 1)), 40)!;
    const p = localParts(full.date.getTime(), SOFIA.timezone);
    const n = nightWindow(SOFIA, p.year, p.month, p.hour < 12 ? p.day - 1 : p.day);

    expect(n.moonIllumination).toBeGreaterThan(0.94);
    expect(totalDuration(n.astronomicalNight)).toBeGreaterThan(0);
    expect(totalDuration(n.darkWindows)).toBeLessThan(totalDuration(n.astronomicalNight) * 0.25);
  });

  it('a new moon leaves the dark window intact', () => {
    const nw = A.SearchMoonPhase(0, new Date(Date.UTC(2026, 5, 1)), 40)!;
    const p = localParts(nw.date.getTime(), SOFIA.timezone);
    const n = nightWindow(SOFIA, p.year, p.month, p.hour < 12 ? p.day - 1 : p.day);

    expect(n.moonIllumination).toBeLessThan(0.06);
    expect(totalDuration(n.darkWindows)).toBeCloseTo(totalDuration(n.astronomicalNight), -5);
  });

  it('reports moon-up intervals that really do have the Moon up', () => {
    const n = nightWindow(SOFIA, 2026, 8, 5);
    expect(n.moonUp.length).toBeGreaterThan(0);

    for (const [s, e] of n.moonUp) {
      // Up in the middle...
      expect(bodyAltAz(A.Body.Moon, (s + e) / 2, SOFIA).altitude).toBeGreaterThan(0);
      // ...and down just outside, unless the interval is clipped by the night's
      // own noon-to-noon bounds.
      if (s > n.bounds[0] + 60_000) {
        expect(bodyAltAz(A.Body.Moon, s - 5 * 60_000, SOFIA).altitude).toBeLessThan(0.5);
      }
      if (e < n.bounds[1] - 60_000) {
        expect(bodyAltAz(A.Body.Moon, e + 5 * 60_000, SOFIA).altitude).toBeLessThan(0.5);
      }
    }
  });
});

describe('limiting magnitude', () => {
  it('follows the published Bortle ladder, not an interpolation', () => {
    expect(bortleBaseMag(1)).toBeCloseTo(7.8, 5);
    expect(bortleBaseMag(9)).toBeCloseTo(4.0, 5);
    for (let b = 2; b <= 9; b++) expect(bortleBaseMag(b)).toBeLessThan(bortleBaseMag(b - 1));
  });

  it('clamps out-of-range classes rather than returning undefined', () => {
    expect(bortleBaseMag(0)).toBe(bortleBaseMag(1));
    expect(bortleBaseMag(42)).toBe(bortleBaseMag(9));
  });

  it('is unpenalised when the Moon is down', () => {
    const n = nightWindow(SOFIA, 2026, 8, 5);
    const dark = n.darkWindows[0];
    if (dark) {
      const mid = (dark[0] + dark[1]) / 2;
      expect(limitingMagnitude(SOFIA, mid)).toBeCloseTo(bortleBaseMag(SOFIA.bortle), 6);
    }
  });

  it('loses up to two magnitudes to a high full moon', () => {
    const full = A.SearchMoonPhase(180, new Date(Date.UTC(2026, 11, 1)), 40)!;
    // Around midnight on the night of a December full moon the Moon rides high
    // from Sofia, so the penalty is close to its maximum.
    const t = full.date.getTime();
    const penalty = bortleBaseMag(SOFIA.bortle) - limitingMagnitude(SOFIA, t);
    expect(penalty).toBeGreaterThan(0);
    expect(penalty).toBeLessThanOrEqual(2.0001);
  });
});

describe('the Sun caps what is visible, whatever the light pollution', () => {
  it('leaves almost nothing at midday', () => {
    // 13:00 local at midsummer, Sun near 70°.
    const noon = zonedTimeToUtc({ year: 2026, month: 6, day: 21, hour: 13, minute: 0, second: 0 }, SOFIA.timezone);
    expect(limitingMagnitude(SOFIA, noon)).toBeLessThanOrEqual(-4);
  });

  it('lets the first stars out at civil dusk and more at nautical', () => {
    const n = nightWindow(SOFIA, 2026, 4, 15);
    const civil = limitingMagnitude(SOFIA, n.civilDusk!);
    const nautical = limitingMagnitude(SOFIA, n.nauticalDusk!);
    const astronomical = limitingMagnitude(SOFIA, n.astronomicalDusk!);

    expect(civil).toBeCloseTo(1.0, 1);
    expect(nautical).toBeCloseTo(4.0, 1);
    expect(astronomical).toBeCloseTo(bortleBaseMag(SOFIA.bortle), 1);
    expect(civil).toBeLessThan(nautical);
    expect(nautical).toBeLessThan(astronomical);
  });

  it('stops capping once astronomical night arrives, leaving Bortle in charge', () => {
    const n = nightWindow(SOFIA, 2026, 4, 15);
    const dark = n.astronomicalNight[0];
    const mid = (dark[0] + dark[1]) / 2;
    // Moonless at this point in the test's chosen night, or nearly so — the cap
    // must not be the binding constraint either way.
    expect(limitingMagnitude(SOFIA, mid)).toBeGreaterThan(4.5);
  });
});

describe('interval arithmetic', () => {
  it('subtracts an overlapping interval', () => {
    expect(subtract([[0, 100]], [[40, 60]])).toEqual([
      [0, 40],
      [60, 100],
    ]);
  });

  it('drops an interval swallowed whole', () => {
    expect(subtract([[0, 100]], [[-10, 200]])).toEqual([]);
  });

  it('ignores intervals that do not touch', () => {
    expect(subtract([[0, 100]], [[200, 300]])).toEqual([[0, 100]]);
  });

  it('leaves slivers to the caller to discard', () => {
    // `subtract` stays a pure set operation. What counts as too short to bother
    // going outside for is a judgement, and it belongs where that judgement is
    // made, not baked into interval arithmetic.
    expect(subtract([[0, 100]], [[10, 100]])).toEqual([[0, 10]]);
    expect(dropSlivers([[0, 10]], 60)).toEqual([]);
    expect(dropSlivers([[0, 100]], 60)).toEqual([[0, 100]]);
  });
});
