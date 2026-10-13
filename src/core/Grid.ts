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

  /** Distance (in cells) from a cell centre to the island edge; negative = off the island. */
  readonly insetOf: (x: number, y: number) => number;
  /** How many cells deep one shrinking ring is. */
  readonly ringWidth: number;

  constructor(size: number, insetOf?: (x: number, y: number) => number, ringWidth = 1) {
    this.size = size;
    this.insetOf = insetOf ?? ((x, y) => Math.min(x, y, size - 1 - x, size - 1 - y) + 0.5);
    this.ringWidth = ringWidth;
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
  /** Which shrinking ring a cell belongs to, counting inward from the edge (0 = outermost; -1 = off the island). */
  ring(x: number, y: number): number {
    const inset = this.insetOf(x, y);
    return inset < 0 ? -1 : Math.floor(inset / this.ringWidth);
  }
  countOwned(out: number[]): void {
    out.fill(0);
    for (let i = 0; i < this.owner.length; i++) {
      const o = this.owner[i];
      if (o >= 0) out[o]++;
    }
  }
}
