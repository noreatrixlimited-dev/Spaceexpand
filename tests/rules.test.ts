import { describe, expect, it } from 'vitest';
import { CONFIG, UNIT, type MatchOptions } from '../src/config';
import { Game } from '../src/core/Game';
import type { Dir } from '../src/core/Grid';
import { MAPS } from '../src/maps';

const UP: Dir = 0, RIGHT: Dir = 1, DOWN: Dir = 2, LEFT: Dir = 3;
const ANGLE = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];
const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
const DT = 1 / CONFIG.tickRate;
const U = UNIT;

function newGame(over: Partial<MatchOptions> = {}) {
  return new Game({ map: 'classic', startMode: 'patch', hardMode: false, humanSlot: 0, difficulty: 'normal', seed: 1, ...over });
}

/** Move a player exactly one cell in direction d (straight line from the cell centre). */
function step(g: Game, pid: number, d: Dir) {
  const p = g.players[pid];
  const sx = p.x, sy = p.y;
  p.heading = ANGLE[d];
  g.setDir(pid, d);
  for (let i = 0; i < 60 && p.x === sx && p.y === sy && p.status !== 'bonked'; i++) g.tick(DT);
  p.moving = false;
  p.px = p.x + 0.5;
  p.py = p.y + 0.5;
}
function walk(g: Game, pid: number, d: Dir, n: number) {
  for (let i = 0; i < n; i++) step(g, pid, d);
}
function place(g: Game, pid: number, x: number, y: number) {
  const p = g.players[pid];
  p.x = x;
  p.y = y;
  p.px = x + 0.5;
  p.py = y + 0.5;
  p.moving = false;
}
const owned = (g: Game, x: number, y: number) => g.grid.owner[g.grid.idx(x, y)];
/** Number of cells from (x, y) in direction d until leaving player's own land. */
function cellsToEdge(g: Game, pid: number, x: number, y: number, d: Dir) {
  let n = 0;
  while (owned(g, x + DX[d] * (n + 1), y + DY[d] * (n + 1)) === pid) n++;
  return n;
}

describe('maps', () => {
  for (const m of MAPS) {
    it(`${m.name}: island shape, 4 nests with equal starting land`, () => {
      const g = newGame({ map: m.id });
      const s = g.grid.size;
      expect(g.grid.walkable(Math.floor(s / 2), Math.floor(s / 2))).toBe(true);
      expect(g.grid.walkable(0, 0)).toBe(false);
      const n = g.land[0];
      expect(n).toBeGreaterThan(200);
      expect(g.land).toEqual([n, n, n, n]);
      for (const c of g.cores) expect(owned(g, c.x, c.y)).toBe(c.owner);
    });
  }
  it('quadrant mode gives each player a quarter', () => {
    const g = newGame({ startMode: 'quadrant', map: 'classic' });
    expect(new Set(g.land).size).toBe(1);
    expect(g.land[0]).toBeGreaterThan(2500);
  });
});

describe('free movement', () => {
  it('turns gradually toward the aim', () => {
    const g = newGame();
    const p = g.players[0];
    p.heading = 0;
    g.setAim(0, Math.PI / 2);
    g.tick(DT);
    expect(p.heading).toBeGreaterThan(0);
    expect(p.heading).toBeLessThan(Math.PI / 2);
    for (let i = 0; i < 30; i++) g.tick(DT);
    expect(p.heading).toBeCloseTo(Math.PI / 2, 5);
  });
  it('moves diagonally and leaves a 4-connected trail', () => {
    const g = newGame();
    const p = g.players[0];
    p.heading = Math.PI / 4;
    g.setAim(0, Math.PI / 4);
    for (let i = 0; i < 90; i++) g.tick(DT);
    expect(p.trail.length).toBeGreaterThan(5);
    for (let k = 1; k < p.trail.length; k++) {
      const a = p.trail[k - 1], b = p.trail[k];
      expect(Math.abs(g.grid.x(a) - g.grid.x(b)) + Math.abs(g.grid.y(a) - g.grid.y(b))).toBe(1);
    }
  });
  it('slides along the edge instead of leaving the island', () => {
    const g = newGame();
    const mid = g.grid.size / 2;
    let y = 0;
    while (!g.grid.walkable(mid, y)) y++;
    place(g, 0, mid, y);
    g.players[0].heading = -Math.PI / 2 + 0.3;
    g.setAim(0, -Math.PI / 2 + 0.3);
    for (let i = 0; i < 40; i++) g.tick(DT);
    const p = g.players[0];
    expect(g.grid.walkable(p.x, p.y)).toBe(true);
    expect(p.px).toBeGreaterThan(mid + 1);
  });
});

describe('painting', () => {
  it('leaves a trail outside own land and captures on return', () => {
    const g = newGame();
    const p = g.players[0];
    const c = g.cores[0];
    const start = g.land[0];
    const out = cellsToEdge(g, 0, c.x, c.y, RIGHT);
    walk(g, 0, RIGHT, out + 3); // 3 trail cells
    expect(p.trail.length).toBe(3);
    walk(g, 0, DOWN, 2);
    walk(g, 0, LEFT, 4); // back home
    expect(p.trail.length).toBe(0);
    expect(g.land[0]).toBeGreaterThan(start + 7);
  });
  it('crossing your own trail is safe in normal mode, a bonk in hard mode', () => {
    for (const hardMode of [false, true]) {
      const g = newGame({ hardMode });
      const c = g.cores[0];
      walk(g, 0, RIGHT, cellsToEdge(g, 0, c.x, c.y, RIGHT) + 4);
      walk(g, 0, DOWN, 2);
      walk(g, 0, LEFT, 1);
      walk(g, 0, UP, 3);
      expect(g.players[0].status).toBe(hardMode ? 'bonked' : 'alive');
    }
  });
});

describe('bonks', () => {
  it('an enemy stepping on your trail bonks you and costs a heart', () => {
    const g = newGame();
    const c = g.cores[0];
    walk(g, 0, RIGHT, cellsToEdge(g, 0, c.x, c.y, RIGHT) + 3);
    const t = g.players[0].trail[1];
    place(g, 1, g.grid.x(t), g.grid.y(t) + 1);
    step(g, 1, UP);
    expect(g.players[0].status).toBe('bonked');
    expect(g.cores[0].hearts).toBe(CONFIG.coreHearts - 1);
    for (let i = 0; i < CONFIG.bonkSeconds * CONFIG.tickRate + 2; i++) g.tick(DT);
    expect(g.players[0].status).toBe('alive');
    expect([g.players[0].x, g.players[0].y]).toEqual([c.x, c.y]);
  });
});

describe('nests', () => {
  function hitUntilStolen(g: Game) {
    const core = g.cores[0];
    for (let k = 0; k < 10 && core.state === 'nest'; k++) {
      place(g, 1, core.x, core.y + Math.ceil(CONFIG.nestReach) + 1);
      walk(g, 1, UP, 2);
      core.invuln = 0;
    }
  }
  it('lose hearts on touch, then get carried and captured', () => {
    const g = newGame();
    hitUntilStolen(g);
    const core = g.cores[0];
    expect(core.state).toBe('carried');
    const home = g.cores[1];
    place(g, 1, home.x, home.y - Math.ceil(CONFIG.nestReach) - 1);
    walk(g, 1, DOWN, 2);
    expect(core.state).toBe('captured');
    expect(g.players[0].status).toBe('out');
    expect(g.land[0]).toBe(0);
  });
  it('a stolen egg is captured the moment the thief touches any land in their colour', () => {
    const g = newGame();
    hitUntilStolen(g);
    expect(g.cores[0].state).toBe('carried');
    // Paint a far-away patch for player 1 (nowhere near their nest), then ride onto it.
    const m = g.grid.size / 2;
    for (let y = m - 2; y <= m + 2; y++) for (let x = m + 3; x <= m + 6; x++) g.grid.owner[g.grid.idx(x, y)] = 1;
    place(g, 1, m, m);
    walk(g, 1, RIGHT, 3);
    expect(g.cores[0].state).toBe('captured');
    expect(g.players[0].status).toBe('out');
  });
  it('bumping into a carrier sends the egg home with one heart', () => {
    const g = newGame();
    hitUntilStolen(g);
    const m = g.grid.size / 2;
    place(g, 1, m, m);
    place(g, 2, m + 2, m);
    step(g, 2, LEFT);
    expect(g.cores[0].state).toBe('nest');
    expect(g.cores[0].hearts).toBe(1);
  });
  it('last nest standing wins; most land wins at the timer', () => {
    const g = newGame();
    for (const id of [1, 2, 3]) g.cores[id].state = 'captured';
    g.tick(DT);
    expect(g.winner).toBe(0);
    const h = newGame();
    for (let i = 0; i < 50; i++) h.grid.owner[h.grid.idx(h.grid.size / 2 + (i % 10), h.grid.size / 2 + Math.floor(i / 10))] = 2;
    h.time = CONFIG.matchSeconds;
    h.tick(DT);
    expect(h.winner).toBe(2);
  });
});

describe('the void', () => {
  it('eats one-unit rings following the map shape and slides nests inward', () => {
    const g = newGame({ map: 'classic' });
    const core = g.cores[0];
    const ringOfCore = g.grid.ring(core.x, core.y);
    const sx = core.x;
    for (let r = 0; r <= ringOfCore; r++) {
      g.voidTimer = 0.0001;
      g.tick(DT);
    }
    const mid = g.grid.size / 2;
    expect(g.grid.walkable(mid, 0 + U)).toBe(false);
    expect(g.grid.walkable(mid, mid)).toBe(true);
    expect(core.x).toBeGreaterThan(sx);
    expect(g.grid.walkable(core.x, core.y)).toBe(true);
    expect(owned(g, core.x, core.y)).toBe(0);
  });
});

describe('ghosts', () => {
  it('a captured player stays out for good, even touching another nest', () => {
    const g = newGame();
    const p = g.players[0];
    g.cores[0].state = 'captured';
    p.status = 'out';
    p.shadeOf = 1;
    const target = g.cores[3];
    place(g, 0, target.x, target.y + Math.ceil(CONFIG.nestReach) + 2);
    walk(g, 0, UP, 3);
    expect(p.status).toBe('out');
    expect(g.cores[0].state).toBe('captured');
  });
});

describe('balls', () => {
  const fly = (g: Game) => {
    for (let i = 0; i < 80; i++) g.tick(DT);
  };
  const mid = (g: Game) => g.grid.size / 2;

  it('more land means a bigger pouch and faster refills', () => {
    const a = newGame();
    const b = newGame();
    const small = b.ballCap(0);
    for (let i = 0; i < 3000; i++) if (b.grid.owner[5000 + i] === -1 && !b.grid.voided[5000 + i]) b.grid.owner[5000 + i] = 0;
    b.tick(DT);
    expect(b.ballCap(0)).toBeGreaterThan(small);
    for (const g of [a, b]) {
      g.players[0].balls = 0;
      for (let i = 0; i < 6 * CONFIG.tickRate; i++) g.tick(DT);
    }
    expect(a.players[0].balls).toBeGreaterThan(0);
    expect(b.players[0].balls).toBeGreaterThan(a.players[0].balls);
  });

  it('a thrown ball paints a splat of land', () => {
    const g = newGame();
    const p = g.players[0];
    place(g, 0, mid(g), mid(g));
    p.balls = 3;
    expect(g.throwBall(0, 0, 5 * U)).toBe(true);
    expect(p.balls).toBe(2);
    fly(g);
    expect(owned(g, mid(g) + 5 * U, mid(g))).toBe(0);
    expect(owned(g, mid(g) + 5 * U + 2, mid(g) + 1)).toBe(0);
  });

  it('a splat on an enemy trail bonks them', () => {
    const g = newGame();
    const m = mid(g);
    const enemy = g.players[1];
    place(g, 1, m, m - 3 * U);
    const cell = g.grid.idx(m, m - 5 * U);
    g.grid.trail[cell] = 1;
    enemy.trail.push(cell);
    place(g, 0, m, m);
    g.players[0].balls = 1;
    g.throwAt(0, m + 0.5, m - 5 * U + 0.5);
    fly(g);
    expect(enemy.status).toBe('bonked');
  });

  it('a direct hit stuns, knocks back and drops a carried egg', () => {
    const g = newGame();
    const m = mid(g);
    const q = g.players[2];
    place(g, 2, m, m);
    g.cores[0].state = 'carried';
    g.cores[0].carrier = 2;
    q.carrying = 0;
    place(g, 0, m, m + 5 * U);
    g.players[0].balls = 1;
    g.throwAt(0, m + 0.5, m + 0.2);
    for (let i = 0; i < 50; i++) g.tick(DT);
    expect(q.stunTimer).toBeGreaterThan(0);
    expect(q.carrying).toBe(-1);
    expect(g.cores[0].state).toBe('nest');
    expect(Math.hypot(q.px - (m + 0.5), q.py - (m + 0.2))).toBeGreaterThan(U);
  });

  it('a ball on an enemy nest pops a heart but never steals or paints it', () => {
    const g = newGame();
    const c = g.cores[1];
    c.hearts = 1;
    place(g, 0, c.x, c.y - 5 * U);
    g.players[0].balls = 2;
    g.throwAt(0, c.x + 0.5, c.y + 0.5);
    fly(g);
    expect(c.hearts).toBe(0);
    c.invuln = 0;
    g.players[0].throwCooldown = 0;
    g.throwAt(0, c.x + 0.5, c.y + 0.5);
    fly(g);
    expect(c.state).toBe('nest');
    expect(owned(g, c.x, c.y)).toBe(1);
  });

  it('auto-aim picks an enemy near the facing direction', () => {
    const g = newGame();
    const m = mid(g);
    place(g, 0, m, m);
    place(g, 2, m + 5 * U, m + 1);
    g.players[0].heading = 0;
    const t = g.autoTarget(g.players[0]);
    expect(t).not.toBeNull();
    expect(t!.dist).toBeCloseTo(Math.hypot(5 * U, 1), 3);
  });

  it('walking onto a pickup gives balls', () => {
    const g = newGame();
    const m = mid(g);
    g.pickups.push({ id: 99, x: m + 4, y: m });
    place(g, 0, m, m);
    g.players[0].balls = 0;
    walk(g, 0, RIGHT, 2);
    expect(g.players[0].balls).toBe(CONFIG.pickupBalls);
    expect(g.pickups.length).toBe(0);
  });

  it('cannot throw with an empty pouch or while stunned', () => {
    const g = newGame();
    g.players[0].balls = 0;
    expect(g.throwBall(0)).toBe(false);
    g.players[0].balls = 2;
    g.players[0].stunTimer = 1;
    expect(g.throwBall(0)).toBe(false);
  });
});
