import { UNIT, WORLD } from './config';
import { Rng } from './core/rng';

export type MapShape = 'circle' | 'island';

export interface MapTheme {
  sky: [string, string]; // background top / bottom
  water: [string, string]; // sea around the island: shallow / deep
  neutral: string; // unclaimed land
  neutralPattern: string; // subtle pattern on unclaimed land
  slabTop: string; // island rim
  slabSide: string;
  slabDark: string;
  ui: string; // accent for menus
}

export interface MapDef {
  id: string;
  name: string;
  shape: MapShape;
  /** Half-extent in world units (how far the island reaches from the centre). */
  size: number;
  /** Outline in world units (x right, y down); only for generated islands. */
  pts: [number, number][];
  /** Where the island sits on the world map (map units). */
  wx: number;
  wy: number;
  /** A short line shown on the world map. */
  blurb: string;
  /** World (1 or 2) for island levels; 0 for the practice and event islands. */
  world: number;
  /** A boss island: one big, tough robot. */
  boss: boolean;
  theme: MapTheme;
}

const THEMES: Record<string, MapTheme> = {
  lagoon: {
    sky: ['#eef3fb', '#dfe8f5'],
    water: ['#7fdcf0', '#2f8fd8'],
    neutral: '#ffffff',
    neutralPattern: '#eef1f7',
    slabTop: '#f4f6fb',
    slabSide: '#c9d3e3',
    slabDark: '#aebbd0',
    ui: '#7c8db5',
  },
  meadow: {
    sky: ['#e9f7ef', '#d6efe0'],
    water: ['#8fe3d0', '#2fa79a'],
    neutral: '#fbfff8',
    neutralPattern: '#e6f4dd',
    slabTop: '#dcf2cf',
    slabSide: '#93c97d',
    slabDark: '#6fa95d',
    ui: '#4fae74',
  },
  frost: {
    sky: ['#eef6ff', '#d9e9fb'],
    water: ['#bfe8ff', '#5aa6e6'],
    neutral: '#ffffff',
    neutralPattern: '#e7f1fb',
    slabTop: '#f2f8ff',
    slabSide: '#b7d0ea',
    slabDark: '#93b2d4',
    ui: '#5a8fd0',
  },
  honey: {
    sky: ['#fff1c9', '#ffe39b'],
    water: ['#ffd76a', '#f2a52a'],
    neutral: '#fffaf0',
    neutralPattern: '#fff0cc',
    slabTop: '#ffe9a6',
    slabSide: '#f2b947',
    slabDark: '#d99a2b',
    ui: '#f0a020',
  },
  candy: {
    sky: ['#ffe1ec', '#ffd0e0'],
    water: ['#ffc2dc', '#f27aae'],
    neutral: '#fff6ea',
    neutralPattern: '#ffe9d6',
    slabTop: '#ffd9e6',
    slabSide: '#f5a3c0',
    slabDark: '#e488a8',
    ui: '#ff7aa8',
  },
  tropic: {
    sky: ['#e3fbf8', '#c9f1ec'],
    water: ['#7ff0dc', '#13a9b8'],
    neutral: '#fffdf4',
    neutralPattern: '#f6efd6',
    slabTop: '#fbf0cf',
    slabSide: '#e3c98a',
    slabDark: '#c9a964',
    ui: '#1fb5a8',
  },
  lavender: {
    sky: ['#f3eefe', '#e4dafb'],
    water: ['#cdb9fb', '#8a6be0'],
    neutral: '#fdfbff',
    neutralPattern: '#efe8fb',
    slabTop: '#ece3fd',
    slabSide: '#b9a3ea',
    slabDark: '#9a84d1',
    ui: '#8a6be0',
  },
  mint: {
    sky: ['#e8fbf5', '#cff3e7'],
    water: ['#9ff0d8', '#2fb39a'],
    neutral: '#fbfffd',
    neutralPattern: '#e2f6ee',
    slabTop: '#d9f5ea',
    slabSide: '#7fd1b4',
    slabDark: '#5db396',
    ui: '#2fae8c',
  },
  peach: {
    sky: ['#fff2ea', '#ffe0cf'],
    water: ['#ffc7a8', '#f28f6a'],
    neutral: '#fffaf6',
    neutralPattern: '#fdeadf',
    slabTop: '#ffe6d6',
    slabSide: '#f4ab88',
    slabDark: '#dc8d69',
    ui: '#ef8a5f',
  },
  sunset: {
    sky: ['#fff0e3', '#ffd9bd'],
    water: ['#ffb98f', '#f0715a'],
    neutral: '#fffaf3',
    neutralPattern: '#fde9d8',
    slabTop: '#ffe3cc',
    slabSide: '#f0a676',
    slabDark: '#d9865a',
    ui: '#f07a50',
  },
};

/**
 * The level order: a tour across a made-up ocean. Each island's outline is generated from
 * its seed (a wobbly blob), so every island has its own fixed, original shape.
 */
interface LevelSpec {
  id: string;
  name: string;
  theme: string;
  blurb: string;
  seed: number;
  stretch: number;
  wobble: number;
  wx: number;
  wy: number;
  world?: number;
  boss?: boolean;
}

const LEVELS: LevelSpec[] = [
  { id: 'clover', name: 'Clover Cove', theme: 'meadow', blurb: 'Green fields and gentle hills.', seed: 11, stretch: 1.0, wobble: 0.16, wx: -30, wy: 20 },
  { id: 'snowpuff', name: 'Snowpuff Isle', theme: 'frost', blurb: 'Ice, snow and very fast boards.', seed: 23, stretch: 1.25, wobble: 0.2, wx: -12, wy: 9 },
  { id: 'honeydrop', name: 'Honeydrop Island', theme: 'honey', blurb: 'Sticky, sunny and sweet.', seed: 37, stretch: 1.1, wobble: 0.24, wx: 8, wy: 16 },
  { id: 'sugarloop', name: 'Sugarloop Reef', theme: 'candy', blurb: 'Long and narrow: watch your back!', seed: 41, stretch: 1.65, wobble: 0.18, wx: 26, wy: 4 },
  { id: 'cocopop', name: 'Cocopop Key', theme: 'tropic', blurb: 'Palm trees and pirate bubbles.', seed: 59, stretch: 1.15, wobble: 0.27, wx: 14, wy: -12 },
  { id: 'lilac', name: 'Lilac Lagoon', theme: 'lavender', blurb: 'Purple flowers as far as you can see.', seed: 67, stretch: 1.35, wobble: 0.22, wx: -6, wy: -20 },
  { id: 'ember', name: 'Ember Atoll', theme: 'sunset', blurb: 'Hot sand and a big showdown.', seed: 73, stretch: 1.05, wobble: 0.3, wx: -26, wy: -10 },
  { id: 'starfall', name: 'Starfall Island', theme: 'lagoon', blurb: 'Boss island! Pop the big bubble!', seed: 97, stretch: 1.2, wobble: 0.26, wx: -40, wy: -26, boss: true },
  // World 2: across the northern sea.
  { id: 'pebble', name: 'Pebble Point', theme: 'mint', blurb: 'World 2 begins. The bubbles got smarter!', seed: 103, stretch: 1.1, wobble: 0.22, wx: -24, wy: -44, world: 2 },
  { id: 'peachy', name: 'Peachy Shores', theme: 'peach', blurb: 'Soft sand, sharp bubbles.', seed: 109, stretch: 1.3, wobble: 0.25, wx: -4, wy: -52, world: 2 },
  { id: 'bubblegum', name: 'Bubblegum Bay', theme: 'candy', blurb: 'Pop! A bay full of tricks.', seed: 113, stretch: 1.0, wobble: 0.3, wx: 16, wy: -46, world: 2 },
  { id: 'moonbeam', name: 'Moonbeam Isle', theme: 'lavender', blurb: 'Glows softly at night.', seed: 127, stretch: 1.45, wobble: 0.2, wx: 32, wy: -60, world: 2 },
  { id: 'coral', name: 'Coral Key', theme: 'tropic', blurb: 'Reefs, waves and sneaky raids.', seed: 131, stretch: 1.15, wobble: 0.28, wx: 14, wy: -74, world: 2 },
  { id: 'frostbite', name: 'Frostbite Isle', theme: 'frost', blurb: 'Slippery and fast!', seed: 137, stretch: 1.25, wobble: 0.24, wx: -8, wy: -82, world: 2 },
  { id: 'sunburst', name: 'Sunburst Atoll', theme: 'honey', blurb: 'Hot, bright and busy.', seed: 149, stretch: 1.1, wobble: 0.3, wx: -30, wy: -76, world: 2 },
  { id: 'crown', name: 'Crown Island', theme: 'sunset', blurb: 'The final boss. Claim the crown!', seed: 157, stretch: 1.2, wobble: 0.26, wx: -48, wy: -92, world: 2, boss: true },
];

/** Playable half-extent: every island fits in this, so it fits the board. */
const MAX_HALF = 19.5;
/** Islands are scaled to roughly this much land (a circle of radius 19.5 has ~1195). */
const TARGET_AREA = 1050;

function polyArea(pts: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** A smooth, wobbly blob outline: a few random waves around a (possibly stretched) circle. */
function blobOutline(seed: number, stretch: number, wobble: number, segments = 120): [number, number][] {
  const rng = new Rng(seed);
  const waves = [2, 3, 4, 5].map((k) => ({ k, amp: ((rng.next() * 0.6 + 0.4) * wobble) / (k * 0.6), ph: rng.next() * Math.PI * 2 }));
  const tilt = rng.next() * Math.PI;
  const pts: [number, number][] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    let r = 1;
    for (const w of waves) r += w.amp * Math.cos(w.k * a + w.ph);
    const x = Math.cos(a) * r * stretch;
    const y = Math.sin(a) * r;
    pts.push([x * Math.cos(tilt) - y * Math.sin(tilt), x * Math.sin(tilt) + y * Math.cos(tilt)]);
  }
  return pts;
}

function buildIsland(l: LevelSpec): MapDef {
  const raw = blobOutline(l.seed, l.stretch, l.wobble);
  const ext = Math.max(...raw.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y))));
  const scale = Math.min(Math.sqrt(TARGET_AREA / Math.abs(polyArea(raw))), MAX_HALF / ext);
  const pts = raw.map(([x, y]) => [x * scale, y * scale] as [number, number]);
  return { id: l.id, name: l.name, shape: 'island', size: ext * scale, pts, wx: l.wx, wy: l.wy, blurb: l.blurb, world: l.world ?? 1, boss: !!l.boss, theme: THEMES[l.theme] };
}

/** Week number (Monday-based, since a fixed date) used to rotate the weekly event island. */
export function weekNumber(now = Date.now()): number {
  return Math.floor((now - Date.UTC(2024, 0, 1)) / (7 * 24 * 3600 * 1000));
}

const EVENT_THEMES = ['candy', 'tropic', 'lavender', 'honey', 'mint', 'peach'];

/** The weekly event island: a new shape and colours every week, off the main route. */
export function eventMap(week = weekNumber()): MapDef {
  const m = buildIsland({
    id: 'event',
    name: 'Festival Isle',
    theme: EVENT_THEMES[week % EVENT_THEMES.length],
    blurb: 'Weekly event! Win to get this week\'s special skin.',
    seed: 1000 + week * 7,
    stretch: 1 + (week % 4) * 0.12,
    wobble: 0.2 + (week % 3) * 0.04,
    wx: -50,
    wy: 34,
  });
  m.world = 0;
  return m;
}

/** The island levels, in unlock order. */
export const LEVEL_MAPS: MapDef[] = LEVELS.map(buildIsland);

/** A plain round practice island (used for the first guided ride and tests). */
export const PRACTICE_MAP: MapDef = {
  id: 'classic',
  name: 'Practice Lagoon',
  shape: 'circle',
  size: 19.5,
  pts: [],
  wx: 0,
  wy: 0,
  blurb: '',
  world: 0,
  boss: false,
  theme: THEMES.lagoon,
};

export const MAPS: MapDef[] = [...LEVEL_MAPS, PRACTICE_MAP];

export function getMap(id: string | undefined): MapDef {
  if (id === 'event') return eventMap();
  return MAPS.find((m) => m.id === id) ?? LEVEL_MAPS[0];
}

/** Signed distance from a point to a polygon outline (positive inside). */
function polygonInset(pts: [number, number][], x: number, y: number): number {
  let best = Infinity;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[j];
    const [bx, by] = pts[i];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(x - ax - dx * t, y - ay - dy * t);
    if (d < best) best = d;
    if (ay > y !== by > y && x < (dx * (y - ay)) / dy + ax) inside = !inside;
  }
  return inside ? best : -best;
}

/**
 * Signed distance (in world units) from a point to the map's edge, positive inside.
 * (x, y) are world units relative to the board centre.
 */
export function mapInset(map: MapDef, x: number, y: number): number {
  if (map.shape === 'circle') return map.size - Math.hypot(x, y);
  return polygonInset(map.pts, x, y);
}

/** Inset in grid cells for a cell centre, used by the rules grid. */
export function cellInset(map: MapDef, size: number): (x: number, y: number) => number {
  const half = size / 2;
  return (x, y) => mapInset(map, (x + 0.5 - half) / UNIT, (y + 0.5 - half) / UNIT) * UNIT;
}

/** Outline of the map as points in world units (for building the island slab), pushed out by `grow`. */
export function mapOutline(map: MapDef, grow = 0, segments = 96): [number, number][] {
  if (map.shape === 'circle') {
    const pts: [number, number][] = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pts.push([Math.cos(a) * (map.size + grow), Math.sin(a) * (map.size + grow)]);
    }
    return pts;
  }
  // Offset each vertex along its averaged normal (the outlines are smooth, so this stays clean).
  const p = map.pts;
  const n = p.length;
  const sign = polyArea(p) > 0 ? 1 : -1;
  return p.map(([x, y], i) => {
    const [px, py] = p[(i - 1 + n) % n];
    const [nx, ny] = p[(i + 1) % n];
    let e1x = x - px;
    let e1y = y - py;
    let e2x = nx - x;
    let e2y = ny - y;
    const l1 = Math.hypot(e1x, e1y) || 1;
    const l2 = Math.hypot(e2x, e2y) || 1;
    e1x /= l1;
    e1y /= l1;
    e2x /= l2;
    e2y /= l2;
    // outward normal of a counter-clockwise (in x-right, y-down space: positive area) ring
    let ox = (e1y + e2y) * sign;
    let oy = -(e1x + e2x) * sign;
    const ol = Math.hypot(ox, oy) || 1;
    ox /= ol;
    oy /= ol;
    const cos = Math.max(0.5, ox * e1y * sign - oy * e1x * sign);
    return [x + (ox * grow) / cos, y + (oy * grow) / cos] as [number, number];
  });
}

/**
 * Nest positions (world units from centre): four spots `depth` inside the coast, spread
 * as far apart as the island allows.
 */
export function nestSpots(map: MapDef, depth: number): [number, number][] {
  if (map.shape === 'circle') {
    const dirs: [number, number][] = [
      [-1, -1],
      [-1, 1],
      [1, 1],
      [1, -1],
    ];
    const r = map.size - depth;
    return dirs.map(([dx, dy]) => [dx * Math.SQRT1_2 * r, dy * Math.SQRT1_2 * r]);
  }
  // Candidate spots on a fine lattice that sit at least `depth` inside the coast.
  const cands: [number, number][] = [];
  const step = 0.5;
  for (let y = -map.size; y <= map.size; y += step)
    for (let x = -map.size; x <= map.size; x += step) if (mapInset(map, x, y) >= depth) cands.push([x, y]);
  if (cands.length < 4) throw new Error(`${map.id} is too small for nests`);
  // Farthest-point picking: start from the spot farthest from the middle, then keep adding
  // whichever spot is farthest from all picked ones.
  let cx = 0;
  let cy = 0;
  for (const [x, y] of cands) {
    cx += x;
    cy += y;
  }
  cx /= cands.length;
  cy /= cands.length;
  const picks: [number, number][] = [];
  let first = cands[0];
  for (const c of cands) if (Math.hypot(c[0] - cx, c[1] - cy) > Math.hypot(first[0] - cx, first[1] - cy)) first = c;
  picks.push(first);
  while (picks.length < 4) {
    let best = cands[0];
    let bestD = -1;
    for (const c of cands) {
      let d = Infinity;
      for (const p of picks) d = Math.min(d, Math.hypot(c[0] - p[0], c[1] - p[1]));
      if (d > bestD) {
        bestD = d;
        best = c;
      }
    }
    picks.push(best);
  }
  // Order around the middle so neighbouring slots are neighbouring nests.
  return picks.sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
}

export { WORLD };
