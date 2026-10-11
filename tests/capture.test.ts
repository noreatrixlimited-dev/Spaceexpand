import { describe, expect, it } from 'vitest';
import { computeCapture } from '../src/core/capture';
import { Grid } from '../src/core/Grid';

function grid(size = 10) {
  return new Grid(size);
}

describe('computeCapture', () => {
  it('claims the trail and the area it encloses against own land', () => {
    const g = grid();
    // Own land: column x=0..1
    for (let y = 0; y < 10; y++) for (let x = 0; x < 2; x++) g.owner[g.idx(x, y)] = 0;
    // Trail: out from (2,2) to (5,2), down to (5,5), back to (2,5)
    const trail = [
      [2, 2], [3, 2], [4, 2], [5, 2],
      [5, 3], [5, 4], [5, 5],
      [4, 5], [3, 5], [2, 5],
    ];
    for (const [x, y] of trail) g.trail[g.idx(x, y)] = 0;
    const gained = new Set(computeCapture(g, 0, new Set()));
    for (const [x, y] of trail) expect(gained.has(g.idx(x, y))).toBe(true);
    // Interior (2..4, 3..4) enclosed
    for (let y = 3; y <= 4; y++) for (let x = 2; x <= 4; x++) expect(gained.has(g.idx(x, y))).toBe(true);
    // Outside stays unclaimed
    expect(gained.has(g.idx(6, 3))).toBe(false);
    expect(gained.has(g.idx(3, 7))).toBe(false);
    expect(gained.size).toBe(trail.length + 6);
  });

  it('a simple line out and back claims only the trail', () => {
    const g = grid();
    for (let y = 0; y < 10; y++) g.owner[g.idx(0, y)] = 1;
    for (let x = 1; x < 5; x++) g.trail[g.idx(x, 4)] = 1;
    const gained = computeCapture(g, 1, new Set());
    expect(gained.length).toBe(4);
  });

  it('never takes protected cells (enemy nests)', () => {
    const g = grid();
    for (let y = 0; y < 10; y++) g.owner[g.idx(0, y)] = 0;
    for (const [x, y] of [[1, 1], [2, 1], [3, 1], [3, 2], [3, 3], [2, 3], [1, 3]]) g.trail[g.idx(x, y)] = 0;
    const nest = g.idx(2, 2);
    g.owner[nest] = 2;
    const gained = computeCapture(g, 0, new Set([nest]));
    expect(gained.includes(nest)).toBe(false);
  });

  it('enemy land inside the loop is stolen', () => {
    const g = grid();
    for (let y = 0; y < 10; y++) g.owner[g.idx(0, y)] = 0;
    g.owner[g.idx(2, 2)] = 3;
    for (const [x, y] of [[1, 1], [2, 1], [3, 1], [3, 2], [3, 3], [2, 3], [1, 3]]) g.trail[g.idx(x, y)] = 0;
    const gained = computeCapture(g, 0, new Set());
    expect(gained.includes(g.idx(2, 2))).toBe(true);
    expect(gained.includes(g.idx(1, 2))).toBe(true);
  });

  it('void cells count as outside', () => {
    const g = grid();
    for (let y = 0; y < 10; y++) g.owner[g.idx(0, y)] = 0;
    for (const [x, y] of [[1, 1], [2, 1], [3, 1], [3, 2], [3, 3], [2, 3], [1, 3]]) g.trail[g.idx(x, y)] = 0;
    g.voided[g.idx(2, 2)] = 1;
    const gained = computeCapture(g, 0, new Set());
    expect(gained.includes(g.idx(2, 2))).toBe(false);
    expect(gained.includes(g.idx(1, 2))).toBe(false);
  });
});
