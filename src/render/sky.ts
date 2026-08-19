/**
 * The sky renderer (spec §8). Canvas 2D, one canvas, redraw on state change.
 *
 * The performance architecture is the whole design: compute the 3×3 EQJ→HOR
 * rotation **once** per (site, instant), then apply it to the entire star array
 * in a flat loop over typed arrays with no allocation inside. Nine thousand
 * stars times nine multiplies is nothing. Nine thousand calls to a conversion
 * function that recomputes sidereal time internally is a slideshow.
 */
import * as A from 'astronomy-engine';
import { bodyVectorEqj, moonAngularRadius, rotationEqjToHor } from '../astro/frames';
import { darkness, limitingMagnitude } from '../astro/twilight';
import type { Instant, Site } from '../astro/types';
import type { SkyData } from '../data/catalog';
import type { SkyObject } from '../astro/objects';
import { describePlanet } from '../astro/objects';
import { alpha, PALETTE, STAR_COLORS, starColorBucket } from './colors';
import { drawLabels, LabelPlacer, PRIORITY, type PlacedLabel } from './labels';
import { createProjector, type Point, type Projector } from './project';

export interface SkyLayers {
  constellationLines: boolean;
  boundaries: boolean;
  labels: boolean;
  dsos: boolean;
  ecliptic: boolean;
  milkyWay: boolean;
}

export const DEFAULT_LAYERS: SkyLayers = {
  constellationLines: true,
  boundaries: false,
  labels: true,
  dsos: false,
  ecliptic: false,
  milkyWay: true,
};

export interface SkyViewState {
  /** Centre of the view. Altitude 90 gives the full-sky chart. */
  centreAltitude: number;
  centreAzimuth: number;
  /** Angular radius of the view, degrees. 90 = whole sky. */
  fieldRadius: number;
}

export const FULL_SKY: SkyViewState = { centreAltitude: 90, centreAzimuth: 0, fieldRadius: 90 };

export interface RenderOptions {
  site: Site;
  instant: Instant;
  view: SkyViewState;
  layers: SkyLayers;
  data: SkyData;
  /** 0–1; the load animation reveals stars in descending order of brightness. */
  reveal: number;
  /** Screen position of the object under the pointer, if any, to highlight. */
  highlight?: { x: number; y: number; label: string } | null;
}

/** What was drawn, so hit-testing can answer "what am I looking at". */
export interface RenderResult {
  projector: Projector;
  centre: Point;
  radius: number;
  limitingMag: number;
  /** Screen positions of everything nameable, for tap targets. */
  targets: PickTarget[];
}

/** A {@link SkyObject} plus where it landed on the canvas, for hit-testing. */
export interface PickTarget extends SkyObject {
  x: number;
  y: number;
  r: number;
}

const PLANETS: Array<{ body: A.Body; name: string; color: string }> = [
  { body: A.Body.Mercury, name: 'Mercury', color: '#d8cbb0' },
  { body: A.Body.Venus, name: 'Venus', color: '#f4ead2' },
  { body: A.Body.Mars, name: 'Mars', color: '#e0b090' },
  { body: A.Body.Jupiter, name: 'Jupiter', color: '#efe0bd' },
  { body: A.Body.Saturn, name: 'Saturn', color: '#e8d9a8' },
  { body: A.Body.Uranus, name: 'Uranus', color: '#cfe0dc' },
  { body: A.Body.Neptune, name: 'Neptune', color: '#c6d4e2' },
];

/** Scratch buffer for rotated star vectors, grown once and reused every frame. */
let scratch = new Float32Array(0);

/**
 * `Object.entries` on the star metadata allocates a few thousand pairs. Doing
 * that inside the draw is exactly the kind of per-frame allocation that turns a
 * scrub into a stutter, so it is memoised against the object identity.
 */
let metaEntriesFor: SkyData['starMeta'] | null = null;
let metaEntries: Array<[number, SkyData['starMeta'][string]]> = [];

function starMetaEntries(starMeta: SkyData['starMeta']): Array<[number, SkyData['starMeta'][string]]> {
  if (metaEntriesFor !== starMeta) {
    metaEntries = Object.entries(starMeta).map(([k, v]) => [Number(k), v]);
    metaEntriesFor = starMeta;
  }
  return metaEntries;
}

export function renderSky(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  opts: RenderOptions,
): RenderResult {
  const { site, instant, view, layers, data } = opts;

  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2 - 28;

  const projector = createProjector({
    centre: { altitude: view.centreAltitude, azimuth: view.centreAzimuth },
    fieldRadius: view.fieldRadius,
    radius,
  });

  const rotation = rotationEqjToHor(site, instant);
  const limitingMag = limitingMagnitude(site, instant);
  // What the *sky* allows is not always what the *screen* can show. On a phone
  // the whole hemisphere lands in a disc a few hundred pixels across, and
  // drawing every star the sky permits turns it into a grey wash.
  const renderMag = densityLimitedMagnitude(limitingMag, radius / view.fieldRadius);
  const fullSky = view.fieldRadius >= 89.5 && view.centreAltitude >= 89.5;

  const dark = darkness(site, instant);

  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = PALETTE.void;
  ctx.fillRect(0, 0, width, height);
  ctx.translate(cx, cy);

  // The full-sky chart is a disc; clip to it so nothing spills past the horizon
  // ring. A zoomed view fills the frame instead.
  if (fullSky) {
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.clip();
  }

  // Inside the disc — which *is* the sky — the ground colour lifts out of the
  // void as the Sun comes up, so a midday chart does not read as midnight. It
  // stays inside the palette (the horizon violet, pushed a little further)
  // rather than introducing a blue.
  if (dark < 1) {
    ctx.fillStyle = skyGround(dark);
    ctx.fillRect(-width, -height, width * 2, height * 2);
  }

  const placer = new LabelPlacer(width, height);
  if (fullSky) placer.maskOutside(cx, cy, radius);
  const targets: PickTarget[] = [];
  const p: Point = { x: 0, y: 0 };

  // The Milky Way is the first thing a brightening sky takes away.
  if (layers.milkyWay && dark > 0.05) drawMilkyWay(ctx, data, rotation, projector, dark);
  if (layers.boundaries) drawBoundaries(ctx, data, rotation, projector);
  if (layers.constellationLines) drawConstellationLines(ctx, data, rotation, projector);
  if (layers.ecliptic) drawEcliptic(ctx, site, instant, projector);

  drawStars(ctx, data, rotation, projector, renderMag, opts.reveal, p);

  if (layers.dsos) drawDsos(ctx, data, rotation, projector, renderMag, placer, targets, cx, cy, p);

  drawStarLabels(data, projector, renderMag, placer, targets, cx, cy, p, layers.labels);
  if (layers.labels) drawConstellationNames(data, rotation, projector, placer, cx, cy, p);

  drawSolarSystem(ctx, site, instant, projector, placer, targets, cx, cy, layers.labels);
  drawHorizon(ctx, projector, radius, fullSky, placer, cx, cy);

  ctx.restore();

  // Labels are drawn last, in screen space, over everything. Nothing is added
  // to the placer when the layer is off, so this is a no-op in that case.
  ctx.save();
  const placed: PlacedLabel[] = placer.place(ctx);
  drawLabels(ctx, placed);
  ctx.restore();

  return {
    projector,
    centre: { x: cx, y: cy },
    radius,
    limitingMag,
    // In the full-sky view the disc is the sky. Anything projected outside it is
    // below the horizon, and offering it as a tap target invites the reader to
    // click on something that is not there.
    targets: fullSky ? targets.filter((t) => Math.hypot(t.x - cx, t.y - cy) <= radius) : targets,
  };
}

// ── stars ────────────────────────────────────────────────────────────────────

function drawStars(
  ctx: CanvasRenderingContext2D,
  data: SkyData,
  r: Float64Array,
  projector: Projector,
  limitingMag: number,
  reveal: number,
  p: Point,
): void {
  const { xyz, mag, ci, count } = data.stars;
  if (scratch.length < count * 3) scratch = new Float32Array(count * 3);

  // The one hot loop. No allocation, no function calls that recompute anything,
  // no property lookups on objects — three typed arrays and a 3×3 multiply.
  const r0 = r[0], r1 = r[1], r2 = r[2];
  const r3 = r[3], r4 = r[4], r5 = r[5];
  const r6 = r[6], r7 = r[7], r8 = r[8];

  for (let i = 0, o = 0; i < count; i++, o += 3) {
    const x = xyz[o];
    const y = xyz[o + 1];
    const z = xyz[o + 2];
    scratch[o] = r0 * x + r1 * y + r2 * z;
    scratch[o + 1] = r3 * x + r4 * y + r5 * z;
    scratch[o + 2] = r6 * x + r7 * y + r8 * z;
  }

  // Stars are sorted brightest-first, so the load animation is a prefix of the
  // array — which is exactly how dark adaptation works.
  const visibleCount = reveal >= 1 ? count : Math.floor(count * easeOut(reveal));

  let currentBucket = -1;
  for (let i = 0, o = 0; i < visibleCount; i++, o += 3) {
    const m = mag[i];
    // Fade out across the last magnitude before the limit, rather than cutting
    // off hard — this is what makes the Bortle slider read as dimming the sky
    // instead of deleting stars.
    const over = m - limitingMag;
    if (over > 0.7) continue;
    const fade = over <= 0 ? 1 : 1 - over / 0.7;

    if (!projector.project(scratch[o], scratch[o + 1], scratch[o + 2], p)) continue;

    const bucket = starColorBucket(ci[i]);
    if (bucket !== currentBucket) {
      ctx.fillStyle = STAR_COLORS[bucket];
      currentBucket = bucket;
    }

    const radius = starRadius(m, limitingMag);
    ctx.globalAlpha = fade;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, TAU);
    ctx.fill();

    // A four-point cross above magnitude 1.5. The eye sees no diffraction
    // spikes — this is a lie — but it is the visual convention for "this one is
    // bright", and it works.
    if (m < 1.5) {
      const spike = radius * 3.2;
      ctx.globalAlpha = fade * 0.5;
      ctx.strokeStyle = STAR_COLORS[bucket];
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(p.x - spike, p.y);
      ctx.lineTo(p.x + spike, p.y);
      ctx.moveTo(p.x, p.y - spike);
      ctx.lineTo(p.x, p.y + spike);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * Radius from magnitude — a perceptual curve, not a linear one. The constants
 * are tuned by eye: what matters is that the contrast between a first and a
 * fifth magnitude star feels like the real sky, not that the formula is
 * defensible from photometry.
 */
export function starRadius(mag: number, limitingMag: number): number {
  return Math.max(0.45, 1.05 * Math.pow(2.512, (limitingMag - mag) * 0.3));
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 2);
}

const TAU = Math.PI * 2;

/**
 * Cap the magnitude by how much room there is to draw it in.
 *
 * A dark-sky Bortle 2 evening genuinely reaches magnitude 7.3, and on a laptop
 * that is a sky full of stars. Squeeze the same hemisphere into a phone-sized
 * disc — under two pixels per degree — and those same stars overlap into a grey
 * wash that shows less than a sparser chart would. This is not dishonesty about
 * the sky; it is honesty about the screen, and zooming in lifts the cap again
 * because the pixels per degree go up with it.
 */
export function densityLimitedMagnitude(limitingMag: number, pixelsPerDegree: number): number {
  /** Above this there is room for everything the sky offers. */
  const COMFORTABLE = 4.5;
  if (pixelsPerDegree >= COMFORTABLE) return limitingMag;

  // Roughly a magnitude and a bit for every halving of the available scale,
  // and never more than three magnitudes, which still leaves the constellation
  // figures intact.
  const octaves = Math.log2(COMFORTABLE / Math.max(0.2, pixelsPerDegree));
  return limitingMag - Math.min(3, octaves * 1.2);
}

/** Background colour for a given twilight depth, 1 = astronomical night. */
function skyGround(dark: number): string {
  const night = [0x05, 0x03, 0x11];
  const day = [0x33, 0x27, 0x52];
  const c = night.map((n, i) => Math.round(n + (day[i] - n) * (1 - dark)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Alt/az from a horizontal-frame vector — x north, y west, z up. */
function altAz(x: number, y: number, z: number): { altitude: number; azimuth: number } {
  const altitude = (Math.asin(Math.max(-1, Math.min(1, z))) * 180) / Math.PI;
  let azimuth = (Math.atan2(-y, x) * 180) / Math.PI;
  if (azimuth < 0) azimuth += 360;
  return { altitude, azimuth };
}

// ── line work ────────────────────────────────────────────────────────────────

/**
 * Draw flattened [x,y,z,…] polylines through the rotation and projection.
 * Breaking the path whenever a vertex falls outside the projection stops
 * segments from being drawn straight across the canvas when one end wraps
 * behind the viewer.
 */
function strokePolyline(
  ctx: CanvasRenderingContext2D,
  v: readonly number[],
  r: Float64Array,
  projector: Projector,
  p: Point,
): void {
  let drawing = false;
  for (let i = 0; i < v.length; i += 3) {
    const x = v[i], y = v[i + 1], z = v[i + 2];
    const hx = r[0] * x + r[1] * y + r[2] * z;
    const hy = r[3] * x + r[4] * y + r[5] * z;
    const hz = r[6] * x + r[7] * y + r[8] * z;

    if (!projector.project(hx, hy, hz, p)) {
      drawing = false;
      continue;
    }
    if (drawing) ctx.lineTo(p.x, p.y);
    else {
      ctx.moveTo(p.x, p.y);
      drawing = true;
    }
  }
}

function drawConstellationLines(
  ctx: CanvasRenderingContext2D,
  data: SkyData,
  r: Float64Array,
  projector: Projector,
): void {
  const p: Point = { x: 0, y: 0 };
  ctx.strokeStyle = alpha(PALETTE.gold, 0.34);
  ctx.lineWidth = 0.9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const c of data.constellations) {
    for (const line of c.lines) strokePolyline(ctx, line, r, projector, p);
  }
  ctx.stroke();
}

function drawBoundaries(
  ctx: CanvasRenderingContext2D,
  data: SkyData,
  r: Float64Array,
  projector: Projector,
): void {
  const p: Point = { x: 0, y: 0 };
  ctx.strokeStyle = alpha(PALETTE.gold, 0.13);
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (const edge of data.boundaries) strokePolyline(ctx, edge.v, r, projector, p);
  ctx.stroke();
}

function drawMilkyWay(
  ctx: CanvasRenderingContext2D,
  data: SkyData,
  r: Float64Array,
  projector: Projector,
  dark: number,
): void {
  const p: Point = { x: 0, y: 0 };
  for (const level of data.milkyWay) {
    // Five nested isophotes; each adds a little more light, so the band builds
    // up towards the galactic centre without any one layer being visible.
    ctx.fillStyle = alpha(PALETTE.cream, (0.012 + level.level * 0.007) * dark);
    ctx.beginPath();
    for (const ring of level.rings) {
      strokePolyline(ctx, ring, r, projector, p);
      ctx.closePath();
    }
    ctx.fill();
  }
}

/** The ecliptic, sampled every 2° of longitude and rotated like anything else. */
function drawEcliptic(
  ctx: CanvasRenderingContext2D,
  site: Site,
  instant: Instant,
  projector: Projector,
): void {
  const p: Point = { x: 0, y: 0 };
  const r = rotationEqjToHor(site, instant);
  const eclToEqj = A.Rotation_ECL_EQJ().rot;
  const time = A.MakeTime(new Date(instant));

  ctx.strokeStyle = alpha(PALETTE.goldLit, 0.28);
  ctx.lineWidth = 0.8;
  ctx.setLineDash([4, 5]);
  ctx.beginPath();

  const v: number[] = [];
  for (let lon = 0; lon <= 360; lon += 2) {
    const rad = (lon * Math.PI) / 180;
    const e = A.RotateVector(A.MakeRotation(eclToEqj), new A.Vector(Math.cos(rad), Math.sin(rad), 0, time));
    v.push(e.x, e.y, e.z);
  }
  strokePolyline(ctx, v, r, projector, p);
  ctx.stroke();
  ctx.setLineDash([]);
}

// ── labels for stars and constellations ──────────────────────────────────────

/**
 * Reads the rotated star vectors out of `scratch`, which `drawStars` has just
 * filled for this frame — rotating nine thousand stars twice would be silly.
 * That makes the call order load-bearing: labels must follow stars.
 */
function drawStarLabels(
  data: SkyData,
  projector: Projector,
  limitingMag: number,
  placer: LabelPlacer,
  targets: PickTarget[],
  cx: number,
  cy: number,
  p: Point,
  withLabels: boolean,
): void {
  const { mag, count } = data.stars;

  for (const [i, meta] of starMetaEntries(data.starMeta)) {
    if (i >= count) continue;
    const m = mag[i];
    if (m > limitingMag) continue;

    const o = i * 3;
    if (!projector.project(scratch[o], scratch[o + 1], scratch[o + 2], p)) continue;

    const radius = starRadius(m, limitingMag);
    const name = meta.n ?? (meta.b ? `${meta.b} ${meta.c ?? ''}`.trim() : `HIP ${meta.h}`);

    targets.push({
      x: p.x + cx,
      y: p.y + cy,
      r: Math.max(6, radius + 3),
      kind: 'star',
      name,
      detail: describeStar(meta, m),
      ...altAz(scratch[o], scratch[o + 1], scratch[o + 2]),
      index: i,
    });

    if (!withLabels) continue;

    // Priority order: named first-magnitude stars, then Bayer designations.
    // Everything fainter than third magnitude is asking for a crowded chart.
    if (meta.n && m <= 2.2) {
      placer.add({
        text: meta.n,
        x: p.x + cx,
        y: p.y + cy,
        clearance: radius,
        priority: PRIORITY.brightStar,
        font: '11px ui-serif, Spectral, Georgia, serif',
        color: alpha(PALETTE.cream, 0.85),
      });
    } else if (meta.b && m <= 3.2) {
      placer.add({
        text: meta.b,
        x: p.x + cx,
        y: p.y + cy,
        clearance: radius,
        priority: PRIORITY.bayer,
        font: '10px ui-serif, Spectral, Georgia, serif',
        color: alpha(PALETTE.gold, 0.7),
      });
    }
  }
}

function describeStar(meta: { n?: string; b?: string; f?: string; c?: string; h: string }, mag: number): string {
  const bits: string[] = [];
  if (meta.b) bits.push(`${meta.b}${meta.c ? ` ${meta.c}` : ''}`);
  if (meta.f) bits.push(`${meta.f}${meta.c ? ` ${meta.c}` : ''}`);
  bits.push(`HIP ${meta.h}`);
  return `${bits.join(' · ')} — magnitude ${mag.toFixed(2)}`;
}

function drawConstellationNames(
  data: SkyData,
  r: Float64Array,
  projector: Projector,
  placer: LabelPlacer,
  cx: number,
  cy: number,
  p: Point,
): void {
  for (const c of data.constellations) {
    const [x, y, z] = c.labelAt;
    const hx = r[0] * x + r[1] * y + r[2] * z;
    const hy = r[3] * x + r[4] * y + r[5] * z;
    const hz = r[6] * x + r[7] * y + r[8] * z;
    if (!projector.project(hx, hy, hz, p)) continue;

    // Only when the figure is big enough on screen to own the name — otherwise
    // Draco's label ends up sitting on Ursa Minor.
    const onScreenExtent = (c.extent / projector.fieldRadius) * projector.radius;
    if (onScreenExtent < 42) continue;

    placer.add({
      // The Latin name, not the English translation. This is a celestial atlas
      // in the Bode tradition: the chart says VIRGO and CAMELOPARDALIS, and the
      // detail card is where "the Maiden" and "the Giraffe" belong.
      text: c.native.toUpperCase(),
      x: p.x + cx,
      y: p.y + cy,
      clearance: 2,
      priority: PRIORITY.constellation,
      font: '9.5px ui-serif, Cormorant Garamond, Georgia, serif',
      color: alpha(PALETTE.gold, 0.55),
    });
  }
}

// ── deep sky ─────────────────────────────────────────────────────────────────

function drawDsos(
  ctx: CanvasRenderingContext2D,
  data: SkyData,
  r: Float64Array,
  projector: Projector,
  limitingMag: number,
  placer: LabelPlacer,
  targets: PickTarget[],
  cx: number,
  cy: number,
  p: Point,
): void {
  // A DSO is only worth drawing if it is within reach of this sky. The extra
  // 1.5 magnitudes acknowledge that averted vision and binoculars go deeper
  // than the naked-eye limit.
  const reach = limitingMag + 1.5;

  ctx.strokeStyle = alpha(PALETTE.goldLit, 0.55);
  ctx.lineWidth = 0.9;

  for (const d of data.dsos) {
    if (d.mag > reach) continue;
    const hx = r[0] * d.x + r[1] * d.y + r[2] * d.z;
    const hy = r[3] * d.x + r[4] * d.y + r[5] * d.z;
    const hz = r[6] * d.x + r[7] * d.y + r[8] * d.z;
    if (!projector.project(hx, hy, hz, p)) continue;

    // Draw at true angular size where that is bigger than the glyph.
    const angular = (d.size / 60 / projector.fieldRadius) * projector.radius;
    const rr = Math.max(3, Math.min(40, angular / 2));

    ctx.beginPath();
    if (d.type.includes('galaxy')) {
      ctx.ellipse(p.x, p.y, rr, rr * 0.55, 0, 0, TAU);
    } else if (d.type.includes('cluster')) {
      ctx.arc(p.x, p.y, rr, 0, TAU);
      ctx.setLineDash([2, 2]);
    } else {
      ctx.rect(p.x - rr, p.y - rr, rr * 2, rr * 2);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    targets.push({
      x: p.x + cx,
      y: p.y + cy,
      r: Math.max(8, rr),
      ...altAz(hx, hy, hz),
      kind: 'dso',
      name: d.name || d.id,
      detail: `${d.id}${d.ngc !== d.id ? ` · ${d.ngc}` : ''} — ${d.type}, magnitude ${d.mag.toFixed(1)}${
        d.size ? `, ${formatSize(d.size)} across` : ''
      }`,
    });

    if (d.mag <= reach - 2) {
      placer.add({
        text: d.id,
        x: p.x + cx,
        y: p.y + cy,
        clearance: rr,
        priority: PRIORITY.dso,
        font: '9px ui-monospace, IBM Plex Mono, monospace',
        color: alpha(PALETTE.goldLit, 0.7),
      });
    }
  }
}

function formatSize(arcmin: number): string {
  return arcmin >= 60 ? `${(arcmin / 60).toFixed(1)}°` : `${arcmin.toFixed(0)}′`;
}

// ── sun, moon, planets ───────────────────────────────────────────────────────

function drawSolarSystem(
  ctx: CanvasRenderingContext2D,
  site: Site,
  instant: Instant,
  projector: Projector,
  placer: LabelPlacer,
  targets: PickTarget[],
  cx: number,
  cy: number,
  withLabels: boolean,
): void {
  const r = rotationEqjToHor(site, instant);
  const p: Point = { x: 0, y: 0 };

  // The most recently plotted body's horizontal direction, so each target can
  // record where in the sky it actually is.
  let where = { altitude: 0, azimuth: 0 };

  const plot = (v: [number, number, number]): boolean => {
    const hx = r[0] * v[0] + r[1] * v[1] + r[2] * v[2];
    const hy = r[3] * v[0] + r[4] * v[1] + r[5] * v[2];
    const hz = r[6] * v[0] + r[7] * v[1] + r[8] * v[2];
    where = altAz(hx, hy, hz);
    return projector.project(hx, hy, hz, p);
  };

  // Sun
  if (plot(bodyVectorEqj(A.Body.Sun, instant, site))) {
    const rr = Math.max(6, (0.53 / 2 / projector.fieldRadius) * projector.radius);
    ctx.fillStyle = PALETTE.goldLit;
    ctx.beginPath();
    ctx.arc(p.x, p.y, rr, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = alpha(PALETTE.goldLit, 0.3);
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.lineWidth = 1;

    targets.push({
      x: p.x + cx,
      y: p.y + cy,
      r: rr + 6,
      kind: 'sun',
      name: 'The Sun',
      detail: 'Our star. Never look at it through binoculars or a telescope.',
      ...where,
    });
    if (withLabels) {
      placer.add({
        text: 'Sun',
        x: p.x + cx,
        y: p.y + cy,
        clearance: rr + 4,
        priority: PRIORITY.body,
        font: '11px ui-serif, Spectral, Georgia, serif',
        color: PALETTE.goldLit,
      });
    }
  }

  // Moon, drawn at true angular size with its phase
  if (plot(bodyVectorEqj(A.Body.Moon, instant, site))) {
    const angular = moonAngularRadius(instant, site);
    const rr = Math.max(7, (angular / projector.fieldRadius) * projector.radius);
    const illum = A.Illumination(A.Body.Moon, new Date(instant));
    drawMoon(ctx, p.x, p.y, rr, illum.phase_fraction, A.MoonPhase(new Date(instant)));

    targets.push({
      x: p.x + cx,
      y: p.y + cy,
      r: rr + 5,
      kind: 'moon',
      ...where,
      name: 'The Moon',
      detail: `${phaseName(A.MoonPhase(new Date(instant)))} — ${Math.round(illum.phase_fraction * 100)}% lit`,
    });
    if (withLabels) {
      placer.add({
        text: 'Moon',
        x: p.x + cx,
        y: p.y + cy,
        clearance: rr + 3,
        priority: PRIORITY.body,
        font: '11px ui-serif, Spectral, Georgia, serif',
        color: PALETTE.cream,
      });
    }
  }

  for (const planet of PLANETS) {
    if (!plot(bodyVectorEqj(planet.body, instant, site))) continue;
    const illum = A.Illumination(planet.body, new Date(instant));
    const rr = Math.max(1.6, 4.2 - illum.mag * 0.55);

    ctx.fillStyle = planet.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, rr, 0, TAU);
    ctx.fill();

    targets.push({
      x: p.x + cx,
      y: p.y + cy,
      r: rr + 6,
      kind: 'planet',
      ...where,
      name: planet.name,
      detail: describePlanet(planet.body, instant),
    });

    if (withLabels && illum.mag < 6) {
      placer.add({
        text: planet.name,
        x: p.x + cx,
        y: p.y + cy,
        clearance: rr + 2,
        priority: PRIORITY.body,
        font: '11px ui-serif, Spectral, Georgia, serif',
        color: planet.color,
      });
    }
  }
}

/** The Moon at its real size with a terminator, not a generic disc. */
function drawMoon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  illumination: number,
  phaseAngle: number,
): void {
  ctx.save();
  ctx.translate(x, y);

  // Earthshine: the unlit part is not black.
  ctx.fillStyle = alpha(PALETTE.cream, 0.16);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();

  // The lit region is a half-disc joined to a half-ellipse whose semi-axis is
  // r·(1 − 2·illumination): positive before quarter (a crescent), negative
  // after (a gibbous). Waxing puts the lit limb on the Moon's western side,
  // which the chart's mirroring places on screen-right.
  const waxing = phaseAngle < 180;
  const semi = r * (2 * illumination - 1);
  const side = waxing ? 1 : -1;

  ctx.fillStyle = PALETTE.cream;
  ctx.beginPath();
  // The fully-lit limb.
  ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, side < 0);
  // The terminator, back the other way.
  ctx.ellipse(0, 0, Math.abs(semi), r, 0, Math.PI / 2, -Math.PI / 2, semi * side > 0 === (side > 0));
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

export function phaseName(phaseAngle: number): string {
  const p = ((phaseAngle % 360) + 360) % 360;
  if (p < 11 || p > 349) return 'New moon';
  if (p < 79) return 'Waxing crescent';
  if (p < 101) return 'First quarter';
  if (p < 169) return 'Waxing gibbous';
  if (p < 191) return 'Full moon';
  if (p < 259) return 'Waning gibbous';
  if (p < 281) return 'Last quarter';
  return 'Waning crescent';
}

// ── horizon ──────────────────────────────────────────────────────────────────

const CARDINALS: Array<[number, string]> = [
  [0, 'N'],
  [45, 'NE'],
  [90, 'E'],
  [135, 'SE'],
  [180, 'S'],
  [225, 'SW'],
  [270, 'W'],
  [315, 'NW'],
];

function drawHorizon(
  ctx: CanvasRenderingContext2D,
  projector: Projector,
  radius: number,
  fullSky: boolean,
  placer: LabelPlacer,
  cx: number,
  cy: number,
): void {
  const p: Point = { x: 0, y: 0 };

  if (fullSky) {
    ctx.strokeStyle = alpha(PALETTE.gold, 0.5);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, TAU);
    ctx.stroke();
  } else {
    // In a zoomed view the horizon is a curve across the frame, and the ground
    // below it is filled — that is what tells you which way is down.
    ctx.strokeStyle = alpha(PALETTE.gold, 0.5);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    let drawing = false;
    for (let az = 0; az <= 360; az += 1) {
      const rad = (az * Math.PI) / 180;
      if (!projector.project(Math.cos(rad), -Math.sin(rad), 0, p)) {
        drawing = false;
        continue;
      }
      if (drawing) ctx.lineTo(p.x, p.y);
      else {
        ctx.moveTo(p.x, p.y);
        drawing = true;
      }
    }
    ctx.stroke();
  }

  ctx.font = '10px ui-monospace, IBM Plex Mono, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [az, letter] of CARDINALS) {
    const rad = (az * Math.PI) / 180;
    if (!projector.project(Math.cos(rad), -Math.sin(rad), 0, p)) continue;

    // Just *inside* the ring. The full-sky chart is clipped to the disc, so a
    // letter placed outside it is a letter nobody sees — and inside is the
    // planisphere convention anyway.
    const out = fullSky ? 0.955 : 1;
    const lx = p.x * out;
    const ly = p.y * out;

    ctx.fillStyle = letter.length === 1 ? alpha(PALETTE.gold, 0.95) : alpha(PALETTE.gold, 0.5);
    ctx.fillText(letter, lx, ly);
    placer.reserve(lx + cx, ly + cy, 20, 16);
  }
  ctx.textAlign = 'left';
}
