import { describe, expect, it } from 'vitest';
import { rewardFor, type MatchSummary } from '../src/ui/Rewards';

const base: MatchSummary = {
  won: false, rank: 2, peakPct: 30, finalPct: 28, rivalPct: 31, rivalName: 'Cherry', captured: false, outlasted: 1,
  heartsLost: 1, bonked: 0, eggStolen: false, throws: 10, eggsTaken: 0, trailsCut: 1, firstWinToday: false,
};

describe('rewards', () => {
  it('a narrow loss is framed as "So close!" with a tip and still pays coins', () => {
    const r = rewardFor(base);
    expect(r.title).toBe('So close!');
    expect(r.note).toContain('3.0% behind 1st place');
    expect(r.tip).not.toBe('');
    expect(r.coins).toBeGreaterThan(10);
    expect(r.stars).toBe(0);
  });
  it('losing the final duel says how many robots you outlasted', () => {
    const r = rewardFor({ ...base, captured: true, outlasted: 2 });
    expect(r.title).toBe('Final duel!');
    expect(r.note).toContain('2 robots');
  });
  it('wins earn stars and more coins; first win of the day is a bonus', () => {
    const win = { ...base, won: true, rank: 1, peakPct: 40, heartsLost: 0 };
    const r = rewardFor(win);
    expect(r.stars).toBe(3);
    expect(r.coins).toBeGreaterThan(rewardFor(base).coins);
    expect(rewardFor({ ...win, firstWinToday: true }).coins).toBe(r.coins + 50);
  });
});
