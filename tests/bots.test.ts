import { describe, expect, it } from 'vitest';
import { Bots } from '../src/ai/Bot';
import { CONFIG, type Difficulty } from '../src/config';
import { Game } from '../src/core/Game';

function simulate(seed: number, difficulty: Difficulty) {
  const game = new Game({ startMode: 'patch', hardMode: false, humanSlot: null, difficulty, seed });
  new Bots(game, difficulty);
  const dt = 1 / CONFIG.tickRate;
  let ticks = 0;
  let captures = 0;
  let bonks = 0;
  let maxLand = 0;
  while (!game.over && ticks < CONFIG.matchSeconds * CONFIG.tickRate + 10) {
    game.tick(dt);
    for (const e of game.events) {
      if (e.type === 'capture') captures++;
      if (e.type === 'bonk' && e.by !== e.victim) bonks++;
    }
    game.events = [];
    maxLand = Math.max(maxLand, ...game.land);
    ticks++;
  }
  return { game, captures, bonks, maxLand };
}

describe('bots', () => {
  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    it(`play full matches on ${difficulty}`, () => {
      for (let seed = 1; seed <= 6; seed++) {
        const r = simulate(seed, difficulty);
        expect(r.game.over).toBe(true);
        expect(r.game.winner).toBeGreaterThanOrEqual(0);
        expect(r.captures).toBeGreaterThan(10);
        expect(r.maxLand).toBeGreaterThan(80);
      }
    });
  }

  it('bots fight each other (bonks happen)', () => {
    let total = 0;
    for (let seed = 1; seed <= 6; seed++) total += simulate(seed, 'hard').bonks;
    expect(total).toBeGreaterThan(3);
  });

  it('hard mode bots never bonk themselves on their own trail', () => {
    const game = new Game({ startMode: 'patch', hardMode: true, humanSlot: null, difficulty: 'normal', seed: 3 });
    new Bots(game, 'normal');
    let selfBonks = 0;
    for (let i = 0; i < 60 * CONFIG.tickRate && !game.over; i++) {
      // Track position before tick to separate void self-bonks (void starts at 60s).
      game.tick(1 / CONFIG.tickRate);
      for (const e of game.events) if (e.type === 'bonk' && e.by === e.victim) selfBonks++;
      game.events = [];
    }
    expect(selfBonks).toBe(0);
  });
});
