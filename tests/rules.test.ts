import { describe, expect, it } from 'vitest';
import { CONFIG, type MatchOptions } from '../src/config';
import { Game } from '../src/core/Game';
import type { Dir } from '../src/core/Grid';

const UP: Dir = 0, RIGHT: Dir = 1, DOWN: Dir = 2, LEFT: Dir = 3;
const DT = 1 / CONFIG.tickRate;

function newGame(over: Partial<MatchOptions> = {}) {
  return new Game({ startMode: 'patch', hardMode: false, humanSlot: 0, difficulty: 'normal', seed: 1, ...over });
}

/** Move player one cell in direction d. */
function step(g: Game, pid: number, d: Dir) {
  const p = g.players[pid];
  const sx = p.x, sy = p.y;
  g.setDir(pid, d);
  for (let i = 0; i < 60 && p.x === sx && p.y === sy && p.status !== 'bonked'; i++) g.tick(DT);
  // stop after one cell
  p.dir = null;
  p.nextDir = null;
  p.progress = 0;
}
function walk(g: Game, pid: number, d: Dir, n: number) {
  for (let i = 0; i < n; i++) step(g, pid, d);
}
function place(g: Game, pid: number, x: number, y: number) {
  const p = g.players[pid];
  p.x = x;
  p.y = y;
  p.dir = null;
  p.nextDir = null;
  p.progress = 0;
}

describe('setup', () => {
  it('gives each player a 6x6 patch in their corner', () => {
    const g = newGame();
    expect(g.land).toEqual([36, 36, 36, 36]);
    expect(g.grid.owner[g.grid.idx(0, 0)]).toBe(0);
    expect(g.grid.owner[g.grid.idx(0, 39)]).toBe(1);
    expect(g.grid.owner[g.grid.idx(39, 39)]).toBe(2);
    expect(g.grid.owner[g.grid.idx(39, 0)]).toBe(3);
  });
  it('quadrant mode gives each player a quarter', () => {
    const g = newGame({ startMode: 'quadrant' });
    expect(g.land).toEqual([400, 400, 400, 400]);
  });
});

describe('painting', () => {
  it('leaves a trail outside own land and captures on return', () => {
    const g = newGame();
    const p = g.players[0];
    walk(g, 0, RIGHT, 6); // (2,2) -> (8,2): cells 6,7,8 are trail
    expect(p.trail.length).toBe(3);
    walk(g, 0, DOWN, 3); // (8,5)
    walk(g, 0, LEFT, 3); // (5,5) back on own land
    expect(p.trail.length).toBe(0);
    // Trail 3+3+2 = 8 cells plus enclosed 2x2 (6..7, 3..4) = 4
    expect(g.land[0]).toBe(36 + 8 + 4);
  });

  it('crossing your own trail is safe in normal mode', () => {
    const g = newGame();
    walk(g, 0, RIGHT, 6);
    walk(g, 0, DOWN, 2);
    walk(g, 0, LEFT, 1);
    walk(g, 0, UP, 2); // crosses own trail at (7,2)
    expect(g.players[0].status).toBe('alive');
  });

  it('crossing your own trail bonks you in hard mode', () => {
    const g = newGame({ hardMode: true });
    walk(g, 0, RIGHT, 6);
    walk(g, 0, DOWN, 2);
    walk(g, 0, LEFT, 1);
    walk(g, 0, UP, 2);
    expect(g.players[0].status).toBe('bonked');
  });
});

describe('bonks', () => {
  it('an enemy stepping on your trail bonks you and costs a heart', () => {
    const g = newGame();
    walk(g, 0, RIGHT, 6); // trail at (6..8, 2)
    place(g, 1, 7, 3);
    step(g, 1, UP); // onto (7,2)
    expect(g.players[0].status).toBe('bonked');
    expect(g.players[0].trail.length).toBe(0);
    expect(g.cores[0].hearts).toBe(CONFIG.coreHearts - 1);
    expect(g.players[1].stats.bonks).toBe(1);
    for (let i = 0; i < CONFIG.bonkSeconds * CONFIG.tickRate + 2; i++) g.tick(DT);
    expect(g.players[0].status).toBe('alive');
    expect([g.players[0].x, g.players[0].y]).toEqual([g.cores[0].x, g.cores[0].y]);
  });
});

describe('cores', () => {
  function hitUntilStolen(g: Game) {
    // Player 1 next to player 0's core at (2,2), bouncing in and out.
    const core = g.cores[0];
    for (let k = 0; k < 10 && core.state === 'nest'; k++) {
      place(g, 1, 2, 4);
      step(g, 1, UP); // (2,3) is adjacent to the core
      core.invuln = 0;
    }
  }

  it('loses hearts on touch, then gets carried and captured', () => {
    const g = newGame();
    hitUntilStolen(g);
    const core = g.cores[0];
    expect(core.state).toBe('carried');
    expect(g.players[1].carrying).toBe(0);
    // Teleport carrier home next to its own core at (2,37)
    place(g, 1, 2, 35);
    step(g, 1, DOWN);
    expect(core.state).toBe('captured');
    expect(g.players[0].status).toBe('shade');
    expect(g.players[0].shadeOf).toBe(1);
    expect(g.land[0]).toBe(0);
  });

  it('bumping into a carrier sends the egg home with one heart', () => {
    const g = newGame();
    hitUntilStolen(g);
    place(g, 1, 10, 10);
    place(g, 2, 11, 10);
    step(g, 2, LEFT);
    expect(g.cores[0].state).toBe('nest');
    expect(g.cores[0].hearts).toBe(1);
    expect(g.players[1].carrying).toBe(-1);
  });

  it('last core standing wins', () => {
    const g = newGame();
    for (const id of [1, 2, 3]) g.cores[id].state = 'captured';
    g.tick(DT);
    expect(g.over).toBe(true);
    expect(g.winner).toBe(0);
  });

  it('most land wins when time runs out', () => {
    const g = newGame();
    walk(g, 0, RIGHT, 6);
    walk(g, 0, DOWN, 3);
    walk(g, 0, LEFT, 3);
    g.time = CONFIG.matchSeconds;
    g.tick(DT);
    expect(g.over).toBe(true);
    expect(g.winner).toBe(0);
  });
});

describe('the void', () => {
  it('eats the outer ring and slides cores inward', () => {
    const g = newGame();
    g.voidTimer = 0.001;
    g.tick(DT);
    expect(g.voidRing).toBe(1);
    expect(g.grid.voided[g.grid.idx(0, 0)]).toBe(1);
    expect(g.grid.voided[g.grid.idx(1, 1)]).toBe(0);
    g.voidTimer = 0.001;
    g.tick(DT);
    g.voidTimer = 0.001;
    g.tick(DT); // ring 2 swallows the corner nest at (2,2)
    expect(g.cores[0].x).toBe(3);
    expect(g.cores[0].y).toBe(3);
    expect(g.grid.owner[g.grid.idx(3, 3)]).toBe(0);
  });
});

describe('ghosts', () => {
  it('a ghost touching a third player nest breaks free', () => {
    const g = newGame();
    const p = g.players[0];
    g.cores[0].state = 'captured';
    p.status = 'shade';
    p.shadeOf = 1;
    place(g, 0, 37, 5); // near player 3's nest at (37,2)
    step(g, 0, UP);
    step(g, 0, UP);
    expect(p.status).toBe('alive');
    expect(g.cores[0].state).toBe('nest');
    expect(g.cores[0].hearts).toBe(1);
  });
});
