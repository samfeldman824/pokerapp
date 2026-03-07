import { Hand } from 'pokersolver'
import { Card, HandEvaluation, HandRank, ComparisonResult, Suit, Rank } from './types'

// pokersolver card format: rank + suit initial (e.g., "As" = Ace of spades, "Th" = Ten of hearts)
// Our Rank enum: '2','3','4','5','6','7','8','9','T','J','Q','K','A'
// Our Suit enum: 'clubs','diamonds','hearts','spades'

const SUIT_MAP: Record<Suit, string> = {
  [Suit.Clubs]: 'c',
  [Suit.Diamonds]: 'd',
  [Suit.Hearts]: 'h',
  [Suit.Spades]: 's',
}

function cardToPokerSolver(card: Card): string {
  return `${card.rank}${SUIT_MAP[card.suit]}`
}

// Map pokersolver hand names to our HandRank enum
function descriptionToHandRank(name: string): HandRank {
  const lower = name.toLowerCase()
  if (lower.includes('royal flush')) return HandRank.RoyalFlush
  if (lower.includes('straight flush')) return HandRank.StraightFlush
  if (lower.includes('four of a kind')) return HandRank.FourOfAKind
  if (lower.includes('full house')) return HandRank.FullHouse
  if (lower.includes('flush')) return HandRank.Flush
  if (lower.includes('straight')) return HandRank.Straight
  if (lower.includes('three of a kind')) return HandRank.ThreeOfAKind
  if (lower.includes('two pair')) return HandRank.TwoPair
  if (lower.includes('pair')) return HandRank.OnePair
  return HandRank.HighCard
}

/**
 * Evaluates the best 5-card hand from hole cards + community cards (up to 7 total)
 */
export function evaluateHand(
  holeCards: [Card, Card],
  communityCards: Card[]
): HandEvaluation {
  const allCards = [...holeCards, ...communityCards].map(cardToPokerSolver)
  const solved = Hand.solve(allCards)

  return {
    rank: descriptionToHandRank(solved.name),
    description: solved.descr,
    cards: solved.cards.map((c: any) => {
      const rankChar = c.value as Rank
      const suitChar = Object.entries(SUIT_MAP).find(([, v]) => v === c.suit)?.[0] as Suit
      return { rank: rankChar, suit: suitChar }
    }),
  }
}

/**
 * Evaluates and returns both the HandEvaluation and the raw pokersolver hand
 * (raw hand needed for compareHands)
 */
export function evaluateHandWithRaw(
  holeCards: [Card, Card],
  communityCards: Card[]
): { evaluation: HandEvaluation; rawHand: any } {
  const allCards = [...holeCards, ...communityCards].map(cardToPokerSolver)
  const solved = Hand.solve(allCards)

  const evaluation: HandEvaluation = {
    rank: descriptionToHandRank(solved.name),
    description: solved.descr,
    cards: solved.cards.map((c: any) => {
      const rankChar = c.value as Rank
      const suitChar = Object.entries(SUIT_MAP).find(([, v]) => v === c.suit)?.[0] as Suit
      return { rank: rankChar, suit: suitChar }
    }),
  }

  return { evaluation, rawHand: solved }
}

/**
 * Compares multiple hands and returns winners (handles ties/split pots)
 */
export function compareHands(
  hands: Array<{ playerId: string; evaluation: HandEvaluation; rawHand: any }>
): ComparisonResult {
  const rawHands = hands.map(h => h.rawHand)
  const winningHands = Hand.winners(rawHands)

  const winnerRaws = new Set(winningHands)

  return {
    winners: hands
      .filter((_, i) => winnerRaws.has(rawHands[i]))
      .map(h => ({ playerId: h.playerId, evaluation: h.evaluation })),
    losers: hands
      .filter((_, i) => !winnerRaws.has(rawHands[i]))
      .map(h => ({ playerId: h.playerId, evaluation: h.evaluation })),
  }
}
