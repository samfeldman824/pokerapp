import { describe, expect, it } from 'vitest'

import { createDeck, dealCards, shuffleDeck } from './deck'
import { Rank, Suit } from './types'

function cardKey(card: { rank: Rank; suit: Suit }): string {
  return `${card.rank}-${card.suit}`
}

describe('deck', () => {
  it('createDeck() returns 52 unique cards (all suits x all ranks)', () => {
    const deck = createDeck()
    expect(deck).toHaveLength(52)

    const keys = deck.map(cardKey)
    expect(new Set(keys).size).toBe(52)

    for (const suit of Object.values(Suit)) {
      for (const rank of Object.values(Rank)) {
        expect(keys).toContain(`${rank}-${suit}`)
      }
    }
  })

  it('shuffleDeck() returns 52 cards and changes order from sorted (statistical)', () => {
    const deck = createDeck()
    const shuffled = shuffleDeck(deck)

    expect(shuffled).toHaveLength(52)
    expect(new Set(shuffled.map(cardKey)).size).toBe(52)
    expect(shuffled).not.toEqual(deck)
    expect(deck).toEqual(createDeck())
  })

  it('dealCards(deck, n) returns n dealt + (52-n) remaining, no duplicates', () => {
    const deck = createDeck()
    const { dealt, remaining } = dealCards(deck, 7)

    expect(dealt).toHaveLength(7)
    expect(remaining).toHaveLength(45)

    const dealtKeys = dealt.map(cardKey)
    const remainingKeys = remaining.map(cardKey)
    expect(new Set([...dealtKeys, ...remainingKeys]).size).toBe(52)
    expect(deck).toEqual(createDeck())
  })
})
