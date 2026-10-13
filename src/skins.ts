/** Robot skins: a hat, body colour, board and a trail effect. Win island N to unlock skin N. */

export type HatKind = 'none' | 'sprout' | 'beanie' | 'bee' | 'party' | 'pirate' | 'wizard' | 'flame' | 'astronaut';
export type TrailKind = 'none' | 'leaf' | 'snow' | 'honey' | 'heart' | 'bubble' | 'star' | 'flame' | 'rainbow';

export interface Skin {
  id: string;
  name: string;
  hat: HatKind;
  /** Body colour (the limbs keep the team colour so teams stay easy to tell apart). */
  body: string | null;
  deck: string;
  tips: string;
  trail: TrailKind;
  /** Colours the trail particles pick from. */
  trailColors: string[];
  /** Islands you need to have won. */
  unlockAt: number;
}

export const SKINS: Skin[] = [
  { id: 'classic', name: 'Classic', hat: 'none', body: null, deck: '#2e3148', tips: '#ffffff', trail: 'none', trailColors: [], unlockAt: 0 },
  { id: 'sprout', name: 'Sprout', hat: 'sprout', body: '#e9f8dc', deck: '#3f7d3a', tips: '#c8f0a8', trail: 'leaf', trailColors: ['#7cc576', '#a8e07c', '#4fae74'], unlockAt: 1 },
  { id: 'beanie', name: 'Snow Beanie', hat: 'beanie', body: '#e3f3ff', deck: '#5aa6e6', tips: '#ffffff', trail: 'snow', trailColors: ['#ffffff', '#dff1ff', '#bfe3ff'], unlockAt: 2 },
  { id: 'bee', name: 'Honey Bee', hat: 'bee', body: '#ffd84a', deck: '#3a2f22', tips: '#ffd84a', trail: 'honey', trailColors: ['#ffc21a', '#ffb000', '#ffe27a'], unlockAt: 3 },
  { id: 'party', name: 'Party Pop', hat: 'party', body: '#ffd6e7', deck: '#ff7aa8', tips: '#fff3a8', trail: 'heart', trailColors: ['#ff7aa8', '#ff9ed2', '#ffd1e3'], unlockAt: 4 },
  { id: 'pirate', name: 'Pirate', hat: 'pirate', body: '#f1dcb8', deck: '#7a4b2a', tips: '#e8c35a', trail: 'bubble', trailColors: ['#bff4ff', '#8fe3ff', '#ffffff'], unlockAt: 5 },
  { id: 'wizard', name: 'Wizard', hat: 'wizard', body: '#e6dcff', deck: '#5b3fb0', tips: '#ffd43b', trail: 'star', trailColors: ['#ffd43b', '#fff3a8', '#c9b5ff'], unlockAt: 6 },
  { id: 'lava', name: 'Lava', hat: 'flame', body: '#4a3d45', deck: '#2a1f24', tips: '#ff7a2a', trail: 'flame', trailColors: ['#ff5a1f', '#ff9a2a', '#ffd23a'], unlockAt: 7 },
  { id: 'astro', name: 'Astronaut', hat: 'astronaut', body: '#f4f7fb', deck: '#dfe6f1', tips: '#5ab8ff', trail: 'rainbow', trailColors: ['#ff7b7b', '#ffd43b', '#4fd6a0', '#5ab8ff', '#a98bf0'], unlockAt: 8 },
];

export function getSkin(index: number): Skin {
  return SKINS[index] ?? SKINS[0];
}
