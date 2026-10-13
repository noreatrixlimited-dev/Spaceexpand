// Every tunable number in one place.
// The rules run on a fine invisible grid: UNIT cells make one world unit
// (one unit is about a character's width). Distances below are in cells.
export const UNIT = 3;
export const WORLD = 40; // world units across the board

export const CONFIG = {
  gridSize: WORLD * UNIT,
  tickRate: 60,
  matchSeconds: 180,

  baseSpeed: 6 * UNIT, // cells per second
  turnRate: 8, // radians per second when carving toward the stick direction
  glideRamp: 0.35, // seconds to reach full board speed from a stop
  carveSlow: 0.15, // speed lost in the hardest turn
  shadeSpeedMul: 1.25,
  carrySpeedMul: 0.7,
  boostSpeedMul: 1.5,

  startRadius: 3.3 * UNIT, // round starting patch around the nest
  nestDepth: 4.5 * UNIT, // how far inside the edge nests sit
  nestReach: 1.5 * UNIT, // touching distance for nests
  bumpDistance: 0.9 * UNIT, // touching distance between players
  pickupReach: 1 * UNIT,

  coreHearts: 3,
  coreHitInvuln: 3,
  heartRegenSeconds: 30,
  bonkSeconds: 1.5,
  freePatchRadius: 1.2 * UNIT,
  threatDistance: 5 * UNIT,

  voidStart: 60,
  voidInterval: 12,
  voidMaxRings: 11, // each ring is one unit deep

  // Balls: more land = more balls and a bigger pouch.
  ballStart: 2,
  ballCapBase: 3,
  ballCapMax: 12,
  ballCapLandPer: 35 * UNIT * UNIT, // +1 pouch slot per this many owned cells
  ballRateBase: 0.18, // balls per second with no land
  ballRatePerCell: 0.0012 / (UNIT * UNIT), // extra balls per second per owned cell
  ballCatchUp: 1.6, // rate multiplier for the player with the least land
  throwRange: 7 * UNIT,
  throwTime: 0.75, // flight time in seconds
  throwCooldown: 0.4,
  splatRadius: 1.6 * UNIT,
  hitRadius: 1.3 * UNIT,
  stunSeconds: 1,
  knockback: 1.6 * UNIT,
  autoAimCone: 0.55, // radians either side of facing
  pickupInterval: 7,
  pickupMax: 5,
  pickupBalls: 2,

  starFirst: 25,
  starInterval: 25,
  powerSeconds: { speed: 5, shield: 8, freeze: 10 },
} as const;

export type StartMode = 'patch' | 'quadrant';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface MatchOptions {
  map?: string; // map id (see maps.ts); defaults to the classic circle
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
