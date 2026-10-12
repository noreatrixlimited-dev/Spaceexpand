import { describe, expect, it } from 'vitest';
import { CONFIG, type MatchOptions } from '../src/config';
import { Game } from '../src/core/Game';
import type { Dir } from '../src/core/Grid';

const UP: Dir = 0, RIGHT: Dir = 1, DOWN: Dir = 2, LEFT: Dir = 3;
const ANGLE = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];
const DT = 1 / CONFIG.tickRate;

function newGame(over: Partial<MatchOptions> = {}) {
  return new Game({ startMode: 'patch', hardMode: false, humanSlot: 0, difficulty: 'normal', seed: 1, ...over });
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

describe('island', () => {
  it('has rounded corners', () => {
    const g = newGame();
    expect(g.grid.walkable(0, 0)).toBe(false);
    expect(g.grid.walkable(20, 0)).toBe(true);
    expect(g.grid.walkable(0, 20)).toBe(true);
  });
  it('gives each player a patch around its nest', () => {
    const g = newGame();
    const n = g.land[0];
    expect(n).toBeGreaterThan(28);
    expect(g.land).toEqual([n, n, n, n]);
    for (const c of g.cores) expect(owned(g, c.x, c.y)).toBe(c.owner);
  });
  it('quadrant mode gives each player a quarter (minus corners)', () => {
    const g = newGame({ startMode: 'quadrant' });
    expect(g.land[0]).toBeGreaterThan(350);
    expect(new Set(g.land).size).toBe(1);
  });
});

describe('free movement', () => {
  it('moves smoothly toward the aim and turns gradually', () => {
    const g = newGame();
    const p = g.players[0];
    p.heading = 0;
    g.setAim(0, Math.PI / 2);
    g.tick(DT);
    expect(p.heading).toBeGreaterThan(0);
    expect(p.heading).toBeLessThan(Math.PI / 2);
    for (let i = 0; i < 10; i++) g.tick(DT);
    expect(p.heading).toBeCloseTo(Math.PI / 2, 5);
    expect(p.py).toBeGreaterThan(g.cores[0].y + 0.5);
  });
  it('moves diagonally and leaves a 4-connected trail', () => {
    const g = newGame();
    const p = g.players[0];
    p.heading = Math.PI / 4;
    g.setAim(0, Math.PI / 4);
    for (let i = 0; i < 40; i++) g.tick(DT);
    expect(p.trail.length).toBeGreaterThan(3);
    for (let k = 1; k < p.trail.length; k++) {
      const a = p.trail[k - 1], b = p.trail[k];
      const d = Math.abs(g.grid.x(a) - g.grid.x(b)) + Math.abs(g.grid.y(a) - g.grid.y(b));
      expect(d).toBe(1);
    }
  });
  it('slides along the edge instead of leaving the island', () => {
    const g = newGame();
    place(g, 0, 20, 1);
    g.players[0].heading = -Math.PI / 2 + 0.3;
    g.setAim(0, -Math.PI / 2 + 0.3);
    for (let i = 0; i < 30; i++) g.tick(DT);
    const p = g.players[0];
    expect(g.grid.walkable(p.x, p.y)).toBe(true);
    expect(p.px).toBeGreaterThan(20.5);
  });
});

describe('painting', () => {
  it('leaves a trail outside own land and captures on return', () => {
    const g = newGame();
    const p = g.players[0];
    const start = g.land[0];
    walk(g, 0, RIGHT, 5); // (4,4) -> (9,4): trail (7..9, 4)
    expect(p.trail.length).toBe(3);
    walk(g, 0, DOWN, 2); // (9,6)
    walk(g, 0, LEFT, 3); // (6,6) back home
    expect(p.trail.length).toBe(0);
    expect(g.land[0]).toBe(start + 7 + 2);
  });
  it('crossing your own trail is safe in normal mode', () => {
    const g = newGame();
    walk(g, 0, RIGHT, 5);
    walk(g, 0, DOWN, 2);
    walk(g, 0, LEFT, 1);
    walk(g, 0, UP, 2); // crosses own trail at (8,4)
    expect(g.players[0].status).toBe('alive');
  });
  it('crossing your own trail bonks you in hard mode', () => {
    const g = newGame({ hardMode: true });
    walk(g, 0, RIGHT, 5);
    walk(g, 0, DOWN, 2);
    walk(g, 0, LEFT, 1);
    walk(g, 0, UP, 2);
    expect(g.players[0].status).toBe('bonked');
  });
});

describe('bonks', () => {
  it('an enemy stepping on your trail bonks you and costs a heart', () => {
    const g = newGame();
    walk(g, 0, RIGHT, 5);
    place(g, 1, 8, 5);
    step(g, 1, UP);
    expect(g.players[0].status).toBe('bonked');
    expect(g.players[0].trail.length).toBe(0);
    expect(g.cores[0].hearts).toBe(CONFIG.coreHearts - 1);
    for (let i = 0; i < CONFIG.bonkSeconds * CONFIG.tickRate + 2; i++) g.tick(DT);
    expect(g.players[0].status).toBe('alive');
    expect([g.players[0].x, g.players[0].y]).toEqual([g.cores[0].x, g.cores[0].y]);
  });
});

describe('nests', () => {
  function hitUntilStolen(g: Game) {
    const core = g.cores[0];
    for (let k = 0; k < 10 && core.state === 'nest'; k++) {
      place(g, 1, core.x, core.y + 2);
      step(g, 1, UP);
      core.invuln = 0;
    }
  }
  it('lose hearts on touch, then get carried and captured', () => {
    const g = newGame();
    hitUntilStolen(g);
    const core = g.cores[0];
    expect(core.state).toBe('carried');
    expect(g.players[1].carrying).toBe(0);
    const home = g.cores[1];
    place(g, 1, home.x, home.y - 2);
    step(g, 1, DOWN);
    expect(core.state).toBe('captured');
    expect(g.players[0].status).toBe('shade');
    expect(g.land[0]).toBe(0);
  });
  it('bumping into a carrier sends the egg home with one heart', () => {
    const g = newGame();
    hitUntilStolen(g);
    place(g, 1, 15, 15);
    place(g, 2, 16, 15);
    step(g, 2, LEFT);
    expect(g.cores[0].state).toBe('nest');
    expect(g.cores[0].hearts).toBe(1);
  });
  it('last nest standing wins', () => {
    const g = newGame();
    for (const id of [1, 2, 3]) g.cores[id].state = 'captured';
    g.tick(DT);
    expect(g.over).toBe(true);
    expect(g.winner).toBe(0);
  });
  it('most land wins when time runs out', () => {
    const g = newGame();
    walk(g, 0, RIGHT, 5);
    walk(g, 0, DOWN, 2);
    walk(g, 0, LEFT, 3);
    g.time = CONFIG.matchSeconds;
    g.tick(DT);
    expect(g.winner).toBe(0);
  });
});

describe('the void', () => {
  it('eats rings in a rounded shape and slides nests inward', () => {
    const g = newGame();
    const core = g.cores[0];
    const ringOfCore = g.grid.ring(core.x, core.y);
    for (let r = 0; r <= ringOfCore; r++) {
      g.voidTimer = 0.001;
      g.tick(DT);
    }
    expect(g.grid.walkable(20, 0)).toBe(false);
    expect(g.grid.walkable(20, ringOfCore + 1)).toBe(true);
    expect(core.x).toBeGreaterThan(4);
    expect(g.grid.walkable(core.x, core.y)).toBe(true);
    expect(owned(g, core.x, core.y)).toBe(0);
  });
});

describe('ghosts', () => {
  it('a ghost touching a third player nest breaks free', () => {
    const g = newGame();
    const p = g.players[0];
    g.cores[0].state = 'captured';
    p.status = 'shade';
    p.shadeOf = 1;
    const target = g.cores[3];
    place(g, 0, target.x, target.y + 3);
    step(g, 0, UP);
    step(g, 0, UP);
    expect(p.status).toBe('alive');
    expect(g.cores[0].state).toBe('nest');
  });
});

describe('balls', () => {
  const land = (g: Game) => {
    for (let i = 0; i < 40; i++) g.tick(DT);
  };

  it('more land means a bigger pouch', () => {
    const g = newGame();
    const small = g.ballCap(0);
    for (let i = 0; i < 300; i++) g.grid.owner[300 + i] = 0;
    g.tick(DT);
    expect(g.ballCap(0)).toBeGreaterThan(small);
    expect(g.ballCap(0)).toBeLessThanOrEqual(CONFIG.ballCapMax);
  });

  it('balls refill over time, faster with more land', () => {
    const a = newGame();
    const b = newGame();
    for (let i = 0; i < 300; i++) b.grid.owner[300 + i] = 0;
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
    p.balls = 3;
    expect(g.throwBall(0, 0, 6)).toBe(true);
    expect(p.balls).toBe(2);
    land(g);
    const tx = Math.floor(p.px + 6);
    expect(owned(g, tx, p.y)).toBe(0);
    expect(owned(g, tx + 1, p.y)).toBe(0);
  });

  it('a splat on an enemy trail bonks them', () => {
    const g = newGame();
    const enemy = g.players[1];
    place(g, 1, 12, 8);
    const cell = g.grid.idx(12, 6);
    g.grid.trail[cell] = 1;
    enemy.trail.push(cell);
    place(g, 0, 12, 12);
    g.players[0].balls = 1;
    g.throwAt(0, 12.5, 6.5);
    land(g);
    expect(enemy.status).toBe('bonked');
  });

  it('a direct hit stuns, knocks back and drops a carried egg', () => {
    const g = newGame();
    const q = g.players[2];
    place(g, 2, 15, 15);
    g.cores[0].state = 'carried';
    g.cores[0].carrier = 2;
    q.carrying = 0;
    place(g, 0, 15, 20);
    g.players[0].balls = 1;
    g.throwAt(0, 15.5, 15.3);
    for (let i = 0; i < 25; i++) g.tick(DT);
    expect(q.stunTimer).toBeGreaterThan(0);
    expect(q.carrying).toBe(-1);
    expect(g.cores[0].state).toBe('nest');
    expect(Math.hypot(q.px - 15.5, q.py - 15.3)).toBeGreaterThan(1);
  });

  it('a ball on an enemy nest pops a heart but never steals the egg', () => {
    const g = newGame();
    const c = g.cores[1];
    c.hearts = 1;
    place(g, 0, c.x, c.y - 5);
    g.players[0].balls = 2;
    g.throwAt(0, c.x + 0.5, c.y + 0.5);
    land(g);
    expect(c.hearts).toBe(0);
    expect(c.state).toBe('nest');
    c.invuln = 0;
    g.players[0].throwCooldown = 0;
    g.throwAt(0, c.x + 0.5, c.y + 0.5);
    land(g);
    expect(c.state).toBe('nest');
    expect(owned(g, c.x, c.y)).toBe(1); // nests can't be painted
  });

  it('auto-aim picks an enemy near the facing direction', () => {
    const g = newGame();
    place(g, 0, 15, 15);
    place(g, 2, 20, 16);
    g.players[0].heading = 0;
    const t = g.autoTarget(g.players[0]);
    expect(t).not.toBeNull();
    expect(t!.dist).toBeCloseTo(Math.hypot(5, 1), 3);
  });

  it('walking over a pickup gives balls', () => {
    const g = newGame();
    g.pickups.push({ id: 99, x: 15, y: 15 });
    place(g, 0, 14, 15);
    g.players[0].balls = 0;
    step(g, 0, RIGHT);
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
