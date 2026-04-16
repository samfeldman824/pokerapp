import { describe, expect, it } from 'vitest'

import { GamePhase, Rank, Suit, type Card } from '@/engine/types'

import { getDualBoardDisplayState } from './DualBoard'

const flop: Card[] = [
  { rank: Rank.Ace, suit: Suit.Spades },
  { rank: Rank.King, suit: Suit.Hearts },
  { rank: Rank.Queen, suit: Suit.Diamonds },
]

const turn = [...flop, { rank: Rank.Jack, suit: Suit.Clubs }]
const river = [...turn, { rank: Rank.Ten, suit: Suit.Spades }]

describe('getDualBoardDisplayState', () => {
  it('keeps shared flop cards visible on run 2 while run 1 is still running', () => {
    expect(
      getDualBoardDisplayState(
        flop,
        GamePhase.River,
        GamePhase.Flop,
        GamePhase.Flop,
        0,
        null,
        null,
      )
    ).toMatchObject({
      boardOneCards: flop,
      boardTwoCards: flop,
      boardOnePhase: GamePhase.Flop,
      boardTwoPhase: GamePhase.Flop,
    })
  })

  it('keeps shared turn cards visible on run 2 while run 1 is still running', () => {
    expect(
      getDualBoardDisplayState(
        turn,
        GamePhase.River,
        GamePhase.Turn,
        GamePhase.Turn,
        0,
        null,
        null,
      )
    ).toMatchObject({
      boardOneCards: turn,
      boardTwoCards: turn,
      boardOnePhase: GamePhase.Turn,
      boardTwoPhase: GamePhase.Turn,
    })
  })

  it('keeps run 2 frozen at the copied flop while run 1 continues to turn and river', () => {
    expect(
      getDualBoardDisplayState(
        river,
        GamePhase.River,
        GamePhase.River,
        GamePhase.Flop,
        0,
        null,
        null,
      )
    ).toMatchObject({
      boardOneCards: river,
      boardTwoCards: flop,
      boardOnePhase: GamePhase.River,
      boardTwoPhase: GamePhase.Flop,
    })
  })

  it('keeps run 2 empty preflop until cards are dealt', () => {
    expect(
      getDualBoardDisplayState(
        [],
        GamePhase.River,
        GamePhase.Preflop,
        GamePhase.Preflop,
        0,
        null,
        null,
      )
    ).toMatchObject({
      boardOneCards: [],
      boardTwoCards: [],
      boardOnePhase: GamePhase.Preflop,
      boardTwoPhase: GamePhase.Preflop,
    })
  })

  it('shows run 2 with copied run 1 cards before divergence once the second run begins', () => {
    expect(
      getDualBoardDisplayState(
        flop,
        GamePhase.River,
        GamePhase.Flop,
        GamePhase.Flop,
        1,
        river,
        flop,
      )
    ).toMatchObject({
      boardOneCards: river,
      boardTwoCards: flop,
      boardOnePhase: GamePhase.Showdown,
      boardTwoPhase: GamePhase.Flop,
    })
  })
})
