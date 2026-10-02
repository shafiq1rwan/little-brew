import { customerObstacles, type Layout, type Vec2 } from '../config/layout';

/**
 * Small walkability grid over the café floor. A cell is blocked when its center lies within
 * `agentRadius` of an obstacle footprint, a wall, or the open floor edge. Paths are A* over
 * 8-connected cells, then string-pulled with line-of-sight checks so customers walk straight.
 */
export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  private readonly walkable: Uint8Array;

  constructor(private readonly layout: Layout) {
    const { room, nav } = layout;
    this.cols = Math.round((room.maxX - room.minX) / nav.cellSize);
    this.rows = Math.round((room.maxZ - room.minZ) / nav.cellSize);
    this.walkable = new Uint8Array(this.cols * this.rows);
    const r = nav.agentRadius;
    const obstacles = customerObstacles(layout);
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const p = this.cellCenter(col, row);
        let ok =
          p.x > room.minX + r && p.x < room.maxX - r && p.z > room.minZ + r && p.z < room.maxZ - r;
        for (const o of obstacles) {
          if (!ok) break;
          if (Math.abs(p.x - o.x) < o.sx / 2 + r && Math.abs(p.z - o.z) < o.sz / 2 + r) ok = false;
        }
        this.walkable[row * this.cols + col] = ok ? 1 : 0;
      }
    }
  }

  cellCenter(col: number, row: number): Vec2 {
    const { room, nav } = this.layout;
    return { x: room.minX + (col + 0.5) * nav.cellSize, z: room.minZ + (row + 0.5) * nav.cellSize };
  }

  cellOf(p: Vec2): { col: number; row: number } {
    const { room, nav } = this.layout;
    return {
      col: Math.floor((p.x - room.minX) / nav.cellSize),
      row: Math.floor((p.z - room.minZ) / nav.cellSize),
    };
  }

  isWalkableCell(col: number, row: number): boolean {
    return col >= 0 && row >= 0 && col < this.cols && row < this.rows && this.walkable[row * this.cols + col] === 1;
  }

  isWalkable(p: Vec2): boolean {
    const c = this.cellOf(p);
    return this.isWalkableCell(c.col, c.row);
  }

  /** Nearest walkable cell index to a point (searching outward), or -1. */
  private nearestWalkable(p: Vec2): number {
    const c = this.cellOf(p);
    let best = -1;
    let bestD = Infinity;
    for (let radius = 0; radius < Math.max(this.cols, this.rows); radius++) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue;
          const col = c.col + dc;
          const row = c.row + dr;
          if (!this.isWalkableCell(col, row)) continue;
          const cc = this.cellCenter(col, row);
          const d = (cc.x - p.x) ** 2 + (cc.z - p.z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = row * this.cols + col;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** Segment stays on walkable cells (sampled every quarter cell). */
  lineOfSight(a: Vec2, b: Vec2): boolean {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(d / (this.layout.nav.cellSize / 4)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (!this.isWalkable({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })) return false;
    }
    return true;
  }

  /**
   * Waypoints from `from` to `to` (excluding `from`, ending exactly at `to`).
   * Endpoints off the grid (e.g. a chair or the doorway) are connected to the nearest
   * walkable cell. Returns null if no route exists.
   */
  findPath(from: Vec2, to: Vec2): Vec2[] | null {
    if (this.lineOfSight(from, to)) return [{ ...to }];
    const start = this.nearestWalkable(from);
    const goal = this.nearestWalkable(to);
    if (start < 0 || goal < 0) return null;

    const n = this.cols * this.rows;
    const g = new Float64Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const open: number[] = [start];
    const f = new Float64Array(n).fill(Infinity);
    const h = (i: number) => {
      const dc = Math.abs((i % this.cols) - (goal % this.cols));
      const dr = Math.abs(Math.floor(i / this.cols) - Math.floor(goal / this.cols));
      return Math.max(dc, dr) + (Math.SQRT2 - 1) * Math.min(dc, dr);
    };
    g[start] = 0;
    f[start] = h(start);

    while (open.length > 0) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
      const cur = open[bi];
      open[bi] = open[open.length - 1];
      open.pop();
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cc = cur % this.cols;
      const cr = Math.floor(cur / this.cols);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nc = cc + dc;
          const nr = cr + dr;
          if (!this.isWalkableCell(nc, nr)) continue;
          // No corner cutting.
          if (dr && dc && (!this.isWalkableCell(cc + dc, cr) || !this.isWalkableCell(cc, cr + dr))) continue;
          const ni = nr * this.cols + nc;
          if (closed[ni]) continue;
          const ng = g[cur] + (dr && dc ? Math.SQRT2 : 1);
          if (ng < g[ni]) {
            g[ni] = ng;
            f[ni] = ng + h(ni);
            came[ni] = cur;
            open.push(ni);
          }
        }
      }
    }
    if (start !== goal && came[goal] < 0) return null;

    const cells: Vec2[] = [];
    for (let i = goal; i >= 0; i = i === start ? -1 : came[i]) {
      cells.push(this.cellCenter(i % this.cols, Math.floor(i / this.cols)));
    }
    cells.reverse();
    const raw = [...cells, { ...to }];
    return this.smooth(from, raw);
  }

  private smooth(from: Vec2, pts: Vec2[]): Vec2[] {
    const out: Vec2[] = [];
    let anchor = from;
    let i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !this.lineOfSight(anchor, pts[j])) j--;
      out.push(pts[j]);
      anchor = pts[j];
      i = j + 1;
    }
    return out;
  }
}
