import type { Game } from '../core/Game';
import type { Bots } from './Bot';

/**
 * Invisible difficulty: there is no Easy/Normal/Hard choice. Each match picks a mood
 * from the player's recent results and keeps nudging the bots while it plays.
 *
 * - mercy: after losses (and in the very first match) the bots go easy and mostly
 *   leave the player alone, so the player gets a win.
 * - challenge: after two wins in a row the bots sharpen up and gang up on the
 *   player, so the streak usually ends.
 * - normal: rubber-banding keeps the match close.
 */
export type MatchMood = 'mercy' | 'normal' | 'challenge';

/** `recent` is the player's results, oldest first, e.g. "WLWW". */
export function pickMood(recent: string): MatchMood {
  if (recent.length === 0) return 'mercy';
  if (recent.endsWith('LL')) return 'mercy';
  if (recent.endsWith('L') && recent.length < 3) return 'mercy';
  if (recent.endsWith('WW')) return 'challenge';
  return 'normal';
}

interface Tuning {
  skill: number;
  bias: number; // how much bots target the player
  botSpeed: number;
  botBalls: number; // bots' ball refill speed
}

const START: Record<MatchMood, Tuning> = {
  mercy: { skill: 0.05, bias: 0.25, botSpeed: 0.9, botBalls: 0.6 },
  normal: { skill: 0.5, bias: 1, botSpeed: 1, botBalls: 1 },
  challenge: { skill: 1, bias: 1.7, botSpeed: 1.05, botBalls: 1.2 },
};

export class Director {
  readonly mood: MatchMood;
  private readonly game: Game;
  private readonly bots: Bots;
  private readonly human: number;
  private timer = 3;
  private tuning: Tuning;

  constructor(game: Game, bots: Bots, human: number, mood: MatchMood) {
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
      this.bots.setSkill(this.tuning.skill, p.id);
      p.speedMul = this.tuning.botSpeed;
      p.ballRateMul = this.tuning.botBalls;
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
      // Make sure the player ends up on top: the further behind, the gentler the bots.
      if (ratio < 1) {
        const behind = Math.min(1, (1 - ratio) * 1.5 + (late ? 0.3 : 0));
        t.skill = 0;
        t.bias = 0.25 - 0.2 * behind;
        t.botSpeed = 0.9 - 0.1 * behind;
        t.botBalls = 0.6 - 0.3 * behind;
      }
    } else if (this.mood === 'challenge') {
      // Push hard while the player leads; ease off only if they're crushed.
      if (ratio >= 1) {
        t.bias = late ? 2.4 : 2;
        t.botSpeed = late ? 1.08 : 1.05;
        t.botBalls = 1.4;
      } else if (ratio < 0.4) {
        t.bias = 1.1;
        t.botSpeed = 1;
      }
    } else {
      // Normal: rubber-band toward a close match.
      if (ratio < 0.6) {
        t.skill = 0.3;
        t.bias = 0.6;
        t.botSpeed = 0.97;
      } else if (ratio > 1.5) {
        t.skill = 0.75;
        t.bias = 1.4;
        t.botSpeed = 1.02;
      }
    }
    this.tuning = t;
    this.apply();
  }
}
