/** Bubble skins: a hat, bubble tint, a pattern on the bubble and a trail effect. Win island N to unlock skin N. */

export type HatKind = 'none' | 'sprout' | 'beanie' | 'bee' | 'party' | 'pirate' | 'wizard' | 'flame' | 'astronaut' | 'ninja' | 'cat' | 'chef' | 'viking' | 'pumpkin' | 'tophat' | 'halo';
export type PatternKind = 'none' | 'stripes' | 'spots' | 'swirl' | 'checks' | 'zigzag' | 'sparkle' | 'bands';
export type TrailKind = 'none' | 'leaf' | 'snow' | 'honey' | 'heart' | 'bubble' | 'star' | 'flame' | 'rainbow';

export interface Skin {
  id: string;
  name: string;
  hat: HatKind;
  /** Tint mixed into the bubble (its team colour always shows so teams stay easy to tell apart). */
  body: string | null;
  /** Colour of the pattern painted on the bubble. */
  deck: string;
  tips: string;
  pattern: PatternKind;
  trail: TrailKind;
  /** Colours the trail particles pick from. */
  trailColors: string[];
  /** Islands you need to have won (event and gift skins can't be won on islands). */
  unlockAt: number;
  /** Only from the weekly event island or the 7-day gift. */
  special?: 'event' | 'gift';
}

export const SKINS: Skin[] = [
  { id: 'classic', name: 'Classic', hat: 'none', pattern: 'none', body: null, deck: '#2e3148', tips: '#ffffff', trail: 'none', trailColors: [], unlockAt: 0 },
  { id: 'sprout', name: 'Sprout', hat: 'sprout', pattern: 'spots', body: '#e9f8dc', deck: '#3f7d3a', tips: '#c8f0a8', trail: 'leaf', trailColors: ['#7cc576', '#a8e07c', '#4fae74'], unlockAt: 1 },
  { id: 'beanie', name: 'Snow Beanie', hat: 'beanie', pattern: 'stripes', body: '#e3f3ff', deck: '#5aa6e6', tips: '#ffffff', trail: 'snow', trailColors: ['#ffffff', '#dff1ff', '#bfe3ff'], unlockAt: 2 },
  { id: 'bee', name: 'Honey Bee', hat: 'bee', pattern: 'stripes', body: '#ffd84a', deck: '#3a2f22', tips: '#ffd84a', trail: 'honey', trailColors: ['#ffc21a', '#ffb000', '#ffe27a'], unlockAt: 3 },
  { id: 'party', name: 'Party Pop', hat: 'party', pattern: 'spots', body: '#ffd6e7', deck: '#ff7aa8', tips: '#fff3a8', trail: 'heart', trailColors: ['#ff7aa8', '#ff9ed2', '#ffd1e3'], unlockAt: 4 },
  { id: 'pirate', name: 'Pirate', hat: 'pirate', pattern: 'bands', body: '#f1dcb8', deck: '#7a4b2a', tips: '#e8c35a', trail: 'bubble', trailColors: ['#bff4ff', '#8fe3ff', '#ffffff'], unlockAt: 5 },
  { id: 'wizard', name: 'Wizard', hat: 'wizard', pattern: 'sparkle', body: '#e6dcff', deck: '#5b3fb0', tips: '#ffd43b', trail: 'star', trailColors: ['#ffd43b', '#fff3a8', '#c9b5ff'], unlockAt: 6 },
  { id: 'lava', name: 'Lava', hat: 'flame', pattern: 'swirl', body: '#4a3d45', deck: '#2a1f24', tips: '#ff7a2a', trail: 'flame', trailColors: ['#ff5a1f', '#ff9a2a', '#ffd23a'], unlockAt: 7 },
  { id: 'astro', name: 'Astronaut', hat: 'astronaut', pattern: 'swirl', body: '#f4f7fb', deck: '#dfe6f1', tips: '#5ab8ff', trail: 'rainbow', trailColors: ['#ff7b7b', '#ffd43b', '#4fd6a0', '#5ab8ff', '#a98bf0'], unlockAt: 8 },
  // World 2
  { id: 'ninja', name: 'Ninja', hat: 'ninja', pattern: 'zigzag', body: '#3a3550', deck: '#1f1c2b', tips: '#e8436f', trail: 'star', trailColors: ['#e8436f', '#ffffff'], unlockAt: 10 },
  { id: 'cat', name: 'Kitty', hat: 'cat', pattern: 'spots', body: '#ffe9d6', deck: '#f4ab88', tips: '#ffffff', trail: 'heart', trailColors: ['#ffb3c7', '#ffd6e0', '#ffffff'], unlockAt: 12 },
  { id: 'chef', name: 'Chef', hat: 'chef', pattern: 'checks', body: '#ffffff', deck: '#d94b4b', tips: '#ffffff', trail: 'bubble', trailColors: ['#ffffff', '#ffe9b0'], unlockAt: 14 },
  { id: 'viking', name: 'Viking', hat: 'viking', pattern: 'zigzag', body: '#e8c9a0', deck: '#6b4a2b', tips: '#cfd6df', trail: 'snow', trailColors: ['#ffffff', '#cfd6df'], unlockAt: 16 },
  // Specials
  { id: 'pumpkin', name: 'Pumpkin', hat: 'pumpkin', pattern: 'bands', body: '#3f2f48', deck: '#ff8a1f', tips: '#5bbf3f', trail: 'flame', trailColors: ['#ff8a1f', '#ffb347'], unlockAt: 999, special: 'event' },
  { id: 'snowman', name: 'Snowman', hat: 'tophat', pattern: 'spots', body: '#ffffff', deck: '#2e3148', tips: '#ff7a2a', trail: 'snow', trailColors: ['#ffffff', '#e3f3ff'], unlockAt: 999, special: 'event' },
  { id: 'golden', name: 'Golden', hat: 'halo', pattern: 'sparkle', body: '#ffe27a', deck: '#e8b400', tips: '#fff6c9', trail: 'star', trailColors: ['#ffd43b', '#fff3a8', '#ffffff'], unlockAt: 999, special: 'gift' },
];

/** The skin the weekly event island gives this week. */
export function eventSkinIndex(week: number): number {
  const events = SKINS.map((s, i) => (s.special === 'event' ? i : -1)).filter((i) => i >= 0);
  return events[week % events.length];
}

export const GIFT_SKIN = SKINS.findIndex((s) => s.special === 'gift');

export function getSkin(index: number): Skin {
  return SKINS[index] ?? SKINS[0];
}
