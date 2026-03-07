import { describe, expect, it } from 'vitest'

import { compareHands, evaluateHand, evaluateHandWithRaw } from './handEvaluator'
import { Card, HandRank, Rank, Suit } from './types'

function c(rank: Rank, suit: Suit): Card {
  return { rank, suit }
}

describe('handEvaluator', () => {
  it('evaluateHand() identifies all hand ranks', () => {
    const cases: Array<{ name: string; hole: [Card, Card]; board: Card[]; rank: HandRank }> = [
      {
        name: 'royal flush',
        hole: [c(Rank.Ace, Suit.Spades), c(Rank.Two, Suit.Diamonds)],
        board: [
          c(Rank.Ten, Suit.Spades),
          c(Rank.Jack, Suit.Spades),
          c(Rank.Queen, Suit.Spades),
          c(Rank.King, Suit.Spades),
          c(Rank.Three, Suit.Clubs),
        ],
        rank: HandRank.RoyalFlush,
      },
      {
        name: 'straight flush',
        hole: [c(Rank.Nine, Suit.Hearts), c(Rank.King, Suit.Diamonds)],
        board: [
          c(Rank.Five, Suit.Hearts),
          c(Rank.Six, Suit.Hearts),
          c(Rank.Seven, Suit.Hearts),
          c(Rank.Eight, Suit.Hearts),
          c(Rank.Two, Suit.Clubs),
        ],
        rank: HandRank.StraightFlush,
      },
      {
        name: 'four of a kind',
        hole: [c(Rank.Ace, Suit.Spades), c(Rank.King, Suit.Clubs)],
        board: [
          c(Rank.Ace, Suit.Clubs),
          c(Rank.Ace, Suit.Diamonds),
          c(Rank.Ace, Suit.Hearts),
          c(Rank.Two, Suit.Spades),
          c(Rank.Three, Suit.Diamonds),
        ],
        rank: HandRank.FourOfAKind,
      },
      {
        name: 'full house',
        hole: [c(Rank.King, Suit.Hearts), c(Rank.Five, Suit.Diamonds)],
        board: [
          c(Rank.King, Suit.Clubs),
          c(Rank.King, Suit.Diamonds),
          c(Rank.Two, Suit.Hearts),
          c(Rank.Two, Suit.Clubs),
          c(Rank.Nine, Suit.Spades),
        ],
        rank: HandRank.FullHouse,
      },
      {
        name: 'flush',
        hole: [c(Rank.Seven, Suit.Spades), c(Rank.Three, Suit.Hearts)],
        board: [
          c(Rank.Ace, Suit.Spades),
          c(Rank.Two, Suit.Spades),
          c(Rank.Four, Suit.Spades),
          c(Rank.Nine, Suit.Spades),
          c(Rank.King, Suit.Diamonds),
        ],
        rank: HandRank.Flush,
      },
      {
        name: 'straight',
        hole: [c(Rank.Nine, Suit.Clubs), c(Rank.Two, Suit.Hearts)],
        board: [
          c(Rank.Five, Suit.Clubs),
          c(Rank.Six, Suit.Diamonds),
          c(Rank.Seven, Suit.Hearts),
          c(Rank.Eight, Suit.Spades),
          c(Rank.King, Suit.Diamonds),
        ],
        rank: HandRank.Straight,
      },
      {
        name: 'three of a kind',
        hole: [c(Rank.Queen, Suit.Hearts), c(Rank.Seven, Suit.Clubs)],
        board: [
          c(Rank.Queen, Suit.Clubs),
          c(Rank.Queen, Suit.Diamonds),
          c(Rank.Two, Suit.Hearts),
          c(Rank.Five, Suit.Spades),
          c(Rank.Nine, Suit.Diamonds),
        ],
        rank: HandRank.ThreeOfAKind,
      },
      {
        name: 'two pair',
        hole: [c(Rank.Two, Suit.Clubs), c(Rank.Ace, Suit.Spades)],
        board: [
          c(Rank.Jack, Suit.Clubs),
          c(Rank.Jack, Suit.Diamonds),
          c(Rank.Three, Suit.Hearts),
          c(Rank.Three, Suit.Spades),
          c(Rank.Nine, Suit.Diamonds),
        ],
        rank: HandRank.TwoPair,
      },
      {
        name: 'one pair',
        hole: [c(Rank.Ace, Suit.Spades), c(Rank.Seven, Suit.Clubs)],
        board: [
          c(Rank.Nine, Suit.Clubs),
          c(Rank.Nine, Suit.Diamonds),
          c(Rank.Two, Suit.Hearts),
          c(Rank.Five, Suit.Spades),
          c(Rank.King, Suit.Diamonds),
        ],
        rank: HandRank.OnePair,
      },
      {
        name: 'high card',
        hole: [c(Rank.Three, Suit.Spades), c(Rank.Seven, Suit.Clubs)],
        board: [
          c(Rank.Two, Suit.Clubs),
          c(Rank.Five, Suit.Diamonds),
          c(Rank.Nine, Suit.Hearts),
          c(Rank.Jack, Suit.Spades),
          c(Rank.King, Suit.Diamonds),
        ],
        rank: HandRank.HighCard,
      },
    ]

    for (const testCase of cases) {
      const evaluation = evaluateHand(testCase.hole, testCase.board)
      expect(evaluation.rank, testCase.name).toBe(testCase.rank)
      expect(evaluation.cards).toHaveLength(5)
      expect(evaluation.description.length).toBeGreaterThan(0)
    }
  })

  it('compareHands() returns winner for better hand and ties for equal hands', () => {
    const boardWin = [
      c(Rank.Ace, Suit.Clubs),
      c(Rank.Ace, Suit.Diamonds),
      c(Rank.Ace, Suit.Hearts),
      c(Rank.Nine, Suit.Spades),
      c(Rank.Two, Suit.Diamonds),
    ]
    const p1 = evaluateHandWithRaw([c(Rank.Ace, Suit.Spades), c(Rank.King, Suit.Spades)], boardWin)
    const p2 = evaluateHandWithRaw([c(Rank.King, Suit.Diamonds), c(Rank.Queen, Suit.Clubs)], boardWin)

    const resultWin = compareHands([
      { playerId: 'p1', evaluation: p1.evaluation, rawHand: p1.rawHand },
      { playerId: 'p2', evaluation: p2.evaluation, rawHand: p2.rawHand },
    ])

    expect(resultWin.winners.map(w => w.playerId)).toEqual(['p1'])
    expect(resultWin.losers.map(l => l.playerId)).toEqual(['p2'])

    const boardTie = [
      c(Rank.Two, Suit.Clubs),
      c(Rank.Three, Suit.Diamonds),
      c(Rank.Four, Suit.Hearts),
      c(Rank.Five, Suit.Spades),
      c(Rank.Six, Suit.Diamonds),
    ]
    const t1 = evaluateHandWithRaw([c(Rank.Ace, Suit.Spades), c(Rank.King, Suit.Spades)], boardTie)
    const t2 = evaluateHandWithRaw([c(Rank.Ace, Suit.Hearts), c(Rank.King, Suit.Hearts)], boardTie)

    const resultTie = compareHands([
      { playerId: 'a', evaluation: t1.evaluation, rawHand: t1.rawHand },
      { playerId: 'b', evaluation: t2.evaluation, rawHand: t2.rawHand },
    ])

    expect(new Set(resultTie.winners.map(w => w.playerId))).toEqual(new Set(['a', 'b']))
    expect(resultTie.losers).toHaveLength(0)
  })
})
