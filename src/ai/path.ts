import type { Grid } from '../core/Grid';

/**
 * Breadth-first search on the grid. Returns the cells to walk (excluding the start)
 * to the nearest goal, or null. `passable` is checked for every cell except the start.
 */
export function bfs(
  grid: Grid,
  start: number,
  isGoal: (i: number) => boolean,
  passable: (i: number) => boolean,
  maxDist = Infinity,
): number[] | null {
  const n = grid.size * grid.size;
  const prev = new Int32Array(n).fill(-2);
  const dist = new Int32Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  prev[start] = -1;
  queue[tail++] = start;
  const size = grid.size;
  while (head < tail) {
    const i = queue[head++];
    if (i !== start && isGoal(i)) {
      const path: number[] = [];
      for (let c = i; c !== start; c = prev[c]) path.push(c);
      return path.reverse();
    }
    if (dist[i] >= maxDist) continue;
    const x = i % size;
    const y = (i - x) / size;
    const nbrs = [x > 0 ? i - 1 : -1, x < size - 1 ? i + 1 : -1, y > 0 ? i - size : -1, y < size - 1 ? i + size : -1];
    for (const j of nbrs) {
      if (j < 0 || prev[j] !== -2 || grid.voided[j] || !passable(j)) continue;
      prev[j] = i;
      dist[j] = dist[i] + 1;
      queue[tail++] = j;
    }
  }
  return null;
}

export const manhattan = (grid: Grid, a: number, b: number) =>
  Math.abs(grid.x(a) - grid.x(b)) + Math.abs(grid.y(a) - grid.y(b));
