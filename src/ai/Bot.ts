import type { Difficulty } from '../config';
import type { Game, Player } from '../core/Game';
import { DX, DY, type Dir } from '../core/Grid';
import { CONFIG, UNIT } from '../config';
import { bfs, manhattan } from './path';

interface BotParams {
  reaction: number; // chance per step of noticing danger
  caution: number; // extra safety margin (cells) when deciding to flee
  attackRange: number; // how far a bot will go to cut a trail
  coreAggro: number; // chance to go for an enemy nest when starting a trip
  coreRange: number;
  loopMin: number;
  loopMax: number;
  starRange: number;
  throwTrail: number; // chance per step to throw at a visible enemy trail
  throwPlayer: number; // chance per step to throw at an enemy in range
}

const PARAMS: Record<Difficulty, BotParams> = {
  easy: { reaction: 0.5, caution: 0, attackRange: 4, coreAggro: 0.12, coreRange: 9, loopMin: 3, loopMax: 7, starRange: 8, throwTrail: 0.05, throwPlayer: 0.015 },
  normal: { reaction: 0.85, caution: 1, attackRange: 7, coreAggro: 0.3, coreRange: 13, loopMin: 3, loopMax: 8, starRange: 12, throwTrail: 0.12, throwPlayer: 0.035 },
  hard: { reaction: 1, caution: 2, attackRange: 11, coreAggro: 0.5, coreRange: 18, loopMin: 4, loopMax: 9, starRange: 16, throwTrail: 0.25, throwPlayer: 0.07 },
};

type Mode = 'idle' | 'expand' | 'flee' | 'attack' | 'raid' | 'carry' | 'star' | 'ghost';

/** State-machine bots: Expand / Flee / Attack (trails) / Raid (nests) / Carry / Star / Ghost. */
export class Bots {
  private readonly game: Game;
  private paramsOf: BotParams[] = [];
  /** Parameters for the bot currently deciding. */
  private params!: BotParams;
  /** The human player (if any) and how much bots go after them: <1 leave them alone, >1 gang up. */
  readonly humanId: number | null;
  humanBias = 1;
  private readonly mode: Mode[] = ['idle', 'idle', 'idle', 'idle'];
  private readonly lastThink = [-1, -1, -1, -1];

  constructor(game: Game, skill: Difficulty | number) {
    this.game = game;
    this.humanId = game.opts.humanSlot;
    this.setSkill(typeof skill === 'number' ? skill : skill === 'easy' ? 0 : skill === 'normal' ? 0.5 : 1);
    game.onArrive = (p) => this.decide(p);
  }

  /** Bot sharpness from 0 (sleepy) to 1 (sharp), for one bot or all; can change mid-match. */
  setSkill(skill: number, pid?: number): void {
    const t = Math.max(0, Math.min(1, skill));
    const e = PARAMS.easy;
    const n = PARAMS.normal;
    const h = PARAMS.hard;
    const mix = (k: keyof BotParams) => (t < 0.5 ? e[k] + (n[k] - e[k]) * t * 2 : n[k] + (h[k] - n[k]) * (t - 0.5) * 2);
    const base: BotParams = {
      reaction: mix('reaction'),
      caution: mix('caution'),
      attackRange: mix('attackRange'),
      coreAggro: mix('coreAggro'),
      coreRange: mix('coreRange'),
      loopMin: Math.round(mix('loopMin')),
      loopMax: Math.round(mix('loopMax')),
      starRange: mix('starRange'),
      throwTrail: mix('throwTrail'),
      throwPlayer: mix('throwPlayer'),
    };
    // Distances in the table are in world units; the rules grid is UNIT cells per unit.
    const scaled: BotParams = {
      ...base,
      caution: base.caution * UNIT,
      attackRange: base.attackRange * UNIT,
      coreRange: base.coreRange * UNIT,
      loopMin: base.loopMin * UNIT,
      loopMax: base.loopMax * UNIT,
      starRange: base.starRange * UNIT,
      // bots step through UNIT times more cells, so per-step chances shrink
      throwTrail: base.throwTrail / UNIT,
      throwPlayer: base.throwPlayer / UNIT,
    };
    for (let id = 0; id < 4; id++) if (pid === undefined || pid === id) this.paramsOf[id] = scaled;
    this.params = scaled;
  }

  /** Whether this bot will go after `owner` right now (applies the human bias). */
  private targets(owner: number): boolean {
    if (owner !== this.humanId || this.humanBias >= 1) return true;
    return this.game.rng.chance(this.humanBias);
  }
  /** Extra weight for picking the human as a target when bots gang up. */
  private humanWeight(owner: number): number {
    return owner === this.humanId ? this.humanBias : 1;
  }

  modeOf(pid: number): Mode {
    return this.mode[pid];
  }

  private decide(p: Player): void {
    this.params = this.paramsOf[p.id];
    const game = this.game;
    const g = game.grid;
    const rng = game.rng;
    const here = g.idx(p.x, p.y);
    if (p.plan.length && p.plan[0] === here) p.plan.shift();

    // Heavy thinking (path searches) runs ~10 times a second; in between, just follow the plan.
    if (p.plan.length && game.time - this.lastThink[p.id] < 0.1) {
      this.follow(p);
      return;
    }
    this.lastThink[p.id] = game.time;

    if (p.status === 'shade') {
      if (!p.plan.length || rng.chance(0.1)) this.planGhost(p);
      this.follow(p);
      return;
    }

    if (p.carrying >= 0) {
      if (this.mode[p.id] !== 'carry' || !p.plan.length) {
        const core = game.cores[p.id];
        p.plan = this.path(p, (i) => Math.hypot(g.x(i) - core.x, g.y(i) - core.y) <= CONFIG.nestReach - 0.5) ?? [];
        this.mode[p.id] = 'carry';
      }
      this.follow(p);
      return;
    }

    const onHome = g.owner[here] === p.id;
    this.maybeThrow(p);

    // Danger: run home if an enemy could reach my trail before I'm safe.
    if (!onHome && p.trail.length && this.mode[p.id] !== 'flee') {
      const home = this.path(p, (i) => g.owner[i] === p.id);
      const homeDist = home ? home.length : 999;
      const threat = this.threatDistance(p);
      const tooLong = p.trail.length > this.params.loopMax * 4;
      if (home && (tooLong || (threat <= homeDist + this.params.caution && rng.chance(this.params.reaction)))) {
        p.plan = home;
        this.mode[p.id] = 'flee';
      }
    }

    // Opportunity: cut a nearby enemy trail.
    if (this.mode[p.id] !== 'flee' && this.mode[p.id] !== 'attack') {
      const hitHuman = this.humanId !== null && this.targets(this.humanId);
      const ok = (o: number) => o >= 0 && o !== p.id && !this.isAlly(p, o) && (o !== this.humanId || hitHuman);
      // When ganging up, look further for the human's trail first.
      const target =
        (this.humanBias > 1 && hitHuman
          ? this.path(p, (i) => g.trail[i] === this.humanId, this.params.attackRange * this.humanBias)
          : null) ?? this.path(p, (i) => ok(g.trail[i]), this.params.attackRange);
      if (target) {
        p.plan = target;
        this.mode[p.id] = 'attack';
      }
    }

    if (!p.plan.length) {
      this.mode[p.id] = 'idle';
      if (onHome) this.planTrip(p);
      else {
        p.plan = this.path(p, (i) => g.owner[i] === p.id) ?? [];
        this.mode[p.id] = 'flee';
      }
    }
    this.follow(p);
  }

  private isAlly(p: Player, other: number): boolean {
    const q = this.game.players[other];
    return q.shadeOf === p.id || p.shadeOf === other;
  }

  private threatDistance(p: Player): number {
    const g = this.game.grid;
    let best = 999;
    for (const e of this.game.players) {
      if (e === p) continue;
      const hostile = (e.status === 'alive' && !this.isAlly(p, e.id)) || (e.status === 'shade' && e.shadeOf !== p.id);
      if (!hostile) continue;
      const ei = g.idx(e.x, e.y);
      for (const t of p.trail) best = Math.min(best, manhattan(g, ei, t));
      best = Math.min(best, manhattan(g, ei, g.idx(p.x, p.y)));
    }
    return best;
  }

  /** Path that respects hard mode (never step on own trail). */
  private path(p: Player, goal: (i: number) => boolean, maxDist = Infinity, avoid?: Set<number>): number[] | null {
    const g = this.game.grid;
    const hard = this.game.opts.hardMode;
    return bfs(
      g,
      g.idx(p.x, p.y),
      goal,
      (i) => (!hard || g.trail[i] !== p.id || g.owner[i] === p.id) && !(avoid && avoid.has(i)),
      maxDist,
    );
  }

  private planTrip(p: Player): void {
    const game = this.game;
    const g = game.grid;
    const rng = game.rng;
    const prm = this.params;

    // Grab the star if it's close.
    if (game.star.active) {
      const si = g.idx(game.star.x, game.star.y);
      const toStar = this.path(p, (i) => i === si, prm.starRange);
      if (toStar) {
        p.plan = toStar;
        this.mode[p.id] = 'star';
        return;
      }
    }

    // Raid an enemy nest now and then, preferring weak ones.
    if (rng.chance(prm.coreAggro)) {
      let bestPath: number[] | null = null;
      for (const c of game.cores) {
        if (c.owner === p.id || c.state !== 'nest' || this.isAlly(p, c.owner) || !this.targets(c.owner)) continue;
        const ci = g.idx(c.x, c.y);
        const route = this.path(p, (i) => manhattan(g, i, ci) <= CONFIG.nestReach - 1, prm.coreRange * Math.max(1, this.humanWeight(c.owner)));
        if (!route) continue;
        const score = (route.length + c.hearts * 4 * UNIT) / this.humanWeight(c.owner);
        if (!bestPath || score < bestPath.length) bestPath = route;
      }
      if (bestPath) {
        p.plan = bestPath;
        this.mode[p.id] = 'raid';
        return;
      }
    }

    this.planLoop(p);
  }

  /** Walk to the edge of own land, then draw a rectangle out and back. */
  private planLoop(p: Player): void {
    const game = this.game;
    const g = game.grid;
    const rng = game.rng;
    const prm = this.params;
    const here = g.idx(p.x, p.y);
    const mid = (g.size - 1) / 2;

    // Collect frontier cells of own land reachable over own land.
    const frontier: { path: number[]; cell: number; dirs: Dir[] }[] = [];
    const outward = (i: number): Dir[] => {
      const x = g.x(i);
      const y = g.y(i);
      const dirs: Dir[] = [];
      for (let d = 0 as Dir; d < 4; d = (d + 1) as Dir) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (g.walkable(nx, ny) && g.owner[g.idx(nx, ny)] !== p.id) dirs.push(d);
      }
      return dirs;
    };
    const startDirs = outward(here);
    if (startDirs.length) frontier.push({ path: [], cell: here, dirs: startDirs });
    for (let k = 0; k < 6; k++) {
      const seen = new Set(frontier.map((f) => f.cell));
      const route = bfs(
        g,
        here,
        (i) => !seen.has(i) && outward(i).length > 0 && rng.chance(0.12),
        (i) => g.owner[i] === p.id,
        30 * UNIT,
      );
      if (route) {
        const cell = route[route.length - 1];
        frontier.push({ path: route, cell, dirs: outward(cell) });
      }
    }
    if (!frontier.length) {
      // Fully surrounded by own land/void: wander.
      p.plan = [];
      const d = rng.int(0, 3) as Dir;
      if (g.walkable(p.x + DX[d], p.y + DY[d])) p.plan = [g.idx(p.x + DX[d], p.y + DY[d])];
      return;
    }
    // Prefer heading toward the middle of the board.
    let best = frontier[0];
    let bestScore = Infinity;
    for (const f of frontier) {
      const fx = g.x(f.cell);
      const fy = g.y(f.cell);
      const score = f.path.length + Math.abs(fx - mid) * 0.25 + Math.abs(fy - mid) * 0.25 + rng.next() * 6;
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    // A curved "petal" loop: out along a half-ellipse and back to the border, like Paper.io bots.
    const d = rng.pick(best.dirs);
    const base = Math.atan2(DY[d], DX[d]) + (rng.next() - 0.5) * 0.7;
    const depth = rng.int(prm.loopMin, prm.loopMax);
    const width = rng.int(prm.loopMin, prm.loopMax) / 2;
    const sideSign = rng.chance(0.5) ? 1 : -1;
    const ox = g.x(best.cell) + 0.5;
    const oy = g.y(best.cell) + 0.5;
    const ca = Math.cos(base);
    const sa = Math.sin(base);
    const seq: number[] = [];
    const used = new Set<number>([best.cell]);
    let x = g.x(best.cell);
    let y = g.y(best.cell);
    const samples = 28;
    outer: for (let k = 1; k <= samples; k++) {
      const t = k / samples;
      const fwd = depth * Math.sin(Math.PI * t);
      const lat = sideSign * width * (1 - Math.cos(Math.PI * t));
      const tx = Math.floor(ox + fwd * ca - lat * sa);
      const ty = Math.floor(oy + fwd * sa + lat * ca);
      // walk there one side-step at a time so the path stays 4-connected
      while (x !== tx || y !== ty) {
        const stepX = x !== tx && (y === ty || rng.chance(0.5));
        const nx = stepX ? x + Math.sign(tx - x) : x;
        const ny = stepX ? y : y + Math.sign(ty - y);
        const i = g.idx(nx, ny);
        if (!g.walkable(nx, ny) || used.has(i)) break outer;
        x = nx;
        y = ny;
        seq.push(i);
        used.add(i);
        if (g.owner[i] === p.id && seq.length > UNIT * 2) break outer;
      }
    }
    // Then the shortest way home, not crossing the planned loop.
    const end = seq.length ? seq[seq.length - 1] : best.cell;
    let back: number[] = [];
    if (g.owner[end] !== p.id) {
      const avoid = new Set(seq);
      back =
        bfs(
          g,
          end,
          (i) => g.owner[i] === p.id,
          (i) => !avoid.has(i) && (!game.opts.hardMode || g.trail[i] !== p.id),
        ) ?? [];
    }
    p.plan = [...best.path, ...seq, ...back];
    this.mode[p.id] = 'expand';
  }

  private planGhost(p: Player): void {
    const g = this.game.grid;
    const rng = this.game.rng;
    const trail = bfs(
      g,
      g.idx(p.x, p.y),
      (i) => g.trail[i] >= 0 && g.trail[i] !== p.shadeOf && g.trail[i] !== p.id,
      () => true,
      20 * UNIT,
    );
    if (trail) {
      p.plan = trail;
    } else {
      // Captured riders never come back; they drift around looking for trails to cut.
      const tx = rng.int(4 * UNIT, g.size - 4 * UNIT);
      const ty = rng.int(4 * UNIT, g.size - 4 * UNIT);
      p.plan = bfs(g, g.idx(p.x, p.y), (i) => i === g.idx(tx, ty), () => true) ?? [];
    }
    this.mode[p.id] = 'ghost';
  }

  private follow(p: Player): void {
    const g = this.game.grid;
    while (p.plan.length && p.plan[0] === g.idx(p.x, p.y)) p.plan.shift();
    if (!p.plan.length) return;
    const next = p.plan[0];
    const dx = g.x(next) - p.x;
    const dy = g.y(next) - p.y;
    if (Math.abs(dx) + Math.abs(dy) !== 1 || g.voided[next]) {
      p.plan = [];
      return;
    }
    // Steer at the centre of the next cell; bots turn instantly (rendering smooths it).
    const a = Math.atan2(g.y(next) + 0.5 - p.py, g.x(next) + 0.5 - p.px);
    p.aim = a;
    p.heading = a;
    p.moving = true;
  }

  /** Throw balls at enemies, their trails or nests, or to grab land when the pouch is full. */
  private maybeThrow(p: Player): void {
    const game = this.game;
    if (p.status !== 'alive' || p.balls <= 0 || p.throwCooldown > 0) return;
    const rng = game.rng;
    const prm = this.params;
    const R = CONFIG.throwRange;
    const inRange = (x: number, y: number) => {
      const d = Math.hypot(x - p.px, y - p.py);
      return d >= 2 * UNIT && d <= R;
    };
    // 1. Enemy trails: cutting one bonks its owner.
    const g = game.grid;
    let bestTrail: [number, number] | null = null;
    let bestD = Infinity;
    for (let y = Math.max(0, Math.floor(p.py - R)); y <= Math.min(g.size - 1, Math.floor(p.py + R)); y++) {
      for (let x = Math.max(0, Math.floor(p.px - R)); x <= Math.min(g.size - 1, Math.floor(p.px + R)); x++) {
        const t = g.trail[g.idx(x, y)];
        if (t < 0 || t === p.id || this.isAlly(p, t)) continue;
        const d = Math.hypot(x + 0.5 - p.px, y + 0.5 - p.py) / this.humanWeight(t);
        if (d >= 2 * UNIT && d <= R && d < bestD) {
          bestD = d;
          bestTrail = [x + 0.5, y + 0.5];
        }
      }
    }
    if (bestTrail && rng.chance(prm.throwTrail) && this.targets(g.trail[g.idx(Math.floor(bestTrail[0]), Math.floor(bestTrail[1]))])) {
      game.throwAt(p.id, bestTrail[0], bestTrail[1]);
      return;
    }
    // 2. Enemy players (lead the target a little); egg carriers first.
    for (const q of game.players) {
      if (q === p || q.status !== 'alive' || this.isAlly(p, q.id)) continue;
      const lead = q.moving ? game.speedOf(q) * CONFIG.throwTime * 0.6 : 0;
      const tx = q.px + Math.cos(q.heading) * lead;
      const ty = q.py + Math.sin(q.heading) * lead;
      if (!inRange(tx, ty)) continue;
      if (rng.chance((q.carrying >= 0 ? prm.throwPlayer * 2 : prm.throwPlayer) * this.humanWeight(q.id))) {
        game.throwAt(p.id, tx, ty);
        return;
      }
    }
    // 3. Enemy nests with hearts left.
    for (const c of game.cores) {
      if (c.owner === p.id || c.state !== 'nest' || c.hearts <= 0 || c.invuln > 0 || this.isAlly(p, c.owner)) continue;
      if (inRange(c.x + 0.5, c.y + 0.5) && rng.chance(prm.throwPlayer * this.humanWeight(c.owner))) {
        game.throwAt(p.id, c.x + 0.5, c.y + 0.5);
        return;
      }
    }
    // 4. Pouch full: lob ahead to grab land.
    if (p.balls >= game.ballCap(p.id) && rng.chance(0.25)) {
      const tx = p.px + Math.cos(p.heading) * R * 0.8;
      const ty = p.py + Math.sin(p.heading) * R * 0.8;
      if (g.walkable(Math.floor(tx), Math.floor(ty)) && g.owner[g.idx(Math.floor(tx), Math.floor(ty))] !== p.id) game.throwAt(p.id, tx, ty);
    }
  }
}
