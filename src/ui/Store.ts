import type { StartMode } from '../config';

export interface Settings {
  music: boolean;
  sfx: boolean;
  hardMode: boolean;
  startMode: StartMode;
  controls: 'swipe' | 'dpad';
  quality: 'high' | 'low';
  slot: number;
  vibrate: boolean;
  seenHowTo: boolean;
  artVersion?: number;
  map: string;
}

export interface Stats {
  games: number;
  wins: number;
  bestLandPct: number;
  eggsCaptured: number;
  trailsCut: number;
  /** Recent results, oldest first, e.g. "WLW" (used by the match director). */
  recent: string;
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
    seenHowTo: false,
    map: 'classic',
  },
  stats: { games: 0, wins: 0, bestLandPct: 0, eggsCaptured: 0, trailsCut: 0, recent: '' },
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
