import { Card, Suit, Rank } from './types'

/**
 * Creates a standard 52-card deck in order (not shuffled)
 */
export function createDeck(): Card[] {
  const suits = Object.values(Suit)
  const ranks = Object.values(Rank)
  const deck: Card[] = []
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ suit, rank })
    }
  }
  return deck
}

/**
 * Fisher-Yates shuffle — returns a NEW shuffled array, does NOT mutate input
 */
export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

/**
 * Deals `count` cards from the top of the deck.
 * Returns dealt cards and the remaining deck.
 * Does NOT mutate the input deck.
 */
export function dealCards(
  deck: Card[],
  count: number
): { dealt: Card[]; remaining: Card[] } {
  if (count > deck.length) {
    throw new Error(`Cannot deal ${count} cards from deck of ${deck.length}`)
  }
  return {
    dealt: deck.slice(0, count),
    remaining: deck.slice(count),
  }
}
