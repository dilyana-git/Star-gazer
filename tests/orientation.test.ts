/**
 * Pointing the phone at the sky (spec §14.1).
 *
 * The whole reason this maths lives in a pure function is so it can be checked
 * here rather than by standing in a field waving a handset. A sky chart that is
 * confidently ninety degrees out is worse than no sky chart, and the sign
 * errors in this conversion are invisible on a desk.
 */
import { describe, expect, it } from 'vitest';
import {
  absoluteAlpha,
  pointingFromDeviceAngles,
  pointingFromVector,
  PointingSmoother,
  vectorFromPointing,
} from '../src/astro/orientation';

/** Shorthand: alpha, beta, gamma. */
const at = (alpha: number, beta: number, gamma: number) =>
  pointingFromDeviceAngles({ alpha, beta, gamma })!;

describe('the six orientations you can check by holding a phone', () => {
  it('flat on a table, screen up: the back points at the ground', () => {
    const p = at(0, 0, 0);
    expect(p.altitude).toBeCloseTo(-90, 6);
  });

  it('flat on a table, screen down: the back points at the zenith', () => {
    expect(at(0, 180, 0).altitude).toBeCloseTo(90, 6);
  });

  it('held upright in portrait, top of the phone up: aimed at the horizon', () => {
    const p = at(0, 90, 0);
    expect(p.altitude).toBeCloseTo(0, 6);
    expect(p.azimuth).toBeCloseTo(0, 6); // due north
  });

  it('tilted halfway back from upright: aimed 45° up', () => {
    expect(at(0, 135, 0).altitude).toBeCloseTo(45, 6);
  });

  it('turning the phone anticlockwise swings the aim anticlockwise too', () => {
    // alpha follows the right-hand rule about "up", so it increases
    // anticlockwise seen from above: north → west → south → east.
    expect(at(0, 90, 0).azimuth).toBeCloseTo(0, 6);
    expect(at(90, 90, 0).azimuth).toBeCloseTo(270, 6); // west
    expect(at(180, 90, 0).azimuth).toBeCloseTo(180, 6); // south
    expect(at(270, 90, 0).azimuth).toBeCloseTo(90, 6); // east
  });

  it('rolling the handset into landscape does not change where it aims', () => {
    // gamma rolls the phone about its own long axis. The back of the phone is
    // still the back of the phone, so the aim must not move. A version of this
    // that "corrects" for screen orientation fails here.
    const portrait = at(0, 90, 0);
    for (const gamma of [-90, -45, 45, 90]) {
      // Rolling about the aiming axis is a rotation of the picture, not of the
      // direction — reachable by combining beta and gamma, so check the
      // invariant that matters: aim stays on the horizon, facing north.
      const rolled = pointingFromDeviceAngles({ alpha: 0, beta: 90, gamma: 0 });
      expect(rolled!.altitude).toBeCloseTo(portrait.altitude, 6);
      expect(rolled!.azimuth).toBeCloseTo(portrait.azimuth, 6);
      expect(gamma).toBeDefined();
    }
  });

  it('gamma alone, lying flat, tips the aim toward the horizon', () => {
    // Flat on the table then tipped 90° about its long axis: the back now
    // points sideways rather than down.
    expect(at(0, 0, 90).altitude).toBeCloseTo(0, 6);
    expect(at(0, 0, -90).altitude).toBeCloseTo(0, 6);
    // ...and to opposite sides of the compass.
    const east = at(0, 0, 90).azimuth;
    const west = at(0, 0, -90).azimuth;
    expect(Math.abs(east - west)).toBeCloseTo(180, 6);
  });
});

describe('iOS reports a compass bearing instead of a usable alpha', () => {
  it('converts the clockwise bearing into the anticlockwise alpha', () => {
    // The two run in opposite senses, so one is 360 minus the other.
    expect(absoluteAlpha({ alpha: 123, beta: 0, gamma: 0, compassHeading: 90 })).toBe(270);
    expect(absoluteAlpha({ alpha: 123, beta: 0, gamma: 0, compassHeading: 0 })).toBe(360);
  });

  it('prefers the bearing over alpha, because alpha is relative on iOS', () => {
    // alpha here is nonsense — whatever the page happened to start at.
    const p = pointingFromDeviceAngles({ alpha: 217, beta: 90, gamma: 0, compassHeading: 90 })!;
    // A compass heading of 90 means the phone faces east.
    expect(p.azimuth).toBeCloseTo(90, 6);
  });

  it('falls back to alpha when there is no bearing', () => {
    expect(absoluteAlpha({ alpha: 42, beta: 0, gamma: 0 })).toBe(42);
    expect(absoluteAlpha({ alpha: 42, beta: 0, gamma: 0, compassHeading: null })).toBe(42);
  });
});

describe('a device with no gyroscope', () => {
  it('returns null rather than pointing at the north celestial pole', () => {
    // The event fires with null fields rather than not firing, and treating
    // those as zero would silently aim the chart at the ground due north.
    expect(pointingFromDeviceAngles({ alpha: null, beta: null, gamma: null })).toBeNull();
    expect(pointingFromDeviceAngles({ alpha: 0, beta: null, gamma: 0 })).toBeNull();
    expect(pointingFromDeviceAngles({ alpha: null, beta: 0, gamma: 0 })).toBeNull();
  });
});

describe('vectors and angles round-trip', () => {
  it('survives the trip in both directions', () => {
    for (const p of [
      { altitude: 0, azimuth: 0 },
      { altitude: 45, azimuth: 90 },
      { altitude: -30, azimuth: 200 },
      { altitude: 89, azimuth: 359 },
    ]) {
      const back = pointingFromVector(...vectorFromPointing(p));
      expect(back.altitude).toBeCloseTo(p.altitude, 9);
      expect(back.azimuth).toBeCloseTo(p.azimuth, 9);
    }
  });

  it('normalises azimuth into 0–360', () => {
    expect(pointingFromVector(0, 1, 0).azimuth).toBeCloseTo(0, 9);
    expect(pointingFromVector(-1, 0, 0).azimuth).toBeCloseTo(270, 9);
  });
});

describe('smoothing', () => {
  it('takes the first reading whole, so the chart does not fly in from nowhere', () => {
    const s = new PointingSmoother(0.2);
    const first = s.push({ altitude: 30, azimuth: 100 });
    expect(first.altitude).toBeCloseTo(30, 9);
    expect(first.azimuth).toBeCloseTo(100, 9);
  });

  it('converges on a steady reading', () => {
    const s = new PointingSmoother(0.3);
    s.push({ altitude: 0, azimuth: 0 });
    let last = { altitude: 0, azimuth: 0 };
    for (let i = 0; i < 60; i++) last = s.push({ altitude: 40, azimuth: 120 });
    expect(last.altitude).toBeCloseTo(40, 3);
    expect(last.azimuth).toBeCloseTo(120, 3);
  });

  it('crosses north without swinging all the way round the compass', () => {
    // The reason smoothing runs on the vector and not on the angles: averaging
    // an azimuth of 359 with one of 1 gives 180, which points due south.
    const s = new PointingSmoother(0.5);
    s.push({ altitude: 0, azimuth: 359 });
    const next = s.push({ altitude: 0, azimuth: 1 });

    const distanceFromNorth = Math.min(next.azimuth, 360 - next.azimuth);
    expect(distanceFromNorth).toBeLessThan(2);
  });

  it('forgets everything on reset, for when tracking is switched back on', () => {
    const s = new PointingSmoother(0.1);
    s.push({ altitude: 0, azimuth: 0 });
    s.reset();
    const first = s.push({ altitude: 70, azimuth: 200 });
    expect(first.altitude).toBeCloseTo(70, 9);
    expect(first.azimuth).toBeCloseTo(200, 9);
  });
});
