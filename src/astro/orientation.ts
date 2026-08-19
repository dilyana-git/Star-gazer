/**
 * Point the phone at the sky and the chart follows (spec §14.1).
 *
 * The maths lives here, as pure functions, because the alternative is code that
 * can only be exercised by standing in a field waving a handset — and a sky
 * chart that is confidently ninety degrees wrong is worse than no sky chart.
 *
 * ## The frames
 *
 * `DeviceOrientationEvent` reports three intrinsic rotations that take the
 * Earth frame to the device frame:
 *
 *   alpha  about Z, right-hand rule, so it increases anticlockwise seen from
 *          above — 0 when the top of the device faces north, 90 when it faces
 *          west. (Not the same sense as a compass bearing. See below.)
 *   beta   about the rotated X
 *   gamma  about the twice-rotated Y
 *
 * The Earth frame is east / north / up. The device frame has X across the
 * screen to the right, Y up the screen, and Z out of the screen towards the
 * user's face — so the *back* of the phone, the end you aim at the sky, points
 * along device −Z.
 *
 * The rotation is R = Rz(α)·Rx(β)·Ry(γ), and the direction being aimed is
 * −R·(0,0,1), which is the negated third column. Working that out by hand:
 *
 *   east  = −(cosα·sinγ + sinα·sinβ·cosγ)
 *   north = −(sinα·sinγ − cosα·sinβ·cosγ)
 *   up    = −(cosβ·cosγ)
 *
 * ## Screen rotation does not enter into it
 *
 * A tempting bug: compensating for `screen.orientation.angle`. Do not. The
 * device frame is fixed to the *hardware*, not to the rendered screen, so the
 * back of the phone is device −Z whether the picture is portrait or landscape.
 * The screen angle would only matter for rolling the chart to match the
 * handset, which this deliberately does not do — see `PhoneShell`.
 */

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export interface DeviceAngles {
  /** Rotation about the vertical axis, degrees. */
  alpha: number | null;
  /** Front-to-back tilt, degrees. */
  beta: number | null;
  /** Left-to-right tilt, degrees. */
  gamma: number | null;
  /**
   * iOS only: true-north compass bearing of the device, clockwise, degrees.
   * When present it replaces `alpha`, which iOS reports relative to wherever
   * the page happened to start rather than to north.
   */
  compassHeading?: number | null;
}

export interface Pointing {
  /** Degrees above the horizon; negative means aimed at the ground. */
  altitude: number;
  /** Degrees clockwise from north. */
  azimuth: number;
}

/**
 * Where the back of the handset is aimed.
 *
 * Returns null when the event carries no usable angles — a device with no
 * gyroscope fires the event with all three fields null rather than not firing
 * it at all.
 */
export function pointingFromDeviceAngles(angles: DeviceAngles): Pointing | null {
  const { beta, gamma } = angles;
  const alpha = absoluteAlpha(angles);
  if (alpha == null || beta == null || gamma == null) return null;

  const [a, b, g] = [alpha * DEG, beta * DEG, gamma * DEG];
  const [ca, sa] = [Math.cos(a), Math.sin(a)];
  const [cb, sb] = [Math.cos(b), Math.sin(b)];
  const [cg, sg] = [Math.cos(g), Math.sin(g)];

  const east = -(ca * sg + sa * sb * cg);
  const north = -(sa * sg - ca * sb * cg);
  const up = -(cb * cg);

  return pointingFromVector(east, north, up);
}

/**
 * iOS reports `alpha` relative to an arbitrary origin, but also gives a true
 * compass bearing. The bearing runs clockwise from north and alpha runs
 * anticlockwise, so one is 360 minus the other.
 */
export function absoluteAlpha(angles: DeviceAngles): number | null {
  if (angles.compassHeading != null && Number.isFinite(angles.compassHeading)) {
    return 360 - angles.compassHeading;
  }
  return angles.alpha;
}

/** East/north/up vector → altitude and azimuth. The vector need not be unit. */
export function pointingFromVector(east: number, north: number, up: number): Pointing {
  const length = Math.hypot(east, north, up) || 1;
  const altitude = Math.asin(Math.max(-1, Math.min(1, up / length))) * RAD;
  let azimuth = Math.atan2(east, north) * RAD;
  if (azimuth < 0) azimuth += 360;
  return { altitude, azimuth };
}

/** Altitude and azimuth → east/north/up unit vector. */
export function vectorFromPointing(p: Pointing): [number, number, number] {
  const c = Math.cos(p.altitude * DEG);
  return [c * Math.sin(p.azimuth * DEG), c * Math.cos(p.azimuth * DEG), Math.sin(p.altitude * DEG)];
}

/**
 * A low-pass filter for a direction.
 *
 * Phone magnetometers are noisy enough that the raw signal makes the chart
 * shiver, and a shivering chart is unreadable and slightly nauseating.
 * Smoothing the *vector* rather than the angles matters: an azimuth crossing
 * north jumps 359 → 1, and averaging those two numbers points you south.
 */
export class PointingSmoother {
  private vector: [number, number, number] | null = null;
  private readonly responsiveness: number;

  /**
   * @param responsiveness 0–1. Higher follows the handset more closely and
   *   shivers more; 0.18 settles within about a fifth of a second at the 60 Hz
   *   these events arrive at, which reads as immediate without the jitter.
   */
  constructor(responsiveness = 0.18) {
    this.responsiveness = responsiveness;
  }

  push(p: Pointing): Pointing {
    const next = vectorFromPointing(p);
    if (!this.vector) {
      this.vector = next;
      return p;
    }

    const k = this.responsiveness;
    this.vector = [
      this.vector[0] + (next[0] - this.vector[0]) * k,
      this.vector[1] + (next[1] - this.vector[1]) * k,
      this.vector[2] + (next[2] - this.vector[2]) * k,
    ];
    return pointingFromVector(...this.vector);
  }

  reset(): void {
    this.vector = null;
  }
}
