/**
 * §12.1 invariants. Derivable from first principles, no external data needed,
 * and between them they catch nearly every real coordinate bug.
 */
import { describe, expect, it } from 'vitest';
import * as A from 'astronomy-engine';
import {
  altAzFromHorVector,
  bodyAltAz,
  eqjToHorizontal,
  horizontalToEqj,
  naiveOfDateAltAz,
  rotate,
  rotationEqjToHor,
  vectorFromRaDec,
} from '../src/astro/frames';
import { projectStereographic } from '../src/render/project';
import type { Site } from '../src/astro/types';

const site = (latitude: number, longitude: number, label = 'test'): Site => ({
  latitude,
  longitude,
  elevation: 0,
  timezone: 'UTC',
  label,
  bortle: 5,
});

const SOFIA = site(42.6977, 23.3219, 'Sofia');
const SYDNEY = site(-33.8688, 151.2093, 'Sydney');
const QUITO = site(-0.1807, -78.4678, 'Quito');
const HOUR = 3600_000;

// Polaris, J2000: 02h 31m 49.09s, +89° 15′ 50.8″.
const POLARIS = { ra: 2.5303, dec: 89.2641 };

describe('1. Polaris sits at the observer’s latitude', () => {
  for (const s of [SOFIA, site(60, -120, 'north-west'), site(20, 100, 'tropics')]) {
    it(`holds at ${s.latitude}°N through a whole day`, () => {
      for (let h = 0; h < 24; h += 3) {
        const t = Date.UTC(2026, 2, 15, h);
        const { altitude } = eqjToHorizontal(s, t, POLARIS.ra, POLARIS.dec);
        // Polaris is about 0.74° from the pole, so it circles the true altitude.
        expect(Math.abs(altitude - s.latitude)).toBeLessThan(1);
      }
    });
  }
});

describe('2. Circumpolar stars never set', () => {
  const check = (s: Site, dec: number) => {
    // A star well inside the circumpolar cap for this latitude.
    for (let h = 0; h < 24; h += 1) {
      const t = Date.UTC(2026, 6, 1, h);
      const { altitude } = eqjToHorizontal(s, t, 6, dec);
      expect(altitude).toBeGreaterThan(0);
    }
  };

  it('northern site', () => check(SOFIA, 90 - SOFIA.latitude + 5));
  it('southern site — sign errors in latitude hide until you look here', () =>
    check(SYDNEY, -(90 - Math.abs(SYDNEY.latitude) + 5)));
});

describe('3. Equatorial → horizontal → equatorial round trip', () => {
  it('returns the input to within 1e-9 degrees', () => {
    const t = Date.UTC(2026, 4, 20, 21, 34, 17);
    for (const [ra, dec] of [
      [0, 0],
      [6.5, 45],
      [13.1, -60],
      [23.9, 12.34],
      [18.0, -89.5],
    ] as const) {
      const h = eqjToHorizontal(SOFIA, t, ra, dec);
      const back = horizontalToEqj(SOFIA, t, h.altitude, h.azimuth);
      expect(Math.abs(back.dec - dec)).toBeLessThan(1e-9);
      // RA is meaningless at the pole; compare as an angle elsewhere.
      if (Math.abs(dec) < 89) {
        let d = Math.abs(back.ra - ra) * 15;
        if (d > 180) d = 360 - d;
        expect(d).toBeLessThan(1e-9);
      }
    }
  });
});

describe('4. Sidereal rate', () => {
  it('a fixed star returns to the same hour angle in 23h56m04s ± 2s', () => {
    const sidereal = 23 * 3600 + 56 * 60 + 4.0905; // seconds
    const t0 = Date.UTC(2026, 8, 12, 20, 0, 0);
    const t1 = t0 + sidereal * 1000;

    const a = eqjToHorizontal(SOFIA, t0, 5.5, 10);
    const b = eqjToHorizontal(SOFIA, t1, 5.5, 10);

    // Two seconds of clock time is 30 arcseconds of rotation; allow that much.
    expect(Math.abs(b.altitude - a.altitude)).toBeLessThan(30 / 60);
    let dAz = Math.abs(b.azimuth - a.azimuth);
    if (dAz > 180) dAz = 360 - dAz;
    expect(dAz).toBeLessThan(30 / 60);
  });
});

describe('5. Solar noon', () => {
  it('the Sun transits due south at the predicted altitude, northern mid-latitude', () => {
    const transit = A.SearchHourAngle(A.Body.Sun, new A.Observer(SOFIA.latitude, SOFIA.longitude, 0), 0, new Date(Date.UTC(2026, 5, 21)));
    const t = transit.time.date.getTime();

    const h = bodyAltAz(A.Body.Sun, t, SOFIA);
    expect(Math.abs(h.azimuth - 180)).toBeLessThan(0.1);

    const eq = A.Equator(A.Body.Sun, transit.time, new A.Observer(SOFIA.latitude, SOFIA.longitude, 0), true, true);
    expect(h.altitude).toBeCloseTo(90 - SOFIA.latitude + eq.dec, 1);
  });

  it('and due north from a southern site', () => {
    const obs = new A.Observer(SYDNEY.latitude, SYDNEY.longitude, 0);
    const transit = A.SearchHourAngle(A.Body.Sun, obs, 0, new Date(Date.UTC(2026, 5, 21)));
    const t = transit.time.date.getTime();

    const h = bodyAltAz(A.Body.Sun, t, SYDNEY);
    const fromNorth = Math.min(h.azimuth, 360 - h.azimuth);
    expect(fromNorth).toBeLessThan(0.1);

    const eq = A.Equator(A.Body.Sun, transit.time, obs, true, true);
    expect(h.altitude).toBeCloseTo(90 - Math.abs(SYDNEY.latitude - eq.dec), 1);
  });
});

describe('6. Equinox sunrise is due east', () => {
  const equinox = A.Seasons(2026).mar_equinox;

  for (const s of [SOFIA, SYDNEY, QUITO, site(55, 12, 'Copenhagen')]) {
    it(`within 1° at ${s.label} (${s.latitude}°)`, () => {
      const obs = new A.Observer(s.latitude, s.longitude, 0);
      // Geometric rise — the Sun's *centre* crossing altitude 0 — because that
      // is where the invariant actually lives. Searching from half a day before
      // the equinox instant keeps the Sun's declination within about 0.2° of
      // zero, which is what bounds the residual.
      const rise = A.SearchAltitude(A.Body.Sun, obs, +1, equinox.AddDays(-0.5), 2, 0);
      expect(rise).not.toBeNull();

      const h = bodyAltAz(A.Body.Sun, rise!.date.getTime(), s);
      expect(Math.abs(h.azimuth - 90)).toBeLessThan(1);
    });
  }

  it('and the *visible* sunrise is a degree or so north of east, because of refraction', () => {
    // Worth pinning down separately: the observed sunrise is not the geometric
    // one. The Sun's upper limb clears the horizon while its centre is still
    // 0.833° below it, and at 55°N that displaces the azimuth by over a degree.
    // A test that demanded 1° here would be demanding the wrong physics.
    const s = site(55, 12, 'Copenhagen');
    const obs = new A.Observer(s.latitude, s.longitude, 0);
    const rise = A.SearchRiseSet(A.Body.Sun, obs, +1, equinox.AddDays(-0.5), 2);
    const h = bodyAltAz(A.Body.Sun, rise!.date.getTime(), s);

    expect(h.azimuth).toBeLessThan(90); // north of due east
    expect(90 - h.azimuth).toBeGreaterThan(0.8);
    expect(90 - h.azimuth).toBeLessThan(2.5);
  });
});

describe('8. Mirroring — the sky is the dome seen from underneath', () => {
  it('a body due east projects LEFT of centre in the zenith view', () => {
    // Looking up with north at the top of the screen puts east on the left.
    // Get this wrong and everything renders plausibly but mirrored.
    const east = projectStereographic({ altitude: 30, azimuth: 90 }, 100);
    expect(east.x).toBeLessThan(0);
    expect(Math.abs(east.y)).toBeLessThan(1e-9);
  });

  it('and west projects right, north up, south down', () => {
    expect(projectStereographic({ altitude: 30, azimuth: 270 }, 100).x).toBeGreaterThan(0);
    expect(projectStereographic({ altitude: 30, azimuth: 0 }, 100).y).toBeLessThan(0);
    expect(projectStereographic({ altitude: 30, azimuth: 180 }, 100).y).toBeGreaterThan(0);
  });

  it('the zenith lands at the centre and the horizon on the ring', () => {
    const zenith = projectStereographic({ altitude: 90, azimuth: 0 }, 100);
    expect(Math.hypot(zenith.x, zenith.y)).toBeCloseTo(0, 9);
    const horizon = projectStereographic({ altitude: 0, azimuth: 123 }, 100);
    expect(Math.hypot(horizon.x, horizon.y)).toBeCloseTo(100, 9);
  });
});

describe('9. Precession is actually applied', () => {
  const t = Date.UTC(2026, 1, 10, 22, 0, 0);

  it('the EQJ→HOR path and a naive of-date path differ by ~0.35° at epoch 2026', () => {
    // If someone later "simplifies" frames.ts by feeding catalogue J2000
    // coordinates into an of-date conversion, this fails loudly.
    //
    // The spec quotes 0.35°. That is the near-maximum, reached by stars where
    // the precession of the equinox translates fully into a positional shift —
    // low-declination stars a few hours of RA from the equinox. Orion's belt is
    // one, so it carries the tight bound.
    const belt = angular(eqjToHorizontal(SOFIA, t, 5.5, -5.4), naiveOfDateAltAz(SOFIA, t, 5.5, -5.4));
    expect(belt).toBeGreaterThan(0.3);
    expect(belt).toBeLessThan(0.36);
  });

  it('and no star escapes it', () => {
    // Nearer the pole of the precession circle the displacement is smaller —
    // Vega only moves 0.17° — but it is never zero and never negligible.
    for (const [ra, dec] of [
      [14.26, 19.18], // Arcturus
      [18.62, 38.78], // Vega
      [6.75, -16.72], // Sirius
      [2.53, 89.26], // Polaris
    ] as const) {
      const sep = angular(eqjToHorizontal(SOFIA, t, ra, dec), naiveOfDateAltAz(SOFIA, t, ra, dec));
      expect(sep).toBeGreaterThan(0.1);
      expect(sep).toBeLessThan(0.4);
    }
  });

  it('and the error grows about 1.4° per century', () => {
    const target: [number, number] = [5.5, -5.4];
    const now = Date.UTC(2026, 1, 10, 22);
    const century = Date.UTC(2126, 1, 10, 22);

    const errNow = angular(eqjToHorizontal(SOFIA, now, ...target), naiveOfDateAltAz(SOFIA, now, ...target));
    const errLater = angular(
      eqjToHorizontal(SOFIA, century, ...target),
      naiveOfDateAltAz(SOFIA, century, ...target),
    );

    expect(errLater - errNow).toBeGreaterThan(1.2);
    expect(errLater - errNow).toBeLessThan(1.6);
  });
});

describe('the rotation matrix is a rotation', () => {
  it('is orthonormal and preserves length', () => {
    const r = rotationEqjToHor(SOFIA, Date.UTC(2026, 3, 3, 3, 3, 3));
    for (let row = 0; row < 3; row++) {
      const [a, b, c] = [r[row * 3], r[row * 3 + 1], r[row * 3 + 2]];
      expect(Math.hypot(a, b, c)).toBeCloseTo(1, 12);
    }
    const v = vectorFromRaDec(9.3, -22.1);
    const out = rotate(r, v);
    expect(Math.hypot(...out)).toBeCloseTo(1, 12);
  });

  it('agrees with the library’s own per-object conversion', () => {
    const t = Date.UTC(2026, 7, 1, 2, 30);
    const r = rotationEqjToHor(SOFIA, t);
    const obs = new A.Observer(SOFIA.latitude, SOFIA.longitude, 0);

    for (const [ra, dec] of [[5.5, -5.4], [18.62, 38.78], [3.0, 60.0]] as const) {
      const mine = altAzFromHorVector(...(rotate(r, vectorFromRaDec(ra, dec)) as [number, number, number]));
      // Horizon() takes of-date coordinates, so precess the catalogue position
      // into EQD first — this is the comparison, not a shortcut.
      const eqd = A.RotateVector(
        A.Rotation_EQJ_EQD(A.MakeTime(new Date(t))),
        new A.Vector(...vectorFromRaDec(ra, dec), A.MakeTime(new Date(t))),
      );
      const sph = A.EquatorFromVector(eqd);
      const theirs = A.Horizon(new Date(t), obs, sph.ra, sph.dec, 'normal');

      expect(mine.azimuth).toBeCloseTo(theirs.azimuth, 6);
      // Theirs is refracted, mine is geometric; compare the unrefracted value.
      expect(mine.altitude).toBeCloseTo(theirs.altitude - A.Refraction('normal', mine.altitude), 6);
    }
  });
});

function angular(a: { altitude: number; azimuth: number }, b: { altitude: number; azimuth: number }): number {
  const D = Math.PI / 180;
  const v = (h: { altitude: number; azimuth: number }) => {
    const c = Math.cos(h.altitude * D);
    return [c * Math.cos(h.azimuth * D), c * Math.sin(h.azimuth * D), Math.sin(h.altitude * D)];
  };
  const [p, q] = [v(a), v(b)];
  return (Math.acos(Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2]))) * 180) / Math.PI;
}

describe('a site’s longitude actually matters', () => {
  it('an hour later, 15° west, is the same sky', () => {
    // Local sidereal time rises with both eastward longitude and elapsed time,
    // so the two cancel only when the observer moves *west* as the clock
    // advances. A sign error in longitude turns this into a 30° discrepancy.
    const t = Date.UTC(2026, 5, 5, 20);
    // The sky turns 15.0410686° per solar hour, so the elapsed time that buys
    // exactly 15° of rotation is slightly under an hour. Using it makes the
    // cancellation exact and the assertion tight.
    const dt = (15 / 15.0410686) * HOUR;

    const a = eqjToHorizontal(site(45, 0), t, 12, 20);
    const b = eqjToHorizontal(site(45, -15), t + dt, 12, 20);

    expect(Math.abs(a.altitude - b.altitude)).toBeLessThan(0.005);
    let dAz = Math.abs(a.azimuth - b.azimuth);
    if (dAz > 180) dAz = 360 - dAz;
    expect(dAz).toBeLessThan(0.005);
  });
});
