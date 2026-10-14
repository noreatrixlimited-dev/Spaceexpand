import { describe, expect, it } from 'vitest';
import { Bots } from '../src/ai/Bot';
import { Director, pickMood, type MatchMood } from '../src/ai/Director';
import { CONFIG } from '../src/config';
import { Game } from '../src/core/Game';

describe('pickMood', () => {
  it('after a loss (or first match) the bots are kind; after a win it is a close match', () => {
    expect(pickMood('')).toBe('mercy');
    expect(pickMood('L')).toBe('mercy');
    expect(pickMood('WLL')).toBe('mercy');
    expect(pickMood('W')).toBe('close');
    expect(pickMood('LWW')).toBe('close');
  });
});

/** Play a match where a bot stands in for the human (slot 0). Returns true if slot 0 won. */
function play(mood: MatchMood, seed: number): { won: boolean; gap: number } {
  const game = new Game({ map: 'classic', startMode: 'patch', hardMode: false, humanSlot: 0, difficulty: 'normal', seed });
  game.players[0].isHuman = false; // let the bot brain drive the "human" too
  const bots = new Bots(game, 0.5);
  const director = new Director(game, bots, 0, mood);
  bots.setSkill(0.5, 0); // the stand-in player plays at a steady, average level
  const dt = 1 / CONFIG.tickRate;
  while (!game.over) {
    game.tick(dt);
    director.update(dt);
    game.events = [];
  }
  const best = Math.max(...game.players.filter((p) => p.id !== 0).map((p) => game.percent(p.id)));
  return { won: game.winner === 0, gap: best - game.percent(0) };
}

describe('director', () => {
  it('mercy matches are usually won; close matches are usually narrow losses', () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    const mercy = seeds.map((s) => play('mercy', s));
    const close = seeds.map((s) => play('close', s));
    const mercyWins = mercy.filter((r) => r.won).length;
    const closeWins = close.filter((r) => r.won).length;
    const gaps = close.filter((r) => !r.won).map((r) => r.gap.toFixed(1));
    console.log(`mercy wins ${mercyWins}/8, close wins ${closeWins}/8, close loss gaps ${gaps.join(', ')}`);
    expect(mercyWins).toBeGreaterThanOrEqual(5);
    expect(closeWins).toBeLessThanOrEqual(3);
  }, 120000);
});
