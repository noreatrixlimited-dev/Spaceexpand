import type { Game } from '../core/Game';
import type { Bots } from './Bot';

/**
 * Invisible difficulty: there is no Easy/Normal/Hard choice. The match rhythm is
 * win -> close loss -> comeback win:
 *
 * - mercy: the first match and any match after a loss. The bots go easy and mostly
 *   leave the player alone, so the comeback (with the retry boost) is a win.
 * - close: the match after a win. The bots keep pace just ahead of the player, so it
 *   usually ends as a near miss ("So close!") rather than a crushing loss; a player
 *   who outplays them can still win it.
 */
export type MatchMood = 'mercy' | 'close';

/** `recent` is the player's results, oldest first, e.g. "WLW". */
export function pickMood(recent: string): MatchMood {
  return recent.endsWith('W') ? 'close' : 'mercy';
}

interface Tuning {
  skill: number;
  bias: number; // how much bots target the player
  botSpeed: number;
  botBalls: number; // bots' ball refill speed
}

const START: Record<MatchMood, Tuning> = {
  mercy: { skill: 0.05, bias: 0.25, botSpeed: 0.9, botBalls: 0.6 },
  close: { skill: 0.85, bias: 1.3, botSpeed: 1.03, botBalls: 1.15 },
};

export class Director {
  readonly mood: MatchMood;
  private readonly game: Game;
  private readonly bots: Bots;
  private readonly human: number;
  private timer = 3;
  private tuning: Tuning;

  /** On boss islands one robot is the boss: sharper, faster and with more ammo; the others ease off. */
  private readonly bossId: number;

  constructor(game: Game, bots: Bots, human: number, mood: MatchMood, bossId = -1) {
    this.bossId = bossId;
    this.game = game;
    this.bots = bots;
    this.human = human;
    this.mood = mood;
    this.tuning = { ...START[mood] };
    this.apply();
  }

  private apply(): void {
    for (const p of this.game.players) {
      if (p.id === this.human) continue;
      const boss = p.id === this.bossId;
      const helper = this.bossId >= 0 && !boss;
      this.bots.setSkill(boss ? Math.max(0.8, this.tuning.skill) : helper ? this.tuning.skill * 0.5 : this.tuning.skill, p.id);
      p.speedMul = this.tuning.botSpeed * (boss ? 1.08 : helper ? 0.95 : 1);
      p.ballRateMul = this.tuning.botBalls * (boss ? 1.3 : helper ? 0.8 : 1);
    }
    this.bots.humanBias = this.tuning.bias;
  }

  update(dt: number): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 3;
    const g = this.game;
    const me = g.land[this.human];
    let best = 0;
    for (const p of g.players) if (p.id !== this.human && g.cores[p.id].state !== 'captured') best = Math.max(best, g.land[p.id]);
    const ratio = best > 0 ? me / best : 2; // >1 = player is ahead
    const late = g.time > 60;
    const t = { ...START[this.mood] };

    if (this.mood === 'mercy') {
      this.bots.spareHumanNest = true;
      // Make sure the player ends up on top: the further behind, the gentler the bots.
      if (ratio < 1) {
        const behind = Math.min(1, (1 - ratio) * 1.5 + (late ? 0.3 : 0));
        t.skill = 0;
        t.bias = 0.25 - 0.2 * behind;
        t.botSpeed = 0.9 - 0.1 * behind;
        t.botBalls = 0.6 - 0.3 * behind;
      }
    } else {
      // Close: stay just ahead. Push when the player catches up, ease off when they fall
      // far behind, and don't finish their nest off early (a near miss beats a knockout).
      if (ratio >= 0.95) {
        t.skill = 1;
        t.bias = late ? 2.3 : 1.9;
        t.botSpeed = late ? 1.07 : 1.05;
        t.botBalls = 1.35;
      } else if (ratio < 0.7) {
        t.skill = 0.35;
        t.bias = 0.5;
        t.botSpeed = 0.96;
        t.botBalls = 0.8;
      }
      if (g.cores[this.human].hearts <= 1 && g.time < 150) t.bias = Math.min(t.bias, 0.35);
      // Fair fight for the nest: the match usually ends in a final duel the player narrowly loses.
      this.bots.spareHumanNest = false;
    }
    this.tuning = t;
    this.apply();
  }
}
