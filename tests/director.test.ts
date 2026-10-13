import { describe, expect, it } from 'vitest';
import { Bots } from '../src/ai/Bot';
import { Director, pickMood, type MatchMood } from '../src/ai/Director';
import { CONFIG } from '../src/config';
import { Game } from '../src/core/Game';

describe('pickMood', () => {
  it('first match and losing streaks are merciful; win streaks are a challenge', () => {
    expect(pickMood('')).toBe('mercy');
    expect(pickMood('L')).toBe('mercy');
    expect(pickMood('WLL')).toBe('mercy');
    expect(pickMood('WW')).toBe('challenge');
    expect(pickMood('LWW')).toBe('challenge');
    expect(pickMood('WLW')).toBe('normal');
  });
});

/** Play a match where a bot stands in for the human (slot 0). Returns true if slot 0 won. */
function play(mood: MatchMood, seed: number): boolean {
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
  return game.winner === 0;
}

describe('director', () => {
  it('mercy matches are usually won and challenge matches usually lost', () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    const mercy = seeds.filter((s) => play('mercy', s)).length;
    const challenge = seeds.filter((s) => play('challenge', s)).length;
    console.log(`mercy wins ${mercy}/8, challenge wins ${challenge}/8`);
    expect(mercy).toBeGreaterThan(challenge);
    expect(mercy).toBeGreaterThanOrEqual(5);
    expect(challenge).toBeLessThanOrEqual(2);
  }, 120000);
});
