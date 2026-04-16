import { describe, expect, it } from 'vitest'

import { Suit, Rank, type PotAward } from '@/engine/types'
import { buildHandHistoryDetail, buildHandHistorySummaries, normalizeCompletedHandBoards, normalizePersistedBoardResults } from '@/lib/handHistory'

const boardOne = [
  { suit: Suit.Clubs, rank: Rank.Ace },
  { suit: Suit.Diamonds, rank: Rank.King },
  { suit: Suit.Hearts, rank: Rank.Queen },
  { suit: Suit.Spades, rank: Rank.Jack },
  { suit: Suit.Clubs, rank: Rank.Ten },
]

const boardTwo = [
  { suit: Suit.Spades, rank: Rank.Ace },
  { suit: Suit.Hearts, rank: Rank.Ace },
  { suit: Suit.Diamonds, rank: Rank.Ace },
  { suit: Suit.Clubs, rank: Rank.Two },
  { suit: Suit.Spades, rank: Rank.Two },
]

const potAward = (runIndex: 0 | 1, amount: number): PotAward => ({
  potIndex: 0,
  runIndex,
  amount,
  winnerIds: ['p1'],
  handDescription: runIndex === 0 ? 'Royal Flush' : 'Aces full',
})

describe('handHistory helpers', () => {
  it('normalizes legacy single-board rows into one board/result entry', () => {
    expect(normalizeCompletedHandBoards(undefined, boardOne)).toEqual([
      { runIndex: 0, communityCards: boardOne },
    ])

    expect(normalizePersistedBoardResults(undefined, {
      handRank: 9,
      handDescription: 'Straight Flush',
      winnings: 120,
    })).toEqual([
      {
        runIndex: 0,
        handRank: 9,
        handDescription: 'Straight Flush',
        winnings: 120,
        potAwards: [],
      },
    ])
  })

  it('builds dual-board summaries with winners per board', () => {
    const summaries = buildHandHistorySummaries(
      [{
        id: 'h1',
        handNumber: 7,
        potTotal: 150,
        communityCards: boardTwo,
        boards: [
          { runIndex: 0, communityCards: boardOne },
          { runIndex: 1, communityCards: boardTwo },
        ],
        completedAt: '2026-04-15T00:00:00.000Z',
      }],
      [
        {
          handId: 'h1',
          displayName: 'Alice',
          boardResults: [
            { runIndex: 0, handRank: 10, handDescription: 'Royal Flush', winnings: 75, potAwards: [potAward(0, 75)] },
            { runIndex: 1, handRank: null, handDescription: null, winnings: 0, potAwards: [] },
          ],
          handRank: null,
          handDescription: null,
          winnings: 75,
        },
        {
          handId: 'h1',
          displayName: 'Bob',
          boardResults: [
            { runIndex: 0, handRank: null, handDescription: null, winnings: 0, potAwards: [] },
            { runIndex: 1, handRank: 7, handDescription: 'Aces full', winnings: 75, potAwards: [potAward(1, 75)] },
          ],
          handRank: null,
          handDescription: null,
          winnings: 75,
        },
      ],
    )

    expect(summaries).toEqual([
      {
        handNumber: 7,
        potTotal: 150,
        boards: [
          {
            runIndex: 0,
            communityCards: boardOne,
            winners: [{ displayName: 'Alice', winnings: 75 }],
          },
          {
            runIndex: 1,
            communityCards: boardTwo,
            winners: [{ displayName: 'Bob', winnings: 75 }],
          },
        ],
        completedAt: '2026-04-15T00:00:00.000Z',
      },
    ])
  })

  it('builds dual-board detail results with board-specific evaluations', () => {
    const detail = buildHandHistoryDetail(
      {
        handNumber: 7,
        potTotal: 150,
        communityCards: boardTwo,
        boards: [
          { runIndex: 0, communityCards: boardOne },
          { runIndex: 1, communityCards: boardTwo },
        ],
        completedAt: '2026-04-15T00:00:00.000Z',
      },
      [
        { phase: 'preflop', actionType: 'raise', amount: 50, displayName: 'Alice', ordering: 1 },
      ],
      [
        {
          displayName: 'Alice',
          holeCards: boardOne.slice(0, 2),
          boardResults: [
            { runIndex: 0, handRank: 10, handDescription: 'Royal Flush', winnings: 75, potAwards: [potAward(0, 75)] },
            { runIndex: 1, handRank: 1, handDescription: 'Ace High', winnings: 0, potAwards: [] },
          ],
          handRank: null,
          handDescription: null,
          winnings: 75,
        },
      ],
    )

    expect(detail.boards).toHaveLength(2)
    expect(detail.results).toEqual([
      {
        displayName: 'Alice',
        holeCards: boardOne.slice(0, 2),
        winnings: 75,
        boardResults: [
          { runIndex: 0, handRank: 10, handDescription: 'Royal Flush', winnings: 75, potAwards: [potAward(0, 75)] },
          { runIndex: 1, handRank: 1, handDescription: 'Ace High', winnings: 0, potAwards: [] },
        ],
      },
    ])
  })
})
