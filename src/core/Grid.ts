export type Dir = 0 | 1 | 2 | 3; // up(-y), right(+x), down(+y), left(-x)
export const DX = [0, 1, 0, -1] as const;
export const DY = [-1, 0, 1, 0] as const;
export const opposite = (d: Dir): Dir => ((d + 2) % 4) as Dir;

// Board state: who owns each cell, whose trail is on it, and whether the Void ate it.
export class Grid {
  readonly size: number;
  readonly owner: Int8Array; // -1 neutral, else player id
  readonly trail: Int8Array; // -1 none, else player id
  readonly voided: Uint8Array;

  readonly cornerRadius: number;

  constructor(size: number, cornerRadius = 0) {
    this.size = size;
    this.cornerRadius = cornerRadius;
    const n = size * size;
    this.owner = new Int8Array(n).fill(-1);
    this.trail = new Int8Array(n).fill(-1);
    this.voided = new Uint8Array(n);
  }

  idx(x: number, y: number): number {
    return y * this.size + x;
  }
  x(i: number): number {
    return i % this.size;
  }
  y(i: number): number {
    return Math.floor(i / this.size);
  }
  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.size && y < this.size;
  }
  walkable(x: number, y: number): boolean {
    return this.inside(x, y) && !this.voided[this.idx(x, y)];
  }
  /**
   * Which ring a cell belongs to, counting inward from the edge of the rounded-square
   * island (0 = outermost). Cells cut off by the rounded corners return -1.
   */
  ring(x: number, y: number): number {
    const h = this.size / 2;
    const r = this.cornerRadius;
    const qx = Math.abs(x + 0.5 - h) - (h - r);
    const qy = Math.abs(y + 0.5 - h) - (h - r);
    const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
    const inside = Math.min(Math.max(qx, qy), 0);
    const inset = r - outside - inside;
    return inset < 0 ? -1 : Math.floor(inset);
  }
  countOwned(out: number[]): void {
    out.fill(0);
    for (let i = 0; i < this.owner.length; i++) {
      const o = this.owner[i];
      if (o >= 0) out[o]++;
    }
  }
}
