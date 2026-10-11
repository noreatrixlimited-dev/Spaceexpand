// Every tunable number in one place.
export const CONFIG = {
  gridSize: 40,
  tickRate: 30,
  matchSeconds: 180,

  baseSpeed: 6, // cells per second
  shadeSpeedMul: 1.25,
  carrySpeedMul: 0.7,
  boostSpeedMul: 1.5,

  patchSize: 6,
  coreInset: 2, // core distance from the board corner

  coreHearts: 3,
  coreHitInvuln: 3,
  heartRegenSeconds: 30,
  bonkSeconds: 1.5,
  freePatchRadius: 1, // 3x3 patch when a ghost breaks free

  voidStart: 60,
  voidInterval: 12,
  voidMaxRings: 11,

  starFirst: 25,
  starInterval: 25,
  powerSeconds: { speed: 5, shield: 8, freeze: 10 },
} as const;

export type StartMode = 'patch' | 'quadrant';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface MatchOptions {
  startMode: StartMode;
  hardMode: boolean; // crossing your own trail bonks you
  humanSlot: number | null; // null = attract mode, all bots
  difficulty: Difficulty;
  seed: number;
}

export const PLAYER_NAMES = ['Lavender', 'Coral', 'Sky', 'Mint'];
// P1 top-left, P2 bottom-left, P3 bottom-right, P4 top-right (matches the original sketch)
export const PLAYER_COLORS = ['#a98bf0', '#ff7b7b', '#5ab8ff', '#4fd6a0'];
export const PLAYER_COLORS_SOFT = ['#d6c7fa', '#ffc0bb', '#b4dcff', '#aeeccf'];
