import { UNIT, WORLD } from './config';

export type MapShape = 'circle' | 'roundSquare' | 'hexagon';

export interface MapTheme {
  sky: [string, string]; // background top / bottom
  ground: string; // the floor far below the island
  groundDots: string;
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
  /** Size in world units: radius for circle/hexagon, half-width for the square. */
  size: number;
  corner: number; // corner radius in units (rounded square)
  theme: MapTheme;
}

export const MAPS: MapDef[] = [
  {
    id: 'classic',
    name: 'Classic',
    shape: 'circle',
    size: 19.5,
    corner: 0,
    theme: {
      sky: ['#eef3fb', '#dfe8f5'],
      ground: '#dfe7f2',
      groundDots: '#d2dcea',
      neutral: '#ffffff',
      neutralPattern: '#eef1f7',
      slabTop: '#f4f6fb',
      slabSide: '#c9d3e3',
      slabDark: '#aebbd0',
      ui: '#7c8db5',
    },
  },
  {
    id: 'candy',
    name: 'Candy',
    shape: 'roundSquare',
    size: 19.5,
    corner: 6,
    theme: {
      sky: ['#ffe1ec', '#ffd0e0'],
      ground: '#ffd6e5',
      groundDots: '#ffc4d9',
      neutral: '#fff6ea',
      neutralPattern: '#ffe9d6',
      slabTop: '#ffd9e6',
      slabSide: '#f5a3c0',
      slabDark: '#e488a8',
      ui: '#ff7aa8',
    },
  },
  {
    id: 'honeycomb',
    name: 'Honeycomb',
    shape: 'hexagon',
    size: 20,
    corner: 0,
    theme: {
      sky: ['#fff1c9', '#ffe39b'],
      ground: '#ffe7a8',
      groundDots: '#ffdb86',
      neutral: '#fffaf0',
      neutralPattern: '#fff0cc',
      slabTop: '#ffe9a6',
      slabSide: '#f2b947',
      slabDark: '#d99a2b',
      ui: '#f0a020',
    },
  },
];

export function getMap(id: string | undefined): MapDef {
  return MAPS.find((m) => m.id === id) ?? MAPS[0];
}

/**
 * Signed distance (in world units) from a point to the map's edge, positive inside.
 * (x, y) are world units relative to the board centre.
 */
export function mapInset(map: MapDef, x: number, y: number): number {
  const s = map.size;
  switch (map.shape) {
    case 'circle':
      return s - Math.hypot(x, y);
    case 'roundSquare': {
      const r = map.corner;
      const qx = Math.abs(x) - (s - r);
      const qy = Math.abs(y) - (s - r);
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
      const inside = Math.min(Math.max(qx, qy), 0);
      return r - outside - inside;
    }
    case 'hexagon': {
      // Flat-topped hexagon with circumradius s.
      const ax = Math.abs(x);
      const ay = Math.abs(y);
      const apothem = s * Math.cos(Math.PI / 6);
      const d = Math.max(ay, ax * Math.cos(Math.PI / 6) + ay * Math.sin(Math.PI / 6));
      return apothem - d;
    }
  }
}

/** Inset in grid cells for a cell centre, used by the rules grid. */
export function cellInset(map: MapDef, size: number): (x: number, y: number) => number {
  const half = size / 2;
  return (x, y) => mapInset(map, (x + 0.5 - half) / UNIT, (y + 0.5 - half) / UNIT) * UNIT;
}

/** Outline of the map as points in world units (for building the island slab). */
export function mapOutline(map: MapDef, grow = 0, segments = 96): [number, number][] {
  const pts: [number, number][] = [];
  if (map.shape === 'circle') {
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pts.push([Math.cos(a) * (map.size + grow), Math.sin(a) * (map.size + grow)]);
    }
  } else if (map.shape === 'hexagon') {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const r = map.size + grow / Math.cos(Math.PI / 6);
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
  } else {
    const s = map.size + grow;
    const r = map.corner + grow;
    const quarter = Math.max(2, Math.floor(segments / 8));
    const corners: [number, number, number][] = [
      [s - r, s - r, 0],
      [-(s - r), s - r, Math.PI / 2],
      [-(s - r), -(s - r), Math.PI],
      [s - r, -(s - r), (3 * Math.PI) / 2],
    ];
    for (const [cx, cy, a0] of corners) {
      for (let k = 0; k <= quarter; k++) {
        const a = a0 + (k / quarter) * (Math.PI / 2);
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
    }
  }
  return pts;
}

/** Nest positions (world units from centre): four, evenly spaced on the diagonals. */
export function nestSpots(map: MapDef, depth: number): [number, number][] {
  // Order matches the original sketch: top-left, bottom-left, bottom-right, top-right.
  const dirs: [number, number][] = [
    [-1, -1],
    [-1, 1],
    [1, 1],
    [1, -1],
  ];
  return dirs.map(([dx, dy]) => {
    const n = Math.SQRT1_2;
    let r = 0;
    // walk outward along the diagonal until we're `depth` from the edge
    while (mapInset(map, dx * n * (r + 0.25), dy * n * (r + 0.25)) > depth) r += 0.25;
    return [dx * n * r, dy * n * r];
  });
}

export { WORLD };
