import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { Game } from '../src/core/Game';
import { LEVEL_MAPS } from '../src/maps';

const make = (map: string) => new Game({ map, startMode: 'patch', hardMode: false, humanSlot: 0, difficulty: 'normal', seed: 4 });

describe('island hazards', () => {
  it('World 1 islands have no hazards; World 2 islands have puddles or wind', () => {
    for (const m of LEVEL_MAPS) {
      const g = make(m.id);
      if (m.world === 1) expect(g.puddles.length + g.wind.strength).toBe(0);
      if (m.hazard === 'puddles') expect(g.puddles.length).toBeGreaterThanOrEqual(3);
      if (m.hazard === 'wind') expect(g.wind.strength).toBeGreaterThan(0);
    }
  });
  it('puddles slow bubbles down', () => {
    const g = make('pebble');
    const p = g.players[0];
    const d = g.puddles[0];
    const normal = g.speedOf(p);
    p.px = d.x;
    p.py = d.y;
    expect(g.speedOf(p)).toBeCloseTo(normal * CONFIG.puddleSlow);
  });
  it('the Big Bubble power stuns and shoves a bubble it touches', () => {
    const g = make('clover');
    const [a, b] = g.players;
    a.power = 'big';
    a.powerTimer = 5;
    b.px = a.px + CONFIG.bumpDistance * 1.2;
    b.py = a.py;
    g.tick(1 / 60);
    expect(b.stunTimer).toBeGreaterThan(0);
  });
});
