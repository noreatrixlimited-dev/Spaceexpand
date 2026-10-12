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

export const PLAYER_NAMES = ['Grape', 'Cherry', 'Berry', 'Lime'];
// P1 top-left, P2 bottom-left, P3 bottom-right, P4 top-right (matches the original sketch)
export const PLAYER_COLORS = ['#9b5de5', '#f25454', '#3d9df2', '#5bbf3f'];
export const PLAYER_COLORS_SOFT = ['#c9a8f5', '#ffa3a3', '#9fd0ff', '#a7e38f'];
/** Territory tile colours per player (checker pair), and unclaimed land. */
export const TILE_COLORS: [string, string][] = [
  ['#a46af2', '#985de8'],
  ['#f66262', '#ec5555'],
  ['#55aef6', '#479fee'],
  ['#86d052', '#79c646'],
];
export const NEUTRAL_TILE: [string, string] = ['#ffe45e', '#fdd94a'];
