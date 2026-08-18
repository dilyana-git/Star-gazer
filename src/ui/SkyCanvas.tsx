/**
 * The sky surface. Full-bleed canvas: drag to look around, scroll to zoom, tap
 * an object for a detail card.
 *
 * Redraws on state change and during interaction, never on a timer.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { renderSky, type PickTarget, type RenderResult } from '../render/sky';
import type { SkyData } from '../data/catalog';
import { useStore } from '../state/store';

interface Props {
  data: SkyData;
  /** 0–1 dark-adaptation reveal; 1 once the opening animation has finished. */
  reveal: number;
}

export function SkyCanvas({ data, reveal }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resultRef = useRef<RenderResult | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hovered, setHovered] = useState<PickTarget | null>(null);

  const site = useStore((s) => s.site);
  const instant = useStore((s) => s.instant);
  const view = useStore((s) => s.view);
  const layers = useStore((s) => s.layers);
  const setView = useStore((s) => s.setView);
  const select = useStore((s) => s.select);

  // Track the element's box rather than the window's, so the canvas is correct
  // when the panels resize around it.
  useEffect(() => {
    const el = canvasRef.current?.parentElement;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width: Math.round(width), height: Math.round(height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0 || size.height === 0) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size.width * dpr;
    canvas.height = size.height * dpr;
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    resultRef.current = renderSky(ctx, size.width, size.height, {
      site,
      instant,
      view,
      layers,
      data,
      reveal,
    });
  }, [site, instant, view, layers, data, reveal, size]);

  // ── interaction ────────────────────────────────────────────────────────────

  const drag = useRef<{ x: number; y: number; alt: number; az: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      drag.current = {
        x: e.clientX,
        y: e.clientY,
        alt: view.centreAltitude,
        az: view.centreAzimuth,
      };
    },
    [view],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const result = resultRef.current;
      if (!canvas || !result) return;

      if (drag.current) {
        const dx = e.clientX - drag.current.x;
        const dy = e.clientY - drag.current.y;
        // Degrees per pixel scales with the zoom, so a drag feels the same at
        // every field of view.
        const perPixel = (view.fieldRadius * 2) / Math.min(size.width, size.height);
        setView({
          // Dragging right should swing the view to the left of the sky; the
          // chart's mirroring is already in the projection, so this is a plain
          // sign choice made to match the pointer.
          centreAzimuth: drag.current.az + dx * perPixel,
          centreAltitude: Math.max(-30, Math.min(90, drag.current.alt + dy * perPixel)),
        });
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setHovered(pick(result.targets, x, y));
    },
    [setView, view.fieldRadius, size],
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const moved =
      drag.current && Math.hypot(e.clientX - drag.current.x, e.clientY - drag.current.y) > 4;
    drag.current = null;

    if (!moved) {
      const canvas = canvasRef.current;
      const result = resultRef.current;
      if (canvas && result) {
        const rect = canvas.getBoundingClientRect();
        select(pick(result.targets, e.clientX - rect.left, e.clientY - rect.top));
      }
    }
  }, [select]);

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      const next = view.fieldRadius * Math.exp(e.deltaY * 0.0012);
      setView({ fieldRadius: Math.max(2, Math.min(90, next)) });
    },
    [setView, view.fieldRadius],
  );

  // Keyboard equivalents for every pointer gesture — part of the quality floor,
  // not an extra.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      const step = view.fieldRadius / 6;
      const moves: Record<string, () => void> = {
        ArrowLeft: () => setView({ centreAzimuth: view.centreAzimuth - step }),
        ArrowRight: () => setView({ centreAzimuth: view.centreAzimuth + step }),
        ArrowUp: () => setView({ centreAltitude: Math.min(90, view.centreAltitude + step) }),
        ArrowDown: () => setView({ centreAltitude: Math.max(-30, view.centreAltitude - step) }),
        '+': () => setView({ fieldRadius: Math.max(2, view.fieldRadius / 1.3) }),
        '=': () => setView({ fieldRadius: Math.max(2, view.fieldRadius / 1.3) }),
        '-': () => setView({ fieldRadius: Math.min(90, view.fieldRadius * 1.3) }),
      };
      const move = moves[e.key];
      if (move) {
        e.preventDefault();
        move();
      }
    },
    [setView, view],
  );

  return (
    <div className="sky-surface">
      <canvas
        ref={canvasRef}
        className="sky-canvas"
        tabIndex={0}
        role="img"
        aria-label={`The sky from ${site.label}. Use the arrow keys to look around and plus or minus to zoom.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHovered(null)}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        style={{ cursor: hovered ? 'pointer' : drag.current ? 'grabbing' : 'grab' }}
      />
      {hovered && (
        <div className="sky-tooltip" style={{ left: hovered.x, top: hovered.y - 14 }}>
          {hovered.name}
        </div>
      )}
    </div>
  );
}

/** Nearest target under the pointer, if any is close enough to have been meant. */
function pick(targets: PickTarget[], x: number, y: number): PickTarget | null {
  let best: PickTarget | null = null;
  let bestDistance = Infinity;

  for (const t of targets) {
    const d = Math.hypot(t.x - x, t.y - y);
    // A generous floor, because a third-magnitude star is three pixels wide and
    // nobody can hit that.
    if (d <= Math.max(t.r, 10) && d < bestDistance) {
      best = t;
      bestDistance = d;
    }
  }
  return best;
}
