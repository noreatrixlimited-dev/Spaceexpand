import { CONFIG, PLAYER_NAMES, type MatchOptions } from '../config';
import { computeCapture } from './capture';
import { DX, DY, Grid, opposite, type Dir } from './Grid';
import { Rng } from './rng';

export type PlayerStatus = 'alive' | 'bonked' | 'shade';
export type PowerType = 'speed' | 'shield' | 'freeze';

export interface Player {
  id: number;
  name: string;
  isHuman: boolean;
  x: number;
  y: number;
  dir: Dir | null; // direction currently moving (null = standing still)
  nextDir: Dir | null; // queued input
  progress: number; // 0..1 toward the next cell
  status: PlayerStatus;
  bonkTimer: number;
  trail: number[];
  carrying: number; // id of the core being carried, -1 if none
  shadeOf: number; // capturer id while a ghost
  power: PowerType | null;
  powerTimer: number;
  shield: boolean;
  plan: number[]; // used by bots
  stats: { captures: number; bonks: number; bonked: number; peakLand: number; eggsStolen: number };
}

export type CoreStateKind = 'nest' | 'carried' | 'captured';

export interface Core {
  owner: number;
  homeX: number; // original corner position
  homeY: number;
  x: number;
  y: number;
  hearts: number;
  invuln: number;
  state: CoreStateKind;
  carrier: number;
  regenTimer: number;
  threatened: boolean;
}

export interface Star {
  x: number;
  y: number;
  active: boolean;
  timer: number;
}

export type GameEvent =
  | { type: 'trail'; pid: number; cell: number }
  | { type: 'capture'; pid: number; cells: number[]; fromX: number; fromY: number }
  | { type: 'bonk'; victim: number; by: number; trail: number[] }
  | { type: 'shielded'; pid: number }
  | { type: 'respawn'; pid: number }
  | { type: 'coreHit'; owner: number; by: number; hearts: number }
  | { type: 'coreStolen'; owner: number; by: number }
  | { type: 'eggDropped'; owner: number; carrier: number; by: number }
  | { type: 'coreCaptured'; owner: number; by: number; cells: number[] }
  | { type: 'freed'; pid: number }
  | { type: 'heartRegen'; owner: number; hearts: number }
  | { type: 'voidRing'; ring: number; cells: number[] }
  | { type: 'coreSlide'; owner: number }
  | { type: 'starSpawn' }
  | { type: 'power'; pid: number; power: PowerType }
  | { type: 'gameOver'; winner: number; reason: 'last' | 'time' };

export class Game {
  readonly opts: MatchOptions;
  readonly grid: Grid;
  readonly players: Player[] = [];
  readonly cores: Core[] = [];
  readonly star: Star;
  readonly rng: Rng;
  readonly land = [0, 0, 0, 0];
  events: GameEvent[] = [];
  time = 0;
  voidRing = 0;
  voidTimer: number = CONFIG.voidStart;
  voidFrozen = 0;
  over = false;
  winner = -1;
  /** Called whenever a player reaches a cell centre (bots steer here). */
  onArrive: ((p: Player) => void) | null = null;

  constructor(opts: MatchOptions) {
    this.opts = opts;
    this.rng = new Rng(opts.seed);
    const size = CONFIG.gridSize;
    this.grid = new Grid(size);
    const c = CONFIG.coreInset;
    const far = size - 1 - c;
    const corners = [
      [c, c],
      [c, far],
      [far, far],
      [far, c],
    ];
    for (let id = 0; id < 4; id++) {
      const [x, y] = corners[id];
      this.cores.push({
        owner: id,
        homeX: x,
        homeY: y,
        x,
        y,
        hearts: CONFIG.coreHearts,
        invuln: 0,
        state: 'nest',
        carrier: -1,
        regenTimer: 0,
        threatened: false,
      });
      this.players.push({
        id,
        name: PLAYER_NAMES[id],
        isHuman: opts.humanSlot === id,
        x,
        y,
        dir: null,
        nextDir: null,
        progress: 0,
        status: 'alive',
        bonkTimer: 0,
        trail: [],
        carrying: -1,
        shadeOf: -1,
        power: null,
        powerTimer: 0,
        shield: false,
        plan: [],
        stats: { captures: 0, bonks: 0, bonked: 0, peakLand: 0, eggsStolen: 0 },
      });
      this.claimStart(id);
    }
    const mid = Math.floor(size / 2);
    this.star = { x: mid, y: mid, active: false, timer: CONFIG.starFirst };
    this.grid.countOwned(this.land);
  }

  private claimStart(id: number): void {
    const g = this.grid;
    const half = g.size / 2;
    const core = this.cores[id];
    const left = core.x < half;
    const top = core.y < half;
    let x0: number, x1: number, y0: number, y1: number;
    if (this.opts.startMode === 'quadrant') {
      [x0, x1] = left ? [0, half - 1] : [half, g.size - 1];
      [y0, y1] = top ? [0, half - 1] : [half, g.size - 1];
    } else {
      const s = CONFIG.patchSize;
      [x0, x1] = left ? [0, s - 1] : [g.size - s, g.size - 1];
      [y0, y1] = top ? [0, s - 1] : [g.size - s, g.size - 1];
    }
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g.owner[g.idx(x, y)] = id;
  }

  // ---------- input ----------

  /** Request a direction. Turns right after leaving a cell snap back so controls feel instant. */
  setDir(pid: number, d: Dir): void {
    const p = this.players[pid];
    if (p.status === 'bonked') return;
    if (p.dir === null) {
      p.nextDir = d;
      return;
    }
    if (d === p.dir) {
      p.nextDir = d;
      return;
    }
    if (p.progress < 0.35 && this.grid.walkable(p.x + DX[d], p.y + DY[d])) {
      p.dir = d;
      p.progress = 0;
      p.nextDir = d;
      return;
    }
    p.nextDir = d;
  }

  // ---------- simulation ----------

  tick(dt: number): void {
    if (this.over) return;
    this.time += dt;

    for (const p of this.players) this.updatePlayer(p, dt);
    this.updateCores(dt);
    this.updateVoid(dt);
    this.updateStar(dt);

    this.grid.countOwned(this.land);
    for (const p of this.players) {
      if (this.land[p.id] > p.stats.peakLand) p.stats.peakLand = this.land[p.id];
    }
    this.checkWin();
  }

  speedOf(p: Player): number {
    let s = CONFIG.baseSpeed;
    if (p.status === 'shade') s *= CONFIG.shadeSpeedMul;
    if (p.carrying >= 0) s *= CONFIG.carrySpeedMul;
    if (p.power === 'speed') s *= CONFIG.boostSpeedMul;
    return s;
  }

  private updatePlayer(p: Player, dt: number): void {
    if (p.powerTimer > 0) {
      p.powerTimer -= dt;
      if (p.powerTimer <= 0) {
        p.power = null;
        p.shield = false;
      }
    }
    if (p.status === 'bonked') {
      p.bonkTimer -= dt;
      if (p.bonkTimer <= 0) this.respawn(p);
      return;
    }
    if (p.dir === null) {
      if (this.onArrive && !p.isHuman) this.onArrive(p);
      if (p.nextDir !== null && this.grid.walkable(p.x + DX[p.nextDir], p.y + DY[p.nextDir])) {
        p.dir = p.nextDir;
        p.progress = 0;
      } else return;
    }
    p.progress += this.speedOf(p) * dt;
    let guard = 0;
    while (p.progress >= 1 && p.dir !== null && guard++ < 4) {
      p.progress -= 1;
      p.x += DX[p.dir];
      p.y += DY[p.dir];
      this.enterCell(p);
      if ((p.status as PlayerStatus) === 'bonked') return;
      if (this.onArrive && !p.isHuman) this.onArrive(p);
      if (p.nextDir !== null && this.grid.walkable(p.x + DX[p.nextDir], p.y + DY[p.nextDir])) {
        p.dir = p.nextDir;
      }
      if (!this.grid.walkable(p.x + DX[p.dir], p.y + DY[p.dir])) {
        p.dir = null;
        p.progress = 0;
      }
    }
  }

  private enterCell(p: Player): void {
    const g = this.grid;
    const cell = g.idx(p.x, p.y);

    if (p.status === 'shade') {
      const t = g.trail[cell];
      if (t >= 0 && t !== p.id && t !== p.shadeOf) this.bonk(t, p.id);
      for (const c of this.cores) {
        if (c.state === 'nest' && c.owner !== p.shadeOf && c.owner !== p.id && this.near(c, p.x, p.y)) {
          this.breakFree(p);
          return;
        }
      }
      return;
    }

    const t = g.trail[cell];
    if (t >= 0 && t !== p.id) this.bonk(t, p.id);
    else if (t === p.id && this.opts.hardMode && g.owner[cell] !== p.id) {
      this.bonk(p.id, p.id);
      return;
    }

    // Bumping into an egg carrier knocks the egg back to its nest.
    for (const q of this.players) {
      if (q === p || q.x !== p.x || q.y !== p.y || q.status === 'bonked') continue;
      if (q.carrying >= 0 && q.status !== 'shade' && q.shadeOf !== p.id) this.dropEgg(q, p.id);
      if (p.carrying >= 0 && p.shadeOf !== q.id && q.shadeOf !== p.id) this.dropEgg(p, q.id);
    }

    if (g.owner[cell] === p.id) {
      if (p.trail.length) this.closeLoop(p);
    } else if (g.trail[cell] !== p.id) {
      g.trail[cell] = p.id;
      p.trail.push(cell);
      this.events.push({ type: 'trail', pid: p.id, cell });
    }

    for (const c of this.cores) {
      if (c.state === 'captured' || !this.near(c, p.x, p.y)) continue;
      if (c.owner === p.id) {
        if (p.carrying >= 0) this.captureCore(p, p.carrying);
      } else if (c.state === 'nest' && p.carrying < 0) {
        this.hitCore(c, p);
      }
    }

    if (this.star.active && p.x === this.star.x && p.y === this.star.y) this.grantPower(p);
  }

  private near(c: Core, x: number, y: number): boolean {
    return Math.abs(c.x - x) + Math.abs(c.y - y) <= 1;
  }

  private protectedCells(except: number): Set<number> {
    const s = new Set<number>();
    for (const c of this.cores) {
      if (c.owner !== except && c.state !== 'captured') s.add(this.grid.idx(c.x, c.y));
    }
    return s;
  }

  private closeLoop(p: Player): void {
    const g = this.grid;
    const cells = computeCapture(g, p.id, this.protectedCells(p.id));
    for (const i of p.trail) g.trail[i] = -1;
    p.trail = [];
    for (const i of cells) g.owner[i] = p.id;
    this.events.push({ type: 'capture', pid: p.id, cells, fromX: p.x, fromY: p.y });
  }

  private clearTrail(p: Player): number[] {
    const old = p.trail;
    for (const i of old) if (this.grid.trail[i] === p.id) this.grid.trail[i] = -1;
    p.trail = [];
    return old;
  }

  bonk(victimId: number, byId: number): void {
    const v = this.players[victimId];
    if (v.status !== 'alive') return;
    if (v.shield && byId !== victimId) {
      v.shield = false;
      v.power = null;
      v.powerTimer = 0;
      this.events.push({ type: 'shielded', pid: v.id });
      return;
    }
    const trail = this.clearTrail(v);
    if (v.carrying >= 0) this.dropEgg(v, byId);
    v.status = 'bonked';
    v.bonkTimer = CONFIG.bonkSeconds;
    v.dir = null;
    v.nextDir = null;
    v.progress = 0;
    v.plan = [];
    v.stats.bonked++;
    if (byId !== victimId) this.players[byId].stats.bonks++;
    const core = this.cores[victimId];
    if (core.state !== 'captured' && core.hearts > 0) core.hearts--;
    this.events.push({ type: 'bonk', victim: victimId, by: byId, trail });
  }

  private respawn(p: Player): void {
    const c = this.cores[p.id];
    p.status = 'alive';
    p.x = c.x;
    p.y = c.y;
    p.dir = null;
    p.nextDir = null;
    p.progress = 0;
    this.grid.owner[this.grid.idx(c.x, c.y)] = p.id;
    this.events.push({ type: 'respawn', pid: p.id });
  }

  private hitCore(c: Core, p: Player): void {
    if (c.invuln > 0) return;
    if (c.hearts > 0) {
      c.hearts--;
      c.invuln = CONFIG.coreHitInvuln;
      c.regenTimer = 0;
      this.events.push({ type: 'coreHit', owner: c.owner, by: p.id, hearts: c.hearts });
    } else {
      c.state = 'carried';
      c.carrier = p.id;
      p.carrying = c.owner;
      p.stats.eggsStolen++;
      this.events.push({ type: 'coreStolen', owner: c.owner, by: p.id });
    }
  }

  private dropEgg(carrier: Player, byId: number): void {
    const c = this.cores[carrier.carrying];
    carrier.carrying = -1;
    if (c.state !== 'carried') return;
    c.state = 'nest';
    c.carrier = -1;
    c.hearts = 1;
    c.invuln = CONFIG.coreHitInvuln;
    c.regenTimer = 0;
    this.events.push({ type: 'eggDropped', owner: c.owner, carrier: carrier.id, by: byId });
  }

  private captureCore(p: Player, victimId: number): void {
    const g = this.grid;
    const c = this.cores[victimId];
    const v = this.players[victimId];
    p.carrying = -1;
    c.state = 'captured';
    c.carrier = -1;
    c.hearts = 0;
    if (v.carrying >= 0) this.dropEgg(v, p.id);
    this.clearTrail(v);
    v.status = 'shade';
    v.shadeOf = p.id;
    v.power = null;
    v.shield = false;
    v.plan = [];
    if (v.dir === null && !g.walkable(v.x, v.y)) {
      v.x = c.x;
      v.y = c.y;
    }
    const cells: number[] = [];
    for (let i = 0; i < g.owner.length; i++) {
      if (g.owner[i] === victimId) {
        g.owner[i] = p.id;
        cells.push(i);
      }
    }
    // Ghosts of the victim now serve the new capturer.
    for (const q of this.players) if (q.status === 'shade' && q.shadeOf === victimId) q.shadeOf = p.id;
    p.stats.captures++;
    this.events.push({ type: 'coreCaptured', owner: victimId, by: p.id, cells });
  }

  private breakFree(p: Player): void {
    const g = this.grid;
    const c = this.cores[p.id];
    c.state = 'nest';
    c.hearts = 1;
    c.invuln = CONFIG.coreHitInvuln;
    c.regenTimer = 0;
    // Slide the nest in from the original corner until it lands on solid ground.
    c.x = c.homeX;
    c.y = c.homeY;
    this.slideCoreInward(c);
    const others = this.protectedCells(p.id);
    const r = CONFIG.freePatchRadius;
    for (let y = c.y - r; y <= c.y + r; y++) {
      for (let x = c.x - r; x <= c.x + r; x++) {
        if (!g.walkable(x, y)) continue;
        const i = g.idx(x, y);
        if (!others.has(i)) g.owner[i] = p.id;
      }
    }
    p.status = 'alive';
    p.shadeOf = -1;
    p.x = c.x;
    p.y = c.y;
    p.dir = null;
    p.nextDir = null;
    p.progress = 0;
    p.plan = [];
    this.events.push({ type: 'freed', pid: p.id });
  }

  private grantPower(p: Player): void {
    this.star.active = false;
    this.star.timer = CONFIG.starInterval;
    const power = this.rng.pick(['speed', 'shield', 'freeze'] as const);
    if (power === 'freeze') {
      this.voidFrozen = CONFIG.powerSeconds.freeze;
    } else {
      p.power = power;
      p.powerTimer = CONFIG.powerSeconds[power];
      p.shield = power === 'shield';
    }
    this.events.push({ type: 'power', pid: p.id, power });
  }

  private updateCores(dt: number): void {
    const g = this.grid;
    for (const c of this.cores) {
      if (c.invuln > 0) c.invuln -= dt;
      c.threatened = false;
      if (c.state !== 'nest') continue;
      for (const p of this.players) {
        if (p.id === c.owner || p.status !== 'alive') continue;
        if (Math.abs(p.x - c.x) + Math.abs(p.y - c.y) <= 5) c.threatened = true;
      }
      const owner = this.players[c.owner];
      if (c.hearts < CONFIG.coreHearts && owner.status === 'alive' && g.owner[g.idx(owner.x, owner.y)] === owner.id) {
        c.regenTimer += dt;
        if (c.regenTimer >= CONFIG.heartRegenSeconds) {
          c.regenTimer = 0;
          c.hearts++;
          this.events.push({ type: 'heartRegen', owner: c.owner, hearts: c.hearts });
        }
      }
    }
  }

  private slideCoreInward(c: Core): boolean {
    const g = this.grid;
    const mid = (g.size - 1) / 2;
    let moved = false;
    let guard = 0;
    while (!g.walkable(c.x, c.y) && guard++ < g.size) {
      c.x += Math.sign(mid - c.x) || 0;
      c.y += Math.sign(mid - c.y) || 0;
      moved = true;
    }
    return moved;
  }

  private updateVoid(dt: number): void {
    if (this.voidFrozen > 0) {
      this.voidFrozen -= dt;
      return;
    }
    if (this.voidRing >= CONFIG.voidMaxRings) return;
    this.voidTimer -= dt;
    if (this.voidTimer > 0) return;
    this.voidTimer = CONFIG.voidInterval;
    this.eatRing(this.voidRing);
    this.voidRing++;
  }

  private eatRing(ring: number): void {
    const g = this.grid;
    const cells: number[] = [];
    for (let i = 0; i < g.owner.length; i++) {
      if (g.voided[i] || g.ring(g.x(i), g.y(i)) !== ring) continue;
      g.voided[i] = 1;
      g.owner[i] = -1;
      const t = g.trail[i];
      if (t >= 0) this.bonk(t, t);
      g.trail[i] = -1;
      cells.push(i);
    }
    this.events.push({ type: 'voidRing', ring, cells });

    for (const c of this.cores) {
      if (c.state === 'captured') continue;
      if (this.slideCoreInward(c)) {
        if (c.state === 'nest') g.owner[g.idx(c.x, c.y)] = c.owner;
        this.events.push({ type: 'coreSlide', owner: c.owner });
      }
    }
    for (const p of this.players) {
      if (g.walkable(p.x, p.y)) continue;
      if (p.status === 'alive') this.bonk(p.id, p.id);
      if (p.status === 'shade') {
        p.x += Math.sign((g.size - 1) / 2 - p.x);
        p.y += Math.sign((g.size - 1) / 2 - p.y);
        p.dir = null;
        p.progress = 0;
      }
    }
    // Make sure nobody is left moving into the void.
    for (const p of this.players) {
      if (p.dir !== null && !g.walkable(p.x + DX[p.dir], p.y + DY[p.dir])) {
        p.dir = null;
        p.progress = 0;
      }
    }
  }

  private updateStar(dt: number): void {
    if (this.star.active) return;
    this.star.timer -= dt;
    if (this.star.timer > 0) return;
    // Pick a free cell near the centre.
    const g = this.grid;
    const mid = Math.floor(g.size / 2);
    for (let tries = 0; tries < 20; tries++) {
      const x = mid + this.rng.int(-2, 1);
      const y = mid + this.rng.int(-2, 1);
      if (g.walkable(x, y)) {
        this.star.x = x;
        this.star.y = y;
        this.star.active = true;
        this.events.push({ type: 'starSpawn' });
        return;
      }
    }
    this.star.timer = 2;
  }

  aliveCores(): Core[] {
    return this.cores.filter((c) => c.state !== 'captured');
  }

  private checkWin(): void {
    const alive = this.aliveCores();
    if (alive.length <= 1) {
      this.finish(alive.length ? alive[0].owner : this.leader(), 'last');
    } else if (this.time >= CONFIG.matchSeconds) {
      this.finish(this.leader(), 'time');
    }
  }

  /** Player with the most land among those whose Core survives. */
  leader(): number {
    let best = -1;
    for (const c of this.aliveCores()) {
      if (best < 0 || this.land[c.owner] > this.land[best]) best = c.owner;
    }
    return best;
  }

  /** Final standings: surviving Cores first, then by land. */
  ranking(): number[] {
    return [0, 1, 2, 3].sort((a, b) => {
      const ca = this.cores[a].state === 'captured' ? 0 : 1;
      const cb = this.cores[b].state === 'captured' ? 0 : 1;
      if (ca !== cb) return cb - ca;
      return this.land[b] - this.land[a];
    });
  }

  private finish(winner: number, reason: 'last' | 'time'): void {
    this.over = true;
    this.winner = winner;
    this.events.push({ type: 'gameOver', winner, reason });
  }

  // Exposed for bots and tests.
  isOpposite(a: Dir, b: Dir): boolean {
    return opposite(a) === b;
  }
}
