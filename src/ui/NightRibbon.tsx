/**
 * The night ribbon — the signature element (spec §9).
 *
 * A horizontal band across the bottom representing the whole night. Twilight
 * depth is a continuous gradient, moonlight is a lighter wash over it, and
 * events are pinned at their peak times. Dragging along it scrubs the sky.
 *
 * This single element answers "when should I go outside" better than any list.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { darkness, type NightWindow } from '../astro/twilight';
import { formatTime } from '../astro/time';
import { alpha, PALETTE } from '../render/colors';
import type { Instant, Site } from '../astro/types';
import type { SkyEvent } from '../astro/events/types';

interface Props {
  site: Site;
  night: NightWindow;
  instant: Instant;
  events: SkyEvent[];
  focusedEventId: string | null;
  onScrub(instant: Instant): void;
  onSelectEvent(event: SkyEvent): void;
}

/** Samples across the night for the twilight gradient. */
const SAMPLES = 160;

export function NightRibbon({ site, night, instant, events, focusedEventId, onScrub, onSelectEvent }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const height = 62;

  // The ribbon shows the observing half of the day: from a little before sunset
  // to a little after sunrise. On a polar day there is no such bracket, so it
  // falls back to the full noon-to-noon span.
  const [from, to] = useMemo((): [Instant, Instant] => {
    const pad = 45 * 60_000;
    const start = night.sunset != null ? night.sunset - pad : night.bounds[0];
    const end = night.sunrise != null ? night.sunrise + pad : night.bounds[1];
    return end > start ? [start, end] : night.bounds;
  }, [night]);

  // Sampling the Sun 160 times is not free, so it is memoised on the night.
  const profile = useMemo(() => {
    const out = new Float32Array(SAMPLES);
    for (let i = 0; i < SAMPLES; i++) {
      out[i] = darkness(site, from + ((to - from) * i) / (SAMPLES - 1));
    }
    return out;
  }, [site, from, to]);

  const moonSpans = useMemo(
    () =>
      night.moonUp
        .map(([s, e]): [number, number] => [fraction(s, from, to), fraction(e, from, to)])
        .filter(([s, e]) => e > 0 && s < 1),
    [night.moonUp, from, to],
  );

  useEffect(() => {
    const el = canvasRef.current?.parentElement;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Twilight, as a continuous gradient rather than blocks: the sky does not
    // change state at −6°, it just keeps getting darker.
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    for (let i = 0; i < SAMPLES; i++) {
      gradient.addColorStop(i / (SAMPLES - 1), twilightColor(profile[i]));
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Moonlight sits on top as a wash, brightness following illumination.
    for (const [s, e] of moonSpans) {
      const x0 = Math.max(0, s) * width;
      const x1 = Math.min(1, e) * width;
      ctx.fillStyle = alpha(PALETTE.cream, 0.03 + night.moonIllumination * 0.09);
      ctx.fillRect(x0, 0, x1 - x0, height);

      ctx.strokeStyle = alpha(PALETTE.cream, 0.16);
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (s > 0) {
        ctx.moveTo(x0 + 0.5, 0);
        ctx.lineTo(x0 + 0.5, height);
      }
      if (e < 1) {
        ctx.moveTo(x1 - 0.5, 0);
        ctx.lineTo(x1 - 0.5, height);
      }
      ctx.stroke();
    }

    // Hour ticks, so the band reads as a clock and not just a wash.
    ctx.strokeStyle = alpha(PALETTE.gold, 0.16);
    ctx.fillStyle = alpha(PALETTE.gold, 0.5);
    ctx.font = '9px ui-monospace, IBM Plex Mono, monospace';
    ctx.textAlign = 'center';
    const hours = Math.ceil((to - from) / 3_600_000);
    const stepHours = hours > 14 ? 3 : hours > 8 ? 2 : 1;
    for (let t = ceilToHour(from); t < to; t += stepHours * 3_600_000) {
      const x = Math.round(fraction(t, from, to) * width) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, height - 12);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.fillText(formatTime(t, site.timezone), x, height - 15);
    }
    ctx.textAlign = 'left';

    // The dark windows get an underline — the actual answer to "when".
    for (const [s, e] of night.darkWindows) {
      const x0 = fraction(s, from, to) * width;
      const x1 = fraction(e, from, to) * width;
      ctx.fillStyle = PALETTE.goldLit;
      ctx.fillRect(x0, height - 3, Math.max(2, x1 - x0), 3);
    }

    // Playhead.
    const px = Math.round(fraction(instant, from, to) * width) + 0.5;
    if (px >= 0 && px <= width) {
      ctx.strokeStyle = PALETTE.cream;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
      ctx.stroke();
    }
  }, [width, height, profile, moonSpans, night, instant, from, to, site.timezone]);

  const scrubFromClientX = useCallback(
    (clientX: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const f = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      onScrub(from + (to - from) * f);
    },
    [from, to, onScrub],
  );

  const dragging = useRef(false);

  return (
    <div className="ribbon">
      <div className="ribbon-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="ribbon-canvas"
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            dragging.current = true;
            scrubFromClientX(e.clientX);
          }}
          onPointerMove={(e) => dragging.current && scrubFromClientX(e.clientX)}
          onPointerUp={() => (dragging.current = false)}
        />

        {events.map((event) => {
          const f = fraction(event.peak, from, to);
          if (f < 0 || f > 1) return null;
          return (
            <button
              key={event.id}
              type="button"
              className={`ribbon-marker${event.id === focusedEventId ? ' is-focused' : ''}`}
              style={{ left: `${f * 100}%`, opacity: 0.35 + (event.score / 100) * 0.65 }}
              onClick={() => onSelectEvent(event)}
              title={`${event.title} — ${formatTime(event.peak, site.timezone)}`}
              aria-label={`${event.title} at ${formatTime(event.peak, site.timezone)}`}
            />
          );
        })}
      </div>

      <div className="ribbon-legend mono">
        <Marker label="Sunset" at={night.sunset} tz={site.timezone} />
        <Marker label="Dusk" at={night.astronomicalDusk} tz={site.timezone} />
        <Marker label="Dawn" at={night.astronomicalDawn} tz={site.timezone} />
        <Marker label="Sunrise" at={night.sunrise} tz={site.timezone} />
        <span className="ribbon-moon">
          Moon {Math.round(night.moonIllumination * 100)}% ·{' '}
          {night.moonrise ? `rises ${formatTime(night.moonrise, site.timezone)}` : 'no rise'} ·{' '}
          {night.moonset ? `sets ${formatTime(night.moonset, site.timezone)}` : 'no set'}
        </span>
      </div>

      {night.darknessNote && <p className="ribbon-note">{night.darknessNote}</p>}
    </div>
  );
}

function Marker({ label, at, tz }: { label: string; at: Instant | null; tz: string }) {
  return (
    <span className="ribbon-stat">
      <span className="ribbon-stat-label">{label}</span>
      <span>{formatTime(at, tz)}</span>
    </span>
  );
}

function fraction(t: Instant, from: Instant, to: Instant): number {
  return (t - from) / (to - from);
}

function ceilToHour(t: Instant): Instant {
  return Math.ceil(t / 3_600_000) * 3_600_000;
}

/** Twilight depth 0–1 → the band's colour, void at full dark. */
function twilightColor(d: number): string {
  // Daylight end of the ramp is the horizon violet lifted a little, so the band
  // stays inside the palette instead of introducing a blue.
  const from = [0x3a, 0x2c, 0x55];
  const to = [0x05, 0x03, 0x11];
  const c = from.map((f, i) => Math.round(f + (to[i] - f) * d));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
