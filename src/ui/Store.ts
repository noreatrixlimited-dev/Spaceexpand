import type { StartMode } from '../config';
import type { MissionDay } from './Missions';
import type { Streak, Weekly } from './Progress';

export interface Settings {
  music: boolean;
  sfx: boolean;
  hardMode: boolean;
  startMode: StartMode;
  controls: 'swipe' | 'dpad';
  quality: 'high' | 'low';
  slot: number;
  vibrate: boolean;
  /** Bubble sound volume 0..1. */
  volume: number;
  haptics: 'off' | 'light' | 'strong';
  seenHowTo: boolean;
  artVersion?: number;
  map: string;
  tutorialDone: boolean;
  /** Equipped robot skin (index into SKINS). */
  skin: number;
}

export interface Stats {
  games: number;
  wins: number;
  bestLandPct: number;
  eggsCaptured: number;
  trailsCut: number;
  /** Recent results, oldest first, e.g. "WLW" (used by the match director). */
  recent: string;
  /** How many island levels are open (win the last open one to open the next). */
  unlocked: number;
  /** Won the final island. */
  champion: boolean;
  coins: number;
  /** Best stars (0-3) per island id. */
  stars: Record<string, number>;
  /** Day (YYYY-MM-DD) of the last win, for the first-win-of-the-day bonus. */
  lastWinDay: string;
  /** Skins bought early with coins (or won from events and gifts). */
  owned: number[];
  missions: MissionDay | null;
  /** 7-day gift: last claim day and how many gifts claimed so far. */
  gift: { last: string; count: number };
  /** Weeks in which the event island was won. */
  eventWeeks: number[];
  streak: Streak;
  weekly: Weekly;
  /** Achievement ids already claimed. */
  achievements: string[];
}

const KEY = 'nestnappers.v1';
// Bumped when the art upgrade landed so everyone starts on the new high-quality look.
const ART_VERSION = 2;

const defaults = (): { settings: Settings; stats: Stats } => ({
  settings: {
    music: true,
    sfx: true,
    hardMode: false,
    startMode: 'patch',
    controls: 'swipe',
    quality: 'high',
    slot: 0,
    vibrate: true,
    volume: 0.8,
    haptics: 'light',
    seenHowTo: false,
    map: 'clover',
    tutorialDone: false,
    skin: 0,
  },
  stats: { games: 0, wins: 0, bestLandPct: 0, eggsCaptured: 0, trailsCut: 0, recent: '', unlocked: 1, champion: false, coins: 0, stars: {}, lastWinDay: '', owned: [], missions: null, gift: { last: '', count: 0 }, eventWeeks: [], streak: { last: '', count: 0, best: 0 }, weekly: { week: -1, islands: [], done: false }, achievements: [] },
});

/** Settings and lifetime stats, saved in localStorage (best effort). */
export class Store {
  settings: Settings;
  stats: Stats;

  constructor() {
    const d = defaults();
    this.settings = d.settings;
    this.stats = d.stats;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<{ settings: Settings; stats: Stats }>;
        this.settings = { ...d.settings, ...parsed.settings };
        // Older saves had on/off switches for sound and vibration.
        if (parsed.settings && parsed.settings.haptics === undefined) this.settings.haptics = parsed.settings.vibrate === false ? 'off' : 'light';
        if (parsed.settings && parsed.settings.volume === undefined) this.settings.volume = parsed.settings.sfx === false ? 0 : 0.8;
        if ((this.settings.artVersion ?? 1) < ART_VERSION) {
          this.settings.quality = 'high';
          this.settings.artVersion = ART_VERSION;
        }
        this.stats = { ...d.stats, ...parsed.stats };
      }
    } catch {
      // storage unavailable: keep defaults
    }
  }

  save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify({ settings: this.settings, stats: this.stats }));
    } catch {
      // ignore
    }
  }
}
