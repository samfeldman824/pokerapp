import { Hand } from 'pokersolver'

import { PlayerState, SidePot } from './types'

interface HandEvaluationWithRaw {
  rank: number
  description: string
  raw: Hand
}

export interface PotAward {
  potIndex: number
  amount: number
  winnerIds: string[]
  handDescription: string
}

function uniqueSortedAscending(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b)
}

function getContributingPlayers(players: PlayerState[]): PlayerState[] {
  return players.filter(player => player.bet > 0)
}

export function calculatePots(players: PlayerState[]): SidePot[] {
  const contributingPlayers = getContributingPlayers(players)

  if (contributingPlayers.length === 0) {
    return []
  }

  const allInLevels = uniqueSortedAscending(
    contributingPlayers
      .filter(player => player.isAllIn)
      .map(player => player.bet)
  )

  const pots: SidePot[] = []
  let previousLevel = 0

  for (const level of allInLevels) {
    const contributorsAtLevel = contributingPlayers.filter(player => player.bet >= level)
    const amount = contributorsAtLevel.length * (level - previousLevel)

    if (amount > 0) {
      pots.push({
        amount,
        eligiblePlayerIds: contributingPlayers
          .filter(player => !player.isFolded && player.bet >= level)
          .map(player => player.id),
      })
    }

    previousLevel = level
  }

  const remainingAmount = contributingPlayers.reduce((total, player) => {
    return total + Math.max(0, player.bet - previousLevel)
  }, 0)

  if (remainingAmount > 0) {
    pots.push({
      amount: remainingAmount,
      eligiblePlayerIds: contributingPlayers
        .filter(player => !player.isFolded && player.bet > previousLevel)
        .map(player => player.id),
    })
  }

  return pots
}

export function splitPotEvenly(amount: number, winnerCount: number): { perPlayer: number; remainder: number } {
  if (winnerCount <= 0) {
    throw new Error('winnerCount must be greater than 0')
  }

  return {
    perPlayer: Math.floor(amount / winnerCount),
    remainder: amount % winnerCount,
  }
}

export function awardPots(
  pots: SidePot[],
  handEvaluations: Map<string, HandEvaluationWithRaw>
): PotAward[] {
  return pots.map((pot, potIndex) => {
    const eligibleHands = pot.eligiblePlayerIds
      .map(playerId => {
        const evaluation = handEvaluations.get(playerId)

        if (!evaluation) {
          return null
        }

        return {
          playerId,
          ...evaluation,
        }
      })
      .filter(
        (
          evaluation
        ): evaluation is { playerId: string; rank: number; description: string; raw: Hand } => evaluation !== null
      )

    if (eligibleHands.length === 0) {
      throw new Error(`No eligible evaluated hands for pot ${potIndex}`)
    }

    const winningRawHands = new Set(Hand.winners(eligibleHands.map(hand => hand.raw)))
    const winners = eligibleHands.filter(hand => winningRawHands.has(hand.raw))

    if (winners.length === 0) {
      throw new Error(`Unable to determine winners for pot ${potIndex}`)
    }

    return {
      potIndex,
      amount: pot.amount,
      winnerIds: winners.map(winner => winner.playerId),
      handDescription: winners[0].description,
    }
  })
}
