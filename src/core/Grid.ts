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

  constructor(size: number) {
    this.size = size;
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
  /** Distance of a cell from the nearest board edge (0 = outer ring). */
  ring(x: number, y: number): number {
    return Math.min(x, y, this.size - 1 - x, this.size - 1 - y);
  }
  countOwned(out: number[]): void {
    out.fill(0);
    for (let i = 0; i < this.owner.length; i++) {
      const o = this.owner[i];
      if (o >= 0) out[o]++;
    }
  }
}
