import { describe, expect, it } from 'vitest';
import { applyMatch, dailyMissions } from '../src/ui/Missions';

describe('daily missions', () => {
  it('three different missions, stable for the day and different the next', () => {
    const a = dailyMissions('2026-10-14');
    expect(a.list).toHaveLength(3);
    expect(new Set(a.list.map((m) => m.kind)).size).toBe(3);
    expect(dailyMissions('2026-10-14')).toEqual(a);
    const days = ['2026-10-15', '2026-10-16', '2026-10-17'].map((d) => dailyMissions(d).list.map((m) => m.kind).join());
    expect(new Set([a.list.map((m) => m.kind).join(), ...days]).size).toBeGreaterThan(1);
  });
  it('progress adds up across matches and completes once', () => {
    const s = dailyMissions('2026-10-14');
    const facts = { won: true, peakPct: 50, eggsTaken: 2, trailsCut: 5, throws: 30, stars: 3, combos: 2 };
    const first = applyMatch(s, facts);
    const second = applyMatch(s, facts);
    expect(first.length + second.length).toBe(3);
    expect(applyMatch(s, facts)).toHaveLength(0);
    expect(s.list.every((m) => m.done)).toBe(true);
  });
});
