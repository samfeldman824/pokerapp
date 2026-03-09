import { describe, expect, it } from 'vitest'

import { Hand } from 'pokersolver'

import { awardPots, calculatePots, splitPotEvenly } from './potCalculator'
import { PlayerState, SidePot } from './types'

function player(id: string, bet: number, options: { isAllIn?: boolean; isFolded?: boolean } = {}): PlayerState {
  return {
    id,
    displayName: id,
    chips: 0,
    holeCards: null,
    bet,
    totalBetThisHand: bet,
    isFolded: options.isFolded ?? false,
    isAllIn: options.isAllIn ?? false,
    isConnected: true,
    disconnectTime: null,
    seatIndex: 0,
    token: 'token',
    lastAction: null,
  }
}

describe('potCalculator', () => {
  it('calculatePots() creates a simple 3-player pot', () => {
    const pots = calculatePots([
      player('a', 10),
      player('b', 10),
      player('c', 10),
    ])

    expect(pots).toEqual([
      { amount: 30, eligiblePlayerIds: ['a', 'b', 'c'] },
    ])
  })

  it('calculatePots() creates a side pot when one player is all-in', () => {
    const pots = calculatePots([
      player('a', 5, { isAllIn: true }),
      player('b', 10),
      player('c', 10),
    ])

    expect(pots).toEqual([
      { amount: 15, eligiblePlayerIds: ['a', 'b', 'c'] },
      { amount: 10, eligiblePlayerIds: ['b', 'c'] },
    ])
  })

  it('calculatePots() creates multiple side pots for multiple all-ins', () => {
    const pots = calculatePots([
      player('a', 5, { isAllIn: true }),
      player('b', 8, { isAllIn: true }),
      player('c', 12),
    ])

    expect(pots).toEqual([
      { amount: 15, eligiblePlayerIds: ['a', 'b', 'c'] },
      { amount: 6, eligiblePlayerIds: ['b', 'c'] },
      { amount: 4, eligiblePlayerIds: ['c'] },
    ])
  })

  it('splitPotEvenly() splits evenly and reports remainder', () => {
    expect(splitPotEvenly(10, 2)).toEqual({ perPlayer: 5, remainder: 0 })
    expect(splitPotEvenly(11, 2)).toEqual({ perPlayer: 5, remainder: 1 })
  })

  it('awardPots() awards the main pot to the best hand', () => {
    const pots: SidePot[] = [{ amount: 50, eligiblePlayerIds: ['p1', 'p2'] }]

    const evals = new Map([
      [
        'p1',
        {
          rank: 10,
          description: 'royal flush',
          raw: Hand.solve(['As', 'Ks', 'Qs', 'Js', 'Ts']),
        },
      ],
      [
        'p2',
        {
          rank: 1,
          description: 'high card',
          raw: Hand.solve(['2c', '4d', '6h', '8s', 'Td']),
        },
      ],
    ])

    const awards = awardPots(pots, evals)
    expect(awards).toHaveLength(1)
    expect(awards[0].amount).toBe(50)
    expect(awards[0].winnerIds).toEqual(['p1'])
  })
})
