/**
 * Permalinks (spec §11, Phase 4). Pure functions, so these are cheap and they
 * cover the case that matters: a link somebody edited, truncated or typed by
 * hand must degrade to the defaults rather than to an exception.
 */
import { describe, expect, it } from 'vitest';
import { decodePermalink, encodePermalink } from '../src/state/permalink';
import type { Site } from '../src/astro/types';

const SOFIA: Site = {
  latitude: 42.6977,
  longitude: 23.3219,
  elevation: 550,
  timezone: 'Europe/Sofia',
  label: 'Sofia, Bulgaria',
  bortle: 5,
};

const STATE = {
  site: SOFIA,
  instant: Date.UTC(2026, 0, 20, 19, 0, 0),
  view: { centreAltitude: 90, centreAzimuth: 0, fieldRadius: 90 },
};

describe('round trip', () => {
  it('preserves everything that decides what is on screen', () => {
    const back = decodePermalink(encodePermalink(STATE))!;

    expect(back.site!.latitude).toBeCloseTo(SOFIA.latitude, 4);
    expect(back.site!.longitude).toBeCloseTo(SOFIA.longitude, 4);
    expect(back.site!.elevation).toBe(550);
    expect(back.site!.bortle).toBe(5);
    expect(back.site!.label).toBe('Sofia, Bulgaria');
    expect(back.instant).toBe(STATE.instant);
    expect(back.view).toEqual(STATE.view);
  });

  it('re-derives the timezone from the coordinates rather than carrying it', () => {
    // Carrying the zone would let a hand-edited link disagree with itself.
    const back = decodePermalink(encodePermalink(STATE))!;
    expect(back.site!.timezone).toBe('Europe/Sofia');
    expect(encodePermalink(STATE)).not.toMatch(/Europe/);
  });

  it('survives a southern, western site', () => {
    const sydney: Site = { ...SOFIA, latitude: -33.8688, longitude: 151.2093, label: 'Sydney' };
    const santiago: Site = { ...SOFIA, latitude: -33.45, longitude: -70.66, label: 'Santiago' };

    for (const site of [sydney, santiago]) {
      const back = decodePermalink(encodePermalink({ ...STATE, site }))!;
      expect(back.site!.latitude).toBeCloseTo(site.latitude, 4);
      expect(back.site!.longitude).toBeCloseTo(site.longitude, 4);
    }
  });

  it('rounds the time to the second, because nobody shares a millisecond', () => {
    const back = decodePermalink(encodePermalink({ ...STATE, instant: STATE.instant + 400 }))!;
    expect(back.instant).toBe(STATE.instant);
  });
});

describe('the link itself', () => {
  it('stays readable, because these get pasted into messages', () => {
    const hash = encodePermalink(STATE);
    expect(hash).toContain('at=42.6977,23.3219,550');
    expect(hash).toContain('v=90,0,90');
    expect(hash).not.toContain('%2C');
  });

  it('is still a valid URL fragment that a browser round-trips', () => {
    const url = new URL(`https://example.com/${encodePermalink(STATE)}`);
    expect(decodePermalink(url.hash)!.instant).toBe(STATE.instant);
  });
});

describe('a link that has been damaged', () => {
  it('returns null for an empty hash', () => {
    expect(decodePermalink('')).toBeNull();
    expect(decodePermalink('#')).toBeNull();
  });

  it('ignores an impossible coordinate instead of accepting it', () => {
    expect(decodePermalink('#at=91,0,0')?.site).toBeUndefined();
    expect(decodePermalink('#at=0,181,0')?.site).toBeUndefined();
    expect(decodePermalink('#at=nonsense')?.site).toBeUndefined();
  });

  it('takes the parts it can read and drops the rest', () => {
    const partial = decodePermalink('#at=42.7,23.3&t=1768935600');
    expect(partial!.site!.latitude).toBeCloseTo(42.7, 4);
    expect(partial!.site!.elevation).toBe(0);
    expect(partial!.instant).toBe(1768935600 * 1000);
    expect(partial!.view).toBeUndefined();
  });

  it('clamps a Bortle class and a field radius into range', () => {
    expect(decodePermalink('#at=42.7,23.3,0&b=99')!.site!.bortle).toBe(9);
    expect(decodePermalink('#at=42.7,23.3,0&b=-4')!.site!.bortle).toBe(1);
    expect(decodePermalink('#v=0,0,999')!.view!.fieldRadius).toBe(90);
    expect(decodePermalink('#v=0,0,0.1')!.view!.fieldRadius).toBe(2);
  });

  it('normalises an out-of-range azimuth rather than rejecting it', () => {
    expect(decodePermalink('#v=45,450,30')!.view!.centreAzimuth).toBe(90);
    expect(decodePermalink('#v=45,-90,30')!.view!.centreAzimuth).toBe(270);
  });

  it('names an unlabelled shared location rather than leaving it blank', () => {
    expect(decodePermalink('#at=42.7,23.3,0')!.site!.label).toBe('Shared location');
  });
});
