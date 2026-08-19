/**
 * A draggable bottom sheet, for the phone layout.
 *
 * Three positions: the ribbon alone (peek), the ribbon plus the top of the
 * list (half), and the whole list (full). Drag the handle, or tap it to cycle.
 * Tapping matters as much as dragging — one hand, in the dark, in gloves.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export type SheetSnap = 'peek' | 'half' | 'full';

interface Props {
  /** Height of the always-visible part, in pixels. */
  peekHeight: number;
  snap: SheetSnap;
  onSnapChange(snap: SheetSnap): void;
  /** Shown in the always-visible part, beside the handle. */
  header: ReactNode;
  children: ReactNode;
}

/** Fractions of the sheet's full height that each position leaves showing. */
const SHOWING: Record<SheetSnap, number> = { peek: 0, half: 0.5, full: 1 };
const ORDER: SheetSnap[] = ['peek', 'half', 'full'];

export function BottomSheet({ peekHeight, snap, onSnapChange, header, children }: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const [drag, setDrag] = useState<{ startY: number; startOffset: number; offset: number } | null>(null);

  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // How far the sheet is pushed down. At `peek` only the header shows.
  const travel = Math.max(0, height - peekHeight);
  const offsetFor = (s: SheetSnap) => travel * (1 - SHOWING[s]);
  const offset = drag ? drag.offset : offsetFor(snap);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ startY: e.clientY, startOffset: offsetFor(snap), offset: offsetFor(snap) });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap, travel],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag) return;
      const next = Math.max(0, Math.min(travel, drag.startOffset + (e.clientY - drag.startY)));
      setDrag({ ...drag, offset: next });
    },
    [drag, travel],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (!drag) return;
    const moved = Math.abs(drag.offset - drag.startOffset);

    // A tap rather than a drag: cycle to the next position. Wrapping round from
    // full back to peek means one control does the whole job.
    if (moved < 6) {
      const i = ORDER.indexOf(snap);
      onSnapChange(ORDER[(i + 1) % ORDER.length]);
      setDrag(null);
      return;
    }

    // Otherwise settle on whichever position is nearest to where it was let go.
    let best: SheetSnap = 'peek';
    let bestDistance = Infinity;
    for (const s of ORDER) {
      const d = Math.abs(offsetFor(s) - drag.offset);
      if (d < bestDistance) {
        best = s;
        bestDistance = d;
      }
    }
    onSnapChange(best);
    setDrag(null);
  }, [drag, snap, onSnapChange, travel]);

  const label = snap === 'full' ? 'Collapse the list' : 'Expand the list';

  return (
    <div
      ref={sheetRef}
      className={`sheet${drag ? ' is-dragging' : ''}`}
      style={{ transform: `translateY(${offset}px)` }}
    >
      {/*
        The drag surface is the grip alone, deliberately. The header below it
        holds the night ribbon, which is itself dragged to scrub time — if the
        two shared a surface, every scrub would move the sheet instead.
      */}
      <button
        type="button"
        className="sheet-grip"
        aria-label={label}
        aria-expanded={snap !== 'peek'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={(e) => {
          // The pointer handlers already cycle on a tap. This catches the
          // keyboard, where there is no pointer sequence at all.
          if (e.detail === 0) onSnapChange(ORDER[(ORDER.indexOf(snap) + 1) % ORDER.length]);
        }}
      >
        {/* The bar is decoration. The whole row is the target. */}
        <span className="sheet-handle" aria-hidden="true" />
      </button>

      <div className="sheet-header">{header}</div>

      <div className="sheet-body" aria-hidden={snap === 'peek'}>
        {children}
      </div>
    </div>
  );
}
