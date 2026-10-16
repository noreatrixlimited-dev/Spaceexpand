/** What a match was worth and how to talk about it: coins, stars, a near-miss line and a tip. */

export interface MatchSummary {
  won: boolean;
  /** 1-based finishing place. */
  rank: number;
  /** Peak land share in percent. */
  peakPct: number;
  /** Final land share in percent, and the best rival's. */
  finalPct: number;
  rivalPct: number;
  rivalName: string;
  /** Your nest was captured. */
  captured: boolean;
  /** How many robots were knocked out before the match ended (or before you were). */
  outlasted: number;
  heartsLost: number;
  bonked: number;
  eggStolen: boolean;
  throws: number;
  eggsTaken: number;
  trailsCut: number;
  firstWinToday: boolean;
}

export interface Reward {
  coins: number;
  /** Lines explaining the coins, e.g. ["Win +40", "Land +18"]. */
  breakdown: string[];
  stars: number;
  title: string;
  note: string;
  tip: string;
}

export function rewardFor(m: MatchSummary): Reward {
  const breakdown: string[] = [];
  let coins = 10;
  breakdown.push('Played +10');
  const land = Math.round(m.peakPct * 0.6);
  if (land > 0) {
    coins += land;
    breakdown.push(`Land +${land}`);
  }
  if (m.eggsTaken) {
    coins += m.eggsTaken * 15;
    breakdown.push(`Eggs +${m.eggsTaken * 15}`);
  }
  if (m.trailsCut) {
    coins += m.trailsCut * 5;
    breakdown.push(`Bonks +${m.trailsCut * 5}`);
  }
  if (m.won) {
    coins += 40;
    breakdown.push('Win +40');
    if (m.firstWinToday) {
      coins += 50;
      breakdown.push('First win today +50');
    }
  }

  const stars = m.won ? 1 + (m.peakPct >= 35 ? 1 : 0) + (m.heartsLost === 0 ? 1 : 0) : 0;

  let title: string;
  let note: string;
  if (m.won) {
    title = stars === 3 ? 'Perfect!' : 'You win!';
    note = stars < 3 ? (m.peakPct < 35 ? 'Grab 35% land for another star' : 'Win without losing an egg heart for 3 stars') : 'Three stars!';
  } else if (m.captured && m.rank === 2) {
    title = 'Final duel!';
    note = `You outlasted ${m.outlasted} bubble${m.outlasted === 1 ? '' : 's'}, so close!`;
  } else if (!m.captured && m.rank === 2 && m.rivalPct - m.finalPct < 10) {
    title = 'So close!';
    note = `Only ${Math.max(0.1, m.rivalPct - m.finalPct).toFixed(1)}% behind 1st place`;
  } else if (m.rank <= 2) {
    title = 'Nearly!';
    note = '2nd place, just behind the winner';
  } else {
    title = 'Nice try!';
    note = m.outlasted > 0 ? `You outlasted ${m.outlasted} bubble${m.outlasted === 1 ? '' : 's'}` : `You grabbed ${m.peakPct.toFixed(0)}% of the island`;
  }

  return { coins, breakdown, stars, title, note, tip: m.won ? '' : tipFor(m) };
}

/** One short, useful tip based on how the match was lost. */
export function tipFor(m: MatchSummary): string {
  if (m.eggStolen) return 'Tip: chase the thief and bump them to send your egg home.';
  if (m.captured && m.heartsLost >= 3) return 'Tip: stay near your nest when bubbles come close; bump them away.';
  if (m.bonked >= 2) return 'Tip: keep loops short when bubbles are nearby.';
  if (m.throws < 5) return 'Tip: throw paint balls! Splats paint land and stun bubbles.';
  if (m.peakPct < 15) return 'Tip: make big loops early while the others are far away.';
  return 'Tip: grab the star in the middle for a power-up.';
}

/** Price of buying a skin early with coins. */
export function skinPrice(index: number): number {
  return 150 + index * 50;
}
