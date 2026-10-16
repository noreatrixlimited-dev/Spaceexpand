/** Daily missions (three a day) and the 7-day gift calendar. Pure logic, saved by the Store. */

export type MissionKind = 'play' | 'win' | 'land' | 'eggs' | 'bonks' | 'throws' | 'stars' | 'combo';

export interface Mission {
  kind: MissionKind;
  target: number;
  reward: number;
  progress: number;
  done: boolean;
}

export interface MissionDay {
  day: string;
  list: Mission[];
}

/** What one match contributed. */
export interface MatchFacts {
  won: boolean;
  peakPct: number;
  eggsTaken: number;
  trailsCut: number;
  throws: number;
  stars: number;
  combos: number;
}

const POOL: { kind: MissionKind; targets: number[]; reward: number }[] = [
  { kind: 'play', targets: [2, 3], reward: 30 },
  { kind: 'win', targets: [1, 2], reward: 50 },
  { kind: 'land', targets: [25, 35], reward: 40 },
  { kind: 'eggs', targets: [1, 2], reward: 50 },
  { kind: 'bonks', targets: [3, 5], reward: 40 },
  { kind: 'throws', targets: [15, 25], reward: 30 },
  { kind: 'stars', targets: [2, 4], reward: 50 },
  { kind: 'combo', targets: [1, 2], reward: 40 },
];

export function missionText(m: Mission): string {
  switch (m.kind) {
    case 'play':
      return `Play ${m.target} matches`;
    case 'win':
      return m.target === 1 ? 'Win a match' : `Win ${m.target} matches`;
    case 'land':
      return `Grab ${m.target}% land in one match`;
    case 'eggs':
      return m.target === 1 ? 'Capture a nest' : `Capture ${m.target} nests`;
    case 'bonks':
      return `Cut ${m.target} bubble trails`;
    case 'throws':
      return `Throw ${m.target} paint balls`;
    case 'stars':
      return `Earn ${m.target} stars`;
    case 'combo':
      return m.target === 1 ? 'Make a combo (two grabs in a row)' : `Make ${m.target} combos`;
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Today's three missions (the same all day, different every day). */
export function dailyMissions(day: string): MissionDay {
  let h = hash(day);
  const next = () => (h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 4294967296;
  const pool = POOL.slice();
  const list: Mission[] = [];
  while (list.length < 3) {
    const k = Math.floor(next() * pool.length);
    const p = pool.splice(k, 1)[0];
    const t = Math.floor(next() * p.targets.length);
    list.push({ kind: p.kind, target: p.targets[t], reward: p.reward + t * 20, progress: 0, done: false });
  }
  return { day, list };
}

/** Add a match to today's missions; returns the missions it completed. */
export function applyMatch(state: MissionDay, f: MatchFacts): Mission[] {
  const finished: Mission[] = [];
  for (const m of state.list) {
    if (m.done) continue;
    switch (m.kind) {
      case 'play':
        m.progress += 1;
        break;
      case 'win':
        m.progress += f.won ? 1 : 0;
        break;
      case 'land':
        m.progress = Math.max(m.progress, Math.floor(f.peakPct));
        break;
      case 'eggs':
        m.progress += f.eggsTaken;
        break;
      case 'bonks':
        m.progress += f.trailsCut;
        break;
      case 'throws':
        m.progress += f.throws;
        break;
      case 'stars':
        m.progress += f.stars;
        break;
      case 'combo':
        m.progress += f.combos;
        break;
    }
    if (m.progress >= m.target) {
      m.progress = m.target;
      m.done = true;
      finished.push(m);
    }
  }
  return finished;
}

/** Coins for each day of the 7-day gift; day 7 is the Golden skin (or coins if you have it). */
export const GIFT_COINS = [20, 30, 40, 50, 60, 80, 150];

export function today(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
