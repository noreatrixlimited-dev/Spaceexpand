import { CONFIG, PLAYER_NAMES, UNIT, type MatchOptions } from '../config';
import { cellInset, getMap, nestSpots, type MapDef } from '../maps';
import { computeCapture } from './capture';
import { Grid, type Dir } from './Grid';
import { Rng } from './rng';

export type PlayerStatus = 'alive' | 'bonked' | 'out';
export type PowerType = 'speed' | 'shield' | 'big';

export interface Player {
  id: number;
  name: string;
  isHuman: boolean;
  /** Continuous position in cell units (cell (x, y) spans x..x+1, y..y+1). */
  px: number;
  py: number;
  /** Current cell (floor of px/py), updated when a new cell is entered. */
  x: number;
  y: number;
  heading: number; // radians: 0 = +x (right), PI/2 = +y (down)
  aim: number | null; // direction the player wants to face
  moving: boolean;
  stunTimer: number;
  /** Board momentum 0..1: builds up from a stop. */
  glide: number;
  /** How hard the player is turning right now (radians/second, signed) — used for leaning. */
  turn: number;
  /** Per-player speed tweak (used by the match director). */
  speedMul: number;
  /** Per-player ball refill tweak (used by the match director). */
  ballRateMul: number;
  status: PlayerStatus;
  bonkTimer: number;
  trail: number[];
  carrying: number; // id of the core being carried, -1 if none
  shadeOf: number; // who captured this player's nest (-1 if still in the game)
  power: PowerType | null;
  powerTimer: number;
  shield: boolean;
  balls: number;
  ballTimer: number;
  throwCooldown: number;
  plan: number[]; // used by bots
  stats: { captures: number; bonks: number; bonked: number; peakLand: number; eggsStolen: number; throws: number; hits: number };
}

export type CoreStateKind = 'nest' | 'carried' | 'captured';

export interface Core {
  owner: number;
  homeX: number; // original position
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

export interface Projectile {
  id: number;
  owner: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  t: number;
  dur: number;
}

export interface Pickup {
  id: number;
  x: number;
  y: number;
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
  | { type: 'heartRegen'; owner: number; hearts: number }
  | { type: 'voidRing'; ring: number; cells: number[] }
  | { type: 'coreSlide'; owner: number }
  | { type: 'starSpawn' }
  | { type: 'power'; pid: number; power: PowerType }
  | { type: 'throw'; pid: number; proj: Projectile }
  | { type: 'splat'; pid: number; x: number; y: number; cells: number[]; hit: boolean }
  | { type: 'stun'; pid: number; by: number }
  | { type: 'pickup'; pid: number; x: number; y: number }
  | { type: 'pickupSpawn'; x: number; y: number }
  | { type: 'gameOver'; winner: number; reason: 'last' | 'time' };

const DIR_ANGLE = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class Game {
  readonly opts: MatchOptions;
  readonly map: MapDef;
  readonly grid: Grid;
  readonly players: Player[] = [];
  readonly cores: Core[] = [];
  readonly star: Star;
  readonly rng: Rng;
  readonly land = [0, 0, 0, 0];
  /** Playable cells at the start (for percentages). */
  readonly totalCells: number;
  readonly projectiles: Projectile[] = [];
  readonly pickups: Pickup[] = [];
  events: GameEvent[] = [];
  time = 0;
  voidRing = 0;
  voidTimer: number = CONFIG.voidStart;
  voidFrozen = 0;
  pickupTimer: number = CONFIG.pickupInterval;
  over = false;
  winner = -1;
  private nextId = 1;
  /** Called whenever a bot enters a new cell or is idle (bots steer here). */
  onArrive: ((p: Player) => void) | null = null;

  constructor(opts: MatchOptions) {
    this.opts = opts;
    this.rng = new Rng(opts.seed);
    const size = CONFIG.gridSize;
    this.map = getMap(opts.map);
    this.grid = new Grid(size, cellInset(this.map, size), UNIT);
    const g = this.grid;
    // Everything outside the map's shape is gone from the start.
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (g.ring(x, y) < 0) g.voided[g.idx(x, y)] = 1;

    let total = 0;
    for (let i = 0; i < g.voided.length; i++) if (!g.voided[i]) total++;
    this.totalCells = total;

    const spots = nestSpots(this.map, CONFIG.nestDepth / UNIT);
    for (let id = 0; id < 4; id++) {
      const x = Math.floor(spots[id][0] * UNIT + size / 2);
      const y = Math.floor(spots[id][1] * UNIT + size / 2);
      this.cores.push({ owner: id, homeX: x, homeY: y, x, y, hearts: CONFIG.coreHearts, invuln: 0, state: 'nest', carrier: -1, regenTimer: 0, threatened: false });
      this.players.push({
        id,
        name: PLAYER_NAMES[id],
        isHuman: opts.humanSlot === id,
        px: x + 0.5,
        py: y + 0.5,
        x,
        y,
        heading: Math.atan2(size / 2 - y, size / 2 - x),
        aim: null,
        moving: false,
        stunTimer: 0,
        glide: 0,
        turn: 0,
        speedMul: 1,
        ballRateMul: 1,
        status: 'alive',
        bonkTimer: 0,
        trail: [],
        carrying: -1,
        shadeOf: -1,
        power: null,
        powerTimer: 0,
        shield: false,
        balls: CONFIG.ballStart,
        ballTimer: 0,
        throwCooldown: 0,
        plan: [],
        stats: { captures: 0, bonks: 0, bonked: 0, peakLand: 0, eggsStolen: 0, throws: 0, hits: 0 },
      });
      this.claimStart(id);
    }
    const mid = Math.floor(size / 2);
    this.star = { x: mid, y: mid, active: false, timer: CONFIG.starFirst };
    this.grid.countOwned(this.land);
    if (!opts.tutorial) this.setupHazards();
  }

  /** Puddles sit away from the nests and the middle; wind starts in a random direction. */
  private setupHazards(): void {
    const g = this.grid;
    if (this.map.hazard === 'wind') {
      this.wind = { angle: this.rng.next() * Math.PI * 2, strength: CONFIG.windSpeed };
      return;
    }
    if (this.map.hazard !== 'puddles') return;
    const r = 2.2 * UNIT;
    for (let tries = 0; tries < 400 && this.puddles.length < 5; tries++) {
      const x = 4 + this.rng.next() * (g.size - 8);
      const y = 4 + this.rng.next() * (g.size - 8);
      if (g.ring(Math.floor(x), Math.floor(y)) < 4) continue; // keep off the coast (rings are one unit deep)
      if (this.cores.some((c) => Math.hypot(c.x - x, c.y - y) < CONFIG.startRadius + r + UNIT)) continue;
      if (Math.hypot(this.star.x - x, this.star.y - y) < r + 2 * UNIT) continue;
      if (this.puddles.some((d) => Math.hypot(d.x - x, d.y - y) < r * 2.4)) continue;
      this.puddles.push({ x, y, r });
    }
  }

  private claimStart(id: number): void {
    const g = this.grid;
    const half = g.size / 2;
    const core = this.cores[id];
    const quadrant = this.opts.startMode === 'quadrant';
    const R = CONFIG.startRadius;
    for (let y = 0; y < g.size; y++) {
      for (let x = 0; x < g.size; x++) {
        if (!g.walkable(x, y)) continue;
        const mine = quadrant
          ? Math.sign(x + 0.5 - half) === Math.sign(core.x + 0.5 - half) && Math.sign(y + 0.5 - half) === Math.sign(core.y + 0.5 - half)
          : Math.hypot(x - core.x, y - core.y) <= R;
        if (mine) g.owner[g.idx(x, y)] = id;
      }
    }
  }

  // ---------- input ----------

  /** Steer toward an angle (radians, 0 = right, PI/2 = down). Starts the player moving. */
  setAim(pid: number, angle: number): void {
    const p = this.players[pid];
    if (p.status === 'bonked') return;
    p.aim = angle;
    p.moving = true;
  }

  /** 4-way input (keyboard / arrow buttons). */
  setDir(pid: number, d: Dir): void {
    this.setAim(pid, DIR_ANGLE[d]);
  }

  // ---------- simulation ----------

  tick(dt: number): void {
    if (this.over) return;
    this.time += dt;
    if (this.wind.strength > 0) this.wind.angle += dt * 0.12; // the wind slowly swings round

    for (const p of this.players) this.updatePlayer(p, dt);
    this.checkContacts();
    this.updateBalls(dt);
    this.updateProjectiles(dt);
    this.updateCores(dt);
    if (!this.opts.tutorial) {
      this.updateVoid(dt);
      this.updateStar(dt);
      this.updatePickups(dt);
    }

    this.grid.countOwned(this.land);
    for (const p of this.players) {
      if (this.land[p.id] > p.stats.peakLand) p.stats.peakLand = this.land[p.id];
    }
    if (!this.opts.tutorial) this.checkWin();
  }

  /** Puddles (slow zones) on puddle islands, in grid cells. */
  puddles: { x: number; y: number; r: number }[] = [];
  /** Wind on windy islands: drift direction (radians) and strength (0 = calm). */
  wind = { angle: 0, strength: 0 };

  inPuddle(px: number, py: number): boolean {
    for (const d of this.puddles) if (Math.hypot(px - d.x, py - d.y) < d.r) return true;
    return false;
  }

  speedOf(p: Player): number {
    let s = CONFIG.baseSpeed * p.speedMul;
    if (this.puddles.length && this.inPuddle(p.px, p.py)) s *= CONFIG.puddleSlow;
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
    if (p.throwCooldown > 0) p.throwCooldown -= dt;
    if (p.status === 'bonked') {
      p.bonkTimer -= dt;
      if (p.bonkTimer <= 0) this.respawn(p);
      return;
    }
    // Captured riders are gone from the island for the rest of the match.
    if (p.status === 'out') return;
    if (p.stunTimer > 0) {
      p.stunTimer -= dt;
      p.glide = 0;
      p.turn = 0;
      return;
    }
    if (!p.moving && this.onArrive && !p.isHuman) this.onArrive(p);
    if (!p.moving) {
      p.turn = 0;
      return;
    }

    // Board riding: carve toward the aim, build up glide from a stop, lose a little speed in hard turns.
    let turned = 0;
    if (p.aim !== null) {
      const diff = wrapAngle(p.aim - p.heading);
      const max = CONFIG.turnRate * dt;
      turned = Math.max(-max, Math.min(max, diff));
      p.heading = wrapAngle(p.heading + turned);
    }
    p.turn = turned / dt;
    p.glide = Math.min(1, p.glide + dt / CONFIG.glideRamp);
    const carve = Math.min(1, Math.abs(p.turn) / CONFIG.turnRate);
    let dist = this.speedOf(p) * dt * (0.35 + 0.65 * p.glide) * (1 - CONFIG.carveSlow * carve);
    while (dist > 1e-6) {
      const step = Math.min(0.25, dist);
      dist -= step;
      if (!this.moveBy(p, Math.cos(p.heading) * step, Math.sin(p.heading) * step, true)) break;
      if (p.status !== 'alive') break;
    }
    // Windy islands: bubbles drift a little while they float around.
    if (this.wind.strength > 0 && p.status === 'alive') {
      const w = this.wind.strength * dt;
      this.moveBy(p, Math.cos(this.wind.angle) * w, Math.sin(this.wind.angle) * w, false);
    }
  }

  /**
   * Move a player by (dx, dy) cells, sliding along walls and the void.
   * Enters every cell crossed (4-connected, so trails never have diagonal gaps).
   * Returns false if completely blocked.
   */
  private moveBy(p: Player, dx: number, dy: number, steering: boolean): boolean {
    const g = this.grid;
    let nx = p.px + dx;
    let ny = p.py + dy;
    if (!g.walkable(Math.floor(nx), Math.floor(ny))) {
      if (g.walkable(Math.floor(nx), Math.floor(p.py))) ny = p.py;
      else if (g.walkable(Math.floor(p.px), Math.floor(ny))) nx = p.px;
      else return false;
    }
    const cx = Math.floor(nx);
    const cy = Math.floor(ny);
    const changed = cx !== p.x || cy !== p.y;
    if (cx !== p.x && cy !== p.y) {
      // Crossing a corner: step through one of the side cells first.
      const viaX = g.walkable(cx, p.y);
      this.enterAt(p, viaX ? cx : p.x, viaX ? p.y : cy);
      if (p.status === 'bonked') return false;
    }
    if (changed) {
      this.enterAt(p, cx, cy);
      if (p.status === 'bonked') return false;
    }
    p.px = nx;
    p.py = ny;
    if (steering && changed && this.onArrive && !p.isHuman) this.onArrive(p);
    return true;
  }

  private enterAt(p: Player, x: number, y: number): void {
    p.x = x;
    p.y = y;
    this.enterCell(p);
  }

  private enterCell(p: Player): void {
    const g = this.grid;
    const cell = g.idx(p.x, p.y);

    if (p.status === 'out') return;

    const t = g.trail[cell];
    if (t >= 0 && t !== p.id) this.bonk(t, p.id);
    else if (t === p.id && this.opts.hardMode && g.owner[cell] !== p.id) {
      // Ignore the cell we just left (free movement can wobble on a boundary).
      if (p.trail[p.trail.length - 1] !== cell) {
        this.bonk(p.id, p.id);
        return;
      }
    }

    if (g.owner[cell] === p.id) {
      if (p.trail.length) this.closeLoop(p);
      // A stolen egg is captured as soon as the thief reaches their own colour.
      if (p.carrying >= 0) {
        this.captureCore(p, p.carrying);
        if (p.status !== 'alive') return;
      }
    } else if (g.trail[cell] !== p.id) {
      g.trail[cell] = p.id;
      p.trail.push(cell);
      this.events.push({ type: 'trail', pid: p.id, cell });
    }

    for (const c of this.cores) {
      if (c.state === 'captured' || !this.near(c, p.x, p.y)) continue;
      if (c.owner !== p.id && c.state === 'nest' && p.carrying < 0) {
        this.hitCore(c, p);
      }
    }

  }

  /** Touching things by distance: egg carriers, the star and ball pickups. */
  private checkContacts(): void {
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.status === 'bonked' || p.status === 'out') continue;
      for (let j = i + 1; j < ps.length; j++) {
        const q = ps[j];
        const big = p.power === 'big' || q.power === 'big';
        const reach = CONFIG.bumpDistance * (big ? CONFIG.bigReach : 1);
        if (q.status === 'bonked' || q.status === 'out' || Math.hypot(p.px - q.px, p.py - q.py) > reach) continue;
        // A Big Bubble shoves smaller bubbles away and stuns them.
        for (const [a, b] of [
          [p, q],
          [q, p],
        ]) {
          if (a.power !== 'big' || b.power === 'big' || b.status !== 'alive' || b.stunTimer > 0 || this.isAlly(a.id, b.id)) continue;
          if (b.shield) {
            b.shield = false;
            b.power = null;
            b.powerTimer = 0;
            this.events.push({ type: 'shielded', pid: b.id });
            continue;
          }
          if (b.carrying >= 0) this.dropEgg(b, a.id);
          this.knockback(b, a.px, a.py);
          if (b.status !== 'alive') continue;
          b.stunTimer = CONFIG.stunSeconds;
          this.events.push({ type: 'stun', pid: b.id, by: a.id });
        }
        if (Math.hypot(p.px - q.px, p.py - q.py) > CONFIG.bumpDistance) continue;
        // Bumping into an egg carrier knocks the egg back to its nest.
        for (const [a, b] of [
          [p, q],
          [q, p],
        ]) {
          if (b.carrying >= 0 && b.status !== 'out' && a.status !== 'out' && !this.isAlly(a.id, b.id)) this.dropEgg(b, a.id);
        }
      }
      if (p.status !== 'alive') continue;
      if (this.star.active && Math.hypot(p.px - (this.star.x + 0.5), p.py - (this.star.y + 0.5)) <= CONFIG.pickupReach) this.grantPower(p);
      for (let k = this.pickups.length - 1; k >= 0; k--) {
        const pk = this.pickups[k];
        if (Math.hypot(p.px - (pk.x + 0.5), p.py - (pk.y + 0.5)) > CONFIG.pickupReach) continue;
        p.balls = Math.min(this.ballCap(p.id) + CONFIG.pickupBalls, p.balls + CONFIG.pickupBalls);
        this.pickups.splice(k, 1);
        this.events.push({ type: 'pickup', pid: p.id, x: pk.x, y: pk.y });
      }
    }
  }

  private near(c: Core, x: number, y: number): boolean {
    return Math.hypot(c.x - x, c.y - y) <= CONFIG.nestReach;
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
    for (const i of p.trail) if (g.trail[i] === p.id) g.trail[i] = -1;
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

  private isAlly(a: number, b: number): boolean {
    const pa = this.players[a];
    const pb = this.players[b];
    return a === b || pa.shadeOf === b || pb.shadeOf === a;
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
    v.moving = false;
    v.aim = null;
    v.stunTimer = 0;
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
    this.placeAt(p, c.x, c.y);
    this.grid.owner[this.grid.idx(c.x, c.y)] = p.id;
    this.events.push({ type: 'respawn', pid: p.id });
  }

  private placeAt(p: Player, x: number, y: number): void {
    p.x = x;
    p.y = y;
    p.px = x + 0.5;
    p.py = y + 0.5;
    p.moving = false;
    p.aim = null;
    p.stunTimer = 0;
    p.glide = 0;
    p.turn = 0;
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
      // Grabbed while already standing on your own colour: it's yours right away.
      if (this.grid.owner[this.grid.idx(p.x, p.y)] === p.id) this.captureCore(p, c.owner);
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
    v.status = 'out';
    v.moving = false;
    v.aim = null;
    v.shadeOf = p.id;
    v.power = null;
    v.shield = false;
    v.plan = [];
    v.balls = 0;
    v.stunTimer = 0;
    if (!g.walkable(v.x, v.y)) this.placeAt(v, c.x, c.y);
    const cells: number[] = [];
    for (let i = 0; i < g.owner.length; i++) {
      if (g.owner[i] === victimId) {
        g.owner[i] = p.id;
        cells.push(i);
      }
    }
    for (const q of this.players) if (q.status === 'out' && q.shadeOf === victimId) q.shadeOf = p.id;
    p.stats.captures++;
    this.events.push({ type: 'coreCaptured', owner: victimId, by: p.id, cells });
  }

  private grantPower(p: Player): void {
    this.star.active = false;
    this.star.timer = CONFIG.starInterval;
    const power = this.rng.pick(['speed', 'shield', 'big'] as const);
    p.power = power;
    p.powerTimer = CONFIG.powerSeconds[power];
    p.shield = power === 'shield';
    this.events.push({ type: 'power', pid: p.id, power });
  }

  // ---------- balls ----------

  /** Pouch size grows with land. */
  ballCap(pid: number): number {
    return Math.min(CONFIG.ballCapMax, CONFIG.ballCapBase + Math.floor(this.land[pid] / CONFIG.ballCapLandPer));
  }

  private updateBalls(dt: number): void {
    let smallest = -1;
    for (const p of this.players) {
      if (p.status === 'out') continue;
      if (smallest < 0 || this.land[p.id] < this.land[smallest]) smallest = p.id;
    }
    for (const p of this.players) {
      if (p.status === 'out') continue;
      const cap = this.ballCap(p.id);
      if (p.balls >= cap) {
        p.ballTimer = 0;
        continue;
      }
      let rate = CONFIG.ballRateBase + this.land[p.id] * CONFIG.ballRatePerCell;
      if (p.id === smallest) rate *= CONFIG.ballCatchUp;
      rate *= p.ballRateMul;
      p.ballTimer += rate * dt;
      if (p.ballTimer >= 1) {
        p.ballTimer -= 1;
        p.balls++;
      }
    }
  }

  /** Best target near the facing direction (enemy, enemy trail or nest), or null. */
  autoTarget(p: Player, cone: number = CONFIG.autoAimCone): { angle: number; dist: number } | null {
    const g = this.grid;
    let best: { angle: number; dist: number } | null = null;
    let bestScore = Infinity;
    const consider = (tx: number, ty: number, weight: number) => {
      const dx = tx - p.px;
      const dy = ty - p.py;
      const d = Math.hypot(dx, dy);
      if (d < 1.5 * UNIT || d > CONFIG.throwRange + UNIT) return;
      const a = Math.atan2(dy, dx);
      const off = Math.abs(wrapAngle(a - p.heading));
      if (off > cone) return;
      const score = off * 4 + d * 0.15 - weight;
      if (score < bestScore) {
        bestScore = score;
        best = { angle: a, dist: d };
      }
    };
    for (const q of this.players) {
      if (q === p || q.status !== 'alive' || this.isAlly(p.id, q.id)) continue;
      consider(q.px, q.py, q.carrying >= 0 ? 3 : 2);
    }
    for (const c of this.cores) {
      if (c.state === 'nest' && !this.isAlly(p.id, c.owner) && c.hearts > 0) consider(c.x + 0.5, c.y + 0.5, 1);
    }
    // enemy trails within range
    const r = CONFIG.throwRange;
    for (let y = Math.max(0, Math.floor(p.py - r)); y <= Math.min(g.size - 1, Math.floor(p.py + r)); y++) {
      for (let x = Math.max(0, Math.floor(p.px - r)); x <= Math.min(g.size - 1, Math.floor(p.px + r)); x++) {
        const t = g.trail[g.idx(x, y)];
        if (t >= 0 && t !== p.id && !this.isAlly(p.id, t)) consider(x + 0.5, y + 0.5, 1.5);
      }
    }
    return best;
  }

  /**
   * Throw a ball. Without an angle it auto-aims at a target near the facing direction,
   * otherwise it lobs straight ahead. Returns true if thrown.
   */
  throwBall(pid: number, angle?: number, range?: number): boolean {
    const p = this.players[pid];
    if (p.status !== 'alive' || p.stunTimer > 0 || p.balls <= 0 || p.throwCooldown > 0) return false;
    let a = angle;
    let r = range;
    if (a === undefined) {
      const target = this.autoTarget(p);
      a = target ? target.angle : p.heading;
      r = target ? target.dist : undefined;
    }
    r = Math.max(2 * UNIT, Math.min(CONFIG.throwRange, r ?? CONFIG.throwRange));
    const proj: Projectile = {
      id: this.nextId++,
      owner: pid,
      sx: p.px,
      sy: p.py,
      tx: p.px + Math.cos(a) * r,
      ty: p.py + Math.sin(a) * r,
      t: 0,
      dur: CONFIG.throwTime * (0.6 + 0.4 * (r / CONFIG.throwRange)),
    };
    p.balls--;
    p.throwCooldown = CONFIG.throwCooldown;
    p.stats.throws++;
    this.projectiles.push(proj);
    this.events.push({ type: 'throw', pid, proj });
    return true;
  }

  /** Throw at a specific point (used by bots). */
  throwAt(pid: number, tx: number, ty: number): boolean {
    const p = this.players[pid];
    return this.throwBall(pid, Math.atan2(ty - p.py, tx - p.px), Math.hypot(tx - p.px, ty - p.py));
  }

  private updateProjectiles(dt: number): void {
    for (let k = this.projectiles.length - 1; k >= 0; k--) {
      const pr = this.projectiles[k];
      pr.t += dt;
      if (pr.t < pr.dur) continue;
      this.projectiles.splice(k, 1);
      this.landBall(pr);
    }
  }

  private landBall(pr: Projectile): void {
    const g = this.grid;
    const thrower = this.players[pr.owner];
    const cells: number[] = [];
    let hit = false;
    const cx = Math.floor(pr.tx);
    const cy = Math.floor(pr.ty);
    if (g.walkable(cx, cy)) {
      // Nests (and the cells around them) can't be painted over.
      const guard = new Set<number>();
      for (const c of this.cores) {
        if (c.state === 'captured') continue;
        const r = Math.ceil(CONFIG.nestReach);
        for (let y = c.y - r; y <= c.y + r; y++)
          for (let x = c.x - r; x <= c.x + r; x++) if (g.inside(x, y) && Math.hypot(x - c.x, y - c.y) <= CONFIG.nestReach) guard.add(g.idx(x, y));
      }
      const R = CONFIG.splatRadius;
      for (let y = Math.floor(pr.ty - R); y <= Math.floor(pr.ty + R); y++) {
        for (let x = Math.floor(pr.tx - R); x <= Math.floor(pr.tx + R); x++) {
          if (!g.walkable(x, y) || Math.hypot(x + 0.5 - pr.tx, y + 0.5 - pr.ty) > R) continue;
          const i = g.idx(x, y);
          const t = g.trail[i];
          if (t >= 0 && t !== pr.owner && !this.isAlly(pr.owner, t) && this.players[t].status === 'alive') {
            this.bonk(t, pr.owner);
            hit = true;
          }
          if (guard.has(i) || g.owner[i] === pr.owner) continue;
          if (thrower.status === 'out') continue;
          g.owner[i] = pr.owner;
          cells.push(i);
        }
      }
    }
    // Players caught in the blast: stunned and knocked back (and they drop any egg).
    for (const q of this.players) {
      if (q.id === pr.owner || q.status !== 'alive' || this.isAlly(pr.owner, q.id)) continue;
      const d = Math.hypot(q.px - pr.tx, q.py - pr.ty);
      if (d > CONFIG.hitRadius) continue;
      hit = true;
      if (q.shield) {
        q.shield = false;
        q.power = null;
        q.powerTimer = 0;
        this.events.push({ type: 'shielded', pid: q.id });
        continue;
      }
      if (q.carrying >= 0) this.dropEgg(q, pr.owner);
      this.knockback(q, pr.tx, pr.ty);
      if (q.status !== 'alive') continue;
      q.stunTimer = CONFIG.stunSeconds;
      this.events.push({ type: 'stun', pid: q.id, by: pr.owner });
    }
    // Nests in the blast lose a heart (never stolen by a ball).
    for (const c of this.cores) {
      if (c.state !== 'nest' || this.isAlly(pr.owner, c.owner) || c.invuln > 0 || c.hearts <= 0) continue;
      if (Math.hypot(c.x + 0.5 - pr.tx, c.y + 0.5 - pr.ty) > CONFIG.splatRadius) continue;
      c.hearts--;
      c.invuln = CONFIG.coreHitInvuln;
      c.regenTimer = 0;
      hit = true;
      this.events.push({ type: 'coreHit', owner: c.owner, by: pr.owner, hearts: c.hearts });
    }
    if (hit) thrower.stats.hits++;
    this.events.push({ type: 'splat', pid: pr.owner, x: pr.tx, y: pr.ty, cells, hit });
  }

  private knockback(q: Player, fx: number, fy: number): void {
    let dx = q.px - fx;
    let dy = q.py - fy;
    const d = Math.hypot(dx, dy);
    if (d < 0.01) {
      dx = Math.cos(q.heading + Math.PI);
      dy = Math.sin(q.heading + Math.PI);
    } else {
      dx /= d;
      dy /= d;
    }
    let left = CONFIG.knockback;
    while (left > 0 && q.status === 'alive') {
      const s = Math.min(0.25, left);
      left -= s;
      if (!this.moveBy(q, dx * s, dy * s, false)) break;
    }
  }

  private updatePickups(dt: number): void {
    this.pickupTimer -= dt;
    if (this.pickupTimer > 0) return;
    this.pickupTimer = CONFIG.pickupInterval;
    if (this.pickups.length >= CONFIG.pickupMax) return;
    const g = this.grid;
    for (let tries = 0; tries < 30; tries++) {
      const x = this.rng.int(UNIT, g.size - 1 - UNIT);
      const y = this.rng.int(UNIT, g.size - 1 - UNIT);
      const i = g.idx(x, y);
      if (!g.walkable(x, y) || g.owner[i] >= 0 || g.ring(x, y) < 2) continue;
      if (this.pickups.some((p) => p.x === x && p.y === y)) continue;
      this.pickups.push({ id: this.nextId++, x, y });
      this.events.push({ type: 'pickupSpawn', x, y });
      return;
    }
  }

  // ---------- nests, void, star ----------

  private updateCores(dt: number): void {
    const g = this.grid;
    for (const c of this.cores) {
      if (c.invuln > 0) c.invuln -= dt;
      c.threatened = false;
      if (c.state !== 'nest') continue;
      for (const p of this.players) {
        if (p.id === c.owner || p.status !== 'alive') continue;
        if (Math.hypot(p.x - c.x, p.y - c.y) <= CONFIG.threatDistance) c.threatened = true;
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
      if (g.voided[i] || g.ring(g.x(i), g.y(i)) > ring) continue;
      g.voided[i] = 1;
      g.owner[i] = -1;
      const t = g.trail[i];
      if (t >= 0) this.bonk(t, t);
      g.trail[i] = -1;
      cells.push(i);
    }
    for (let k = this.pickups.length - 1; k >= 0; k--) if (!g.walkable(this.pickups[k].x, this.pickups[k].y)) this.pickups.splice(k, 1);
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
    }
  }

  private updateStar(dt: number): void {
    if (this.star.active) return;
    this.star.timer -= dt;
    if (this.star.timer > 0) return;
    const g = this.grid;
    const mid = Math.floor(g.size / 2);
    for (let tries = 0; tries < 20; tries++) {
      const x = mid + this.rng.int(-2 * UNIT, 2 * UNIT);
      const y = mid + this.rng.int(-2 * UNIT, 2 * UNIT);
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

  /** Player with the most land among those whose nest survives. */
  leader(): number {
    let best = -1;
    for (const c of this.aliveCores()) {
      if (best < 0 || this.land[c.owner] > this.land[best]) best = c.owner;
    }
    return best;
  }

  /** Cells the player would gain by closing their loop right now (trail + enclosed area). */
  previewGain(pid: number): number {
    if (!this.players[pid].trail.length) return 0;
    return computeCapture(this.grid, pid, this.protectedCells(pid)).length;
  }

  /** Share of the original island a player owns, in percent. */
  percent(pid: number): number {
    return (this.land[pid] / this.totalCells) * 100;
  }

  /** Final standings: surviving nests first, then by land. */
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
}
