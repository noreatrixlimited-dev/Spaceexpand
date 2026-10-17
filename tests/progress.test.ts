import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, bumpStreak, liveStreak, newAchievements, weeklyWin, type ProgressFacts } from '../src/ui/Progress';

describe('streak', () => {
  it('counts consecutive days and resets after a missed day', () => {
    const s = { last: '', count: 0, best: 0 };
    expect(bumpStreak(s, '2026-10-01')).toBe(true);
    expect(bumpStreak(s, '2026-10-01')).toBe(false);
    bumpStreak(s, '2026-10-02');
    bumpStreak(s, '2026-10-03');
    expect(s.count).toBe(3);
    expect(liveStreak(s, '2026-10-04')).toBe(3);
    expect(liveStreak(s, '2026-10-06')).toBe(0);
    bumpStreak(s, '2026-10-06');
    expect(s.count).toBe(1);
    expect(s.best).toBe(3);
  });
});

describe('weekly challenge', () => {
  it('completes after wins on 3 different islands, and resets each week', () => {
    const w = { week: 0, islands: [] as string[], done: false };
    expect(weeklyWin(w, 5, 'a')).toBe(false);
    expect(weeklyWin(w, 5, 'a')).toBe(false);
    expect(weeklyWin(w, 5, 'b')).toBe(false);
    expect(weeklyWin(w, 5, 'c')).toBe(true);
    expect(weeklyWin(w, 5, 'd')).toBe(false);
    expect(weeklyWin(w, 6, 'a')).toBe(false);
    expect(w.islands).toEqual(['a']);
  });
});

describe('achievements', () => {
  it('unlock once when their goal is reached', () => {
    const f: ProgressFacts = { wins: 1, games: 3, trailsCut: 30, nests: 0, bestLand: 20, stars: 2, perfects: 0, islandsWon: 1, skins: 2, bestStreak: 1 };
    const got = newAchievements(f, []).map((a) => a.id);
    expect(got).toEqual(['firstWin', 'popper']);
    expect(newAchievements(f, got)).toHaveLength(0);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });
});
