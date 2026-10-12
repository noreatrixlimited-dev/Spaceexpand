// Every tunable number in one place.
export const CONFIG = {
  gridSize: 40,
  tickRate: 30,
  matchSeconds: 180,

  cornerRadius: 7, // rounded corners of the island, in cells
  baseSpeed: 6, // cells per second
  turnRate: 11, // radians per second when steering toward the stick direction
  shadeSpeedMul: 1.25,
  carrySpeedMul: 0.7,
  boostSpeedMul: 1.5,

  patchSize: 6,
  coreInset: 4, // nest distance from the board corner (inside the rounded corner)

  coreHearts: 3,
  coreHitInvuln: 3,
  heartRegenSeconds: 30,
  bonkSeconds: 1.5,
  freePatchRadius: 1, // 3x3 patch when a ghost breaks free

  voidStart: 60,
  voidInterval: 12,
  voidMaxRings: 11,

  // Balls: more land = more balls and a bigger pouch.
  ballStart: 2,
  ballCapBase: 3,
  ballCapMax: 12,
  ballCapLandPer: 35, // +1 pouch slot per this many owned cells
  ballRateBase: 0.18, // balls per second with no land
  ballRatePerCell: 0.0012, // extra balls per second per owned cell
  ballCatchUp: 1.6, // rate multiplier for the player with the least land
  throwRange: 7,
  throwTime: 0.75, // flight time in seconds
  throwCooldown: 0.4,
  splatRadius: 1.6,
  hitRadius: 1.3,
  stunSeconds: 1,
  knockback: 1.6,
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
