/**
 * Hand evaluation using the `pokersolver` library.
 *
 * `pokersolver` uses its own card string format: `{rank}{suit_initial}`
 * (e.g., "As" = Ace of spades, "Th" = Ten of hearts, "2c" = Two of clubs).
 * Our internal `Card` type uses longer suit strings ("spades", "clubs", etc.)
 * and the rank characters defined in the `Rank` enum.
 *
 * This module handles the translation between the two formats and maps
 * `pokersolver`'s text-based hand names to our `HandRank` numeric enum.
 */

import { Hand } from 'pokersolver'
import { Card, HandEvaluation, HandRank, ComparisonResult, Suit, Rank } from './types'

/**
 * Maps our internal Suit enum values to pokersolver's single-character suit codes.
 * pokersolver expects: 'c' (clubs), 'd' (diamonds), 'h' (hearts), 's' (spades).
 */
const SUIT_MAP: Record<Suit, string> = {
  [Suit.Clubs]: 'c',
  [Suit.Diamonds]: 'd',
  [Suit.Hearts]: 'h',
  [Suit.Spades]: 's',
}

/** Converts a `Card` to the pokersolver string format (e.g., { rank: 'A', suit: 'spades' } → "As"). */
function cardToPokerSolver(card: Card): string {
  return `${card.rank}${SUIT_MAP[card.suit]}`
}

/**
 * Maps a pokersolver hand name + description to our `HandRank` enum.
 *
 * pokersolver returns hand strength as human-readable strings (e.g., "Flush", "Two Pair"),
 * not as numeric ranks. We normalise by converting to lowercase and matching substrings.
 * "Royal Flush" is checked before "Straight Flush" to avoid a false partial match.
 */
function descriptionToHandRank(name: string, descr?: string): HandRank {
  const lower = `${name} ${descr ?? ''}`.toLowerCase()
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
 * Evaluates the best 5-card hand from hole cards + community cards (2–7 total).
 *
 * Use this when you only need the evaluation result (e.g., for display).
 * Use `evaluateHandWithRaw` when you also need to compare multiple hands via
 * `pokersolver.Hand.winners()`.
 */
export function evaluateHand(
  holeCards: [Card, Card],
  communityCards: Card[]
): HandEvaluation {
  const allCards = [...holeCards, ...communityCards].map(cardToPokerSolver)
  const solved = Hand.solve(allCards)

  return {
    rank: descriptionToHandRank(solved.name, solved.descr),
    description: solved.descr,
    cards: solved.cards.map((c: any) => {
      const rankChar = c.value as Rank
      const suitChar = Object.entries(SUIT_MAP).find(([, v]) => v === c.suit)?.[0] as Suit
      return { rank: rankChar, suit: suitChar }
    }),
  }
}

/**
 * Evaluates and returns both the `HandEvaluation` and the raw `pokersolver` Hand object.
 *
 * The raw Hand is needed for `Hand.winners()` comparisons in `potCalculator.ts`.
 * Returning it here avoids solving the same hand twice (once for display, once for comparison).
 *
 * Note: `rawHand` is typed as `any` because `pokersolver` has no published TypeScript types;
 * see `src/engine/pokersolver.d.ts` for the minimal declaration file.
 */
export function evaluateHandWithRaw(
  holeCards: [Card, Card],
  communityCards: Card[]
): { evaluation: HandEvaluation; rawHand: any } {
  const allCards = [...holeCards, ...communityCards].map(cardToPokerSolver)
  const solved = Hand.solve(allCards)

  const evaluation: HandEvaluation = {
    rank: descriptionToHandRank(solved.name, solved.descr),
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
 * Compares multiple hands and returns winners and losers.
 * Handles ties (split pots) by including all winning hands in the `winners` array.
 *
 * Used when you already have pre-evaluated raw hands (avoids re-solving).
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
