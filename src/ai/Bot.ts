import type { Difficulty } from '../config';
import type { Game, Player } from '../core/Game';
import { DX, DY, opposite, type Dir } from '../core/Grid';
import { CONFIG } from '../config';
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
  private readonly params: BotParams;
  private readonly mode: Mode[] = ['idle', 'idle', 'idle', 'idle'];

  constructor(game: Game, difficulty: Difficulty) {
    this.game = game;
    this.params = PARAMS[difficulty];
    game.onArrive = (p) => this.decide(p);
  }

  modeOf(pid: number): Mode {
    return this.mode[pid];
  }

  private decide(p: Player): void {
    const game = this.game;
    const g = game.grid;
    const rng = game.rng;
    const here = g.idx(p.x, p.y);
    if (p.plan.length && p.plan[0] === here) p.plan.shift();

    if (p.status === 'shade') {
      if (!p.plan.length || rng.chance(0.1)) this.planGhost(p);
      this.follow(p);
      return;
    }

    if (p.carrying >= 0) {
      if (this.mode[p.id] !== 'carry' || !p.plan.length) {
        const core = game.cores[p.id];
        p.plan = this.path(p, (i) => manhattan(g, i, g.idx(core.x, core.y)) <= 1) ?? [];
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
      const homeDist = home ? home.length : 99;
      const threat = this.threatDistance(p);
      const tooLong = p.trail.length > this.params.loopMax * 4;
      if (home && (tooLong || (threat <= homeDist + this.params.caution && rng.chance(this.params.reaction)))) {
        p.plan = home;
        this.mode[p.id] = 'flee';
      }
    }

    // Opportunity: cut a nearby enemy trail.
    if (this.mode[p.id] !== 'flee' && this.mode[p.id] !== 'attack') {
      const target = this.path(
        p,
        (i) => g.trail[i] >= 0 && g.trail[i] !== p.id && !this.isAlly(p, g.trail[i]),
        this.params.attackRange,
      );
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
    let best = 99;
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
        if (c.owner === p.id || c.state !== 'nest' || this.isAlly(p, c.owner)) continue;
        const ci = g.idx(c.x, c.y);
        const route = this.path(p, (i) => manhattan(g, i, ci) <= 1, prm.coreRange);
        if (!route) continue;
        const score = route.length + c.hearts * 4;
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
        (i) => !seen.has(i) && outward(i).length > 0 && rng.chance(0.35),
        (i) => g.owner[i] === p.id,
        30,
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
    const d = rng.pick(best.dirs);
    let side = (rng.chance(0.5) ? (d + 1) % 4 : (d + 3) % 4) as Dir;
    const l1 = rng.int(prm.loopMin, prm.loopMax);
    const l2 = rng.int(prm.loopMin, prm.loopMax);

    const seq: number[] = [];
    let x = g.x(best.cell);
    let y = g.y(best.cell);
    const legs: [Dir, number][] = [
      [d, l1],
      [side, l2],
      [opposite(d), l1],
    ];
    const used = new Set<number>();
    for (let leg = 0; leg < legs.length; leg++) {
      let [dir, len] = legs[leg];
      if (leg === 1 && !g.walkable(x + DX[dir], y + DY[dir])) {
        side = opposite(side);
        dir = side;
        len = Math.max(len, 1);
      }
      for (let s = 0; s < len; s++) {
        const nx = x + DX[dir];
        const ny = y + DY[dir];
        if (!g.walkable(nx, ny) || used.has(g.idx(nx, ny))) break;
        x = nx;
        y = ny;
        const i = g.idx(x, y);
        seq.push(i);
        used.add(i);
        if (g.owner[i] === p.id && seq.length > 1) break;
      }
      if (seq.length && g.owner[seq[seq.length - 1]] === p.id) break;
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
      12,
    );
    if (trail) {
      p.plan = trail;
    } else {
      // Head for the nearest nest that isn't the capturer's to break free.
      const nests = this.game.cores.filter((c) => c.state === 'nest' && c.owner !== p.shadeOf && c.owner !== p.id);
      const targets = new Set(nests.map((c) => g.idx(c.x, c.y)));
      const route = nests.length
        ? bfs(g, g.idx(p.x, p.y), (i) => {
            for (const t of targets) if (manhattan(g, i, t) <= 1) return true;
            return false;
          }, () => true)
        : null;
      if (route && rng.chance(0.8)) p.plan = route;
      else {
        const tx = rng.int(4, g.size - 5);
        const ty = rng.int(4, g.size - 5);
        p.plan = bfs(g, g.idx(p.x, p.y), (i) => i === g.idx(tx, ty), () => true) ?? [];
      }
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
      return d >= 2 && d <= R;
    };
    // 1. Enemy trails: cutting one bonks its owner.
    const g = game.grid;
    let bestTrail: [number, number] | null = null;
    let bestD = Infinity;
    for (let y = Math.max(0, Math.floor(p.py - R)); y <= Math.min(g.size - 1, Math.floor(p.py + R)); y++) {
      for (let x = Math.max(0, Math.floor(p.px - R)); x <= Math.min(g.size - 1, Math.floor(p.px + R)); x++) {
        const t = g.trail[g.idx(x, y)];
        if (t < 0 || t === p.id || this.isAlly(p, t)) continue;
        const d = Math.hypot(x + 0.5 - p.px, y + 0.5 - p.py);
        if (d >= 2 && d <= R && d < bestD) {
          bestD = d;
          bestTrail = [x + 0.5, y + 0.5];
        }
      }
    }
    if (bestTrail && rng.chance(prm.throwTrail)) {
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
      if (rng.chance(q.carrying >= 0 ? prm.throwPlayer * 2 : prm.throwPlayer)) {
        game.throwAt(p.id, tx, ty);
        return;
      }
    }
    // 3. Enemy nests with hearts left.
    for (const c of game.cores) {
      if (c.owner === p.id || c.state !== 'nest' || c.hearts <= 0 || c.invuln > 0 || this.isAlly(p, c.owner)) continue;
      if (inRange(c.x + 0.5, c.y + 0.5) && rng.chance(prm.throwPlayer)) {
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
