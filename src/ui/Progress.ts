/** Long-term goals: the daily play streak, a weekly challenge and achievements. Pure logic. */

export interface Streak {
  /** Last day (YYYY-MM-DD) a match was played. */
  last: string;
  count: number;
  best: number;
}

/** Count consecutive days with at least one match. Returns true if the streak grew today. */
export function bumpStreak(s: Streak, day: string): boolean {
  if (s.last === day) return false;
  s.count = s.last && daysBetween(s.last, day) === 1 ? s.count + 1 : 1;
  s.last = day;
  s.best = Math.max(s.best, s.count);
  return true;
}

/** The streak as it stands today (0 if a day was missed). */
export function liveStreak(s: Streak, day: string): number {
  if (!s.last) return 0;
  const gap = daysBetween(s.last, day);
  return gap <= 1 ? s.count : 0;
}

function daysBetween(a: string, b: string): number {
  const t = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.round((t(b) - t(a)) / 86400000);
}

export interface Weekly {
  week: number;
  /** Islands won this week. */
  islands: string[];
  done: boolean;
}

export const WEEKLY_TARGET = 3;
export const WEEKLY_REWARD = 200;

/** Weekly challenge: win on 3 different islands. Returns true when it completes. */
export function weeklyWin(w: Weekly, week: number, island: string): boolean {
  if (w.week !== week) {
    w.week = week;
    w.islands = [];
    w.done = false;
  }
  if (w.done || w.islands.includes(island)) return false;
  w.islands.push(island);
  if (w.islands.length >= WEEKLY_TARGET) {
    w.done = true;
    return true;
  }
  return false;
}

/** Everything the achievements look at. */
export interface ProgressFacts {
  wins: number;
  games: number;
  trailsCut: number;
  nests: number;
  bestLand: number;
  stars: number;
  perfects: number;
  islandsWon: number;
  skins: number;
  bestStreak: number;
}

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  reward: number;
  /** Current value and target. */
  progress: (f: ProgressFacts) => [number, number];
}

const A = (id: string, name: string, desc: string, reward: number, key: keyof ProgressFacts, target: number): Achievement => ({
  id,
  name,
  desc,
  reward,
  progress: (f) => [Math.min(f[key], target), target],
});

export const ACHIEVEMENTS: Achievement[] = [
  A('firstWin', 'First win', 'Win a match', 50, 'wins', 1),
  A('popper', 'Bubble popper', 'Pop 25 bubble trails', 100, 'trailsCut', 25),
  A('popMaster', 'Pop master', 'Pop 100 bubble trails', 250, 'trailsCut', 100),
  A('nests', 'Egg collector', 'Capture 10 nests', 150, 'nests', 10),
  A('bigLand', 'Land lover', 'Hold 50% of an island', 150, 'bestLand', 50),
  A('perfect', 'Perfect!', 'Win an island with 3 stars', 100, 'perfects', 1),
  A('stars', 'Star hunter', 'Collect 20 stars', 200, 'stars', 20),
  A('world1', 'World 1 champion', 'Win all 8 islands of World 1', 200, 'islandsWon', 8),
  A('world2', 'World 2 champion', 'Win all 16 islands', 400, 'islandsWon', 16),
  A('regular', 'Regular', 'Play 25 matches', 100, 'games', 25),
  A('streak', 'Hot streak', 'Play 7 days in a row', 200, 'bestStreak', 7),
  A('collector', 'Collector', 'Own 10 skins', 200, 'skins', 10),
];

/** Achievements reached but not yet claimed. */
export function newAchievements(f: ProgressFacts, claimed: string[]): Achievement[] {
  return ACHIEVEMENTS.filter((a) => {
    if (claimed.includes(a.id)) return false;
    const [v, t] = a.progress(f);
    return v >= t;
  });
}
