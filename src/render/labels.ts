/**
 * Label placement (spec §8.4). The hardest part of the render and the most
 * common failure, so it gets its own module and its own rule: if a label
 * cannot be placed without overlap, it is **dropped**. Never overprint.
 *
 * Greedy placement in priority order against a uniform occupancy grid. A
 * ~20px cell is plenty; an R-tree here would be precision applied to the wrong
 * problem.
 */

export type LabelPriority = 0 | 1 | 2 | 3 | 4;

export const PRIORITY = {
  /** Planets and the Moon — always wanted. */
  body: 0 as LabelPriority,
  /** Named first-magnitude stars. */
  brightStar: 1 as LabelPriority,
  /** Constellation names. */
  constellation: 2 as LabelPriority,
  /** Bayer designations. */
  bayer: 3 as LabelPriority,
  /** Deep sky objects. */
  dso: 4 as LabelPriority,
};

export interface LabelRequest {
  text: string;
  /** Anchor point in canvas coordinates — the thing being labelled. */
  x: number;
  y: number;
  /** Radius of the marked object, so the label clears it. */
  clearance: number;
  priority: LabelPriority;
  font: string;
  color: string;
}

export interface PlacedLabel extends LabelRequest {
  /** Final text anchor in canvas coordinates. */
  tx: number;
  ty: number;
  align: CanvasTextAlign;
}

const CELL = 20;

/** Candidate offsets, tried in order: right, left, above, below, then corners. */
const OFFSETS: Array<[number, number, CanvasTextAlign]> = [
  [1, 0, 'left'],
  [-1, 0, 'right'],
  [0, -1, 'center'],
  [0, 1, 'center'],
  [0.7, -0.7, 'left'],
  [-0.7, -0.7, 'right'],
  [0.7, 0.7, 'left'],
  [-0.7, 0.7, 'right'],
];

export class LabelPlacer {
  private readonly cols: number;
  private readonly rows: number;
  private readonly occupied: Uint8Array;
  private readonly requests: LabelRequest[] = [];

  private readonly width: number;
  private readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.cols = Math.ceil(width / CELL) + 1;
    this.rows = Math.ceil(height / CELL) + 1;
    this.occupied = new Uint8Array(this.cols * this.rows);
  }

  add(request: LabelRequest): void {
    this.requests.push(request);
  }

  /**
   * Mark everything outside a circle as occupied.
   *
   * The full-sky chart is a disc, and the canvas is a rectangle. Stars below
   * the horizon are clipped away by the canvas, but labels are drawn afterwards
   * in screen space and would otherwise float in the corners, naming things
   * that are not in the sky. Masking the grid drops them for free, and also
   * stops a label anchored just inside the ring from spilling over it.
   */
  maskOutside(centreX: number, centreY: number, radius: number): void {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = c * CELL + CELL / 2;
        const y = r * CELL + CELL / 2;
        if (Math.hypot(x - centreX, y - centreY) > radius) this.occupied[r * this.cols + c] = 1;
      }
    }
  }

  /**
   * Reserve a rectangle that is not a label — the sky's own furniture, like the
   * cardinal points on the horizon ring, which labels must not collide with.
   */
  reserve(x: number, y: number, w: number, h: number): void {
    this.fill(x - w / 2, y - h / 2, w, h);
  }

  /** Place everything that fits, in priority order. Drops the rest. */
  place(ctx: CanvasRenderingContext2D): PlacedLabel[] {
    const out: PlacedLabel[] = [];
    // Stable within a priority band, so labels do not flicker between frames as
    // the sort shuffles equal keys around.
    const ordered = this.requests
      .map((r, i) => ({ r, i }))
      .sort((a, b) => a.r.priority - b.r.priority || a.i - b.i)
      .map(({ r }) => r);

    for (const request of ordered) {
      ctx.font = request.font;
      const metrics = ctx.measureText(request.text);
      const w = metrics.width + 6;
      const h = 14;

      for (const [dx, dy, align] of OFFSETS) {
        const gap = request.clearance + 5;
        const cx = request.x + dx * (gap + w / 2);
        const cy = request.y + dy * (gap + h / 2);
        const left = cx - w / 2;
        const top = cy - h / 2;

        if (left < 0 || top < 0 || left + w > this.width || top + h > this.height) continue;
        if (this.collides(left, top, w, h)) continue;

        this.fill(left, top, w, h);
        out.push({
          ...request,
          tx: align === 'left' ? left + 3 : align === 'right' ? left + w - 3 : cx,
          ty: cy,
          align,
        });
        break;
      }
      // Falling out of that loop without pushing means there was no room around
      // the anchor. The label is dropped — an overprinted label is worse than
      // an absent one.
    }

    return out;
  }

  private cellRange(x: number, y: number, w: number, h: number) {
    return {
      c0: Math.max(0, Math.floor(x / CELL)),
      c1: Math.min(this.cols - 1, Math.floor((x + w) / CELL)),
      r0: Math.max(0, Math.floor(y / CELL)),
      r1: Math.min(this.rows - 1, Math.floor((y + h) / CELL)),
    };
  }

  private collides(x: number, y: number, w: number, h: number): boolean {
    const { c0, c1, r0, r1 } = this.cellRange(x, y, w, h);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (this.occupied[r * this.cols + c]) return true;
      }
    }
    return false;
  }

  private fill(x: number, y: number, w: number, h: number): void {
    const { c0, c1, r0, r1 } = this.cellRange(x, y, w, h);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        this.occupied[r * this.cols + c] = 1;
      }
    }
  }
}

export function drawLabels(ctx: CanvasRenderingContext2D, labels: PlacedLabel[]): void {
  ctx.textBaseline = 'middle';
  for (const l of labels) {
    ctx.font = l.font;
    ctx.fillStyle = l.color;
    ctx.textAlign = l.align;
    ctx.fillText(l.text, l.tx, l.ty);
  }
  ctx.textAlign = 'left';
}
