import type { Grid } from './Grid';

/**
 * Cells player `pid` gains when closing a loop: its trail plus every cell that the
 * outside of the board can't reach without crossing its land or trail.
 * `protectedCells` (other players' nests) are never taken.
 */
export function computeCapture(grid: Grid, pid: number, protectedCells: Set<number>): number[] {
  const { size, owner, trail, voided } = grid;
  const n = size * size;
  const blocked = (i: number) => owner[i] === pid || trail[i] === pid;
  const reached = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const seed = (i: number) => {
    if (!reached[i] && !blocked(i)) {
      reached[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let k = 0; k < size; k++) {
    seed(k);
    seed((size - 1) * size + k);
    seed(k * size);
    seed(k * size + size - 1);
  }
  for (let i = 0; i < n; i++) if (voided[i]) seed(i);

  while (head < tail) {
    const i = queue[head++];
    const x = i % size;
    const y = (i - x) / size;
    if (x > 0) seed(i - 1);
    if (x < size - 1) seed(i + 1);
    if (y > 0) seed(i - size);
    if (y < size - 1) seed(i + size);
  }

  const gained: number[] = [];
  for (let i = 0; i < n; i++) {
    if (owner[i] === pid || voided[i] || protectedCells.has(i)) continue;
    if (trail[i] === pid || !reached[i]) gained.push(i);
  }
  return gained;
}
