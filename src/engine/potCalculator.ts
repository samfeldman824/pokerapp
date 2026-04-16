/**
 * Side pot calculation and pot award logic.
 *
 * When one or more players are all-in for different amounts, the pot must be
 * split into a main pot and one or more side pots. Each pot has a defined set
 * of players eligible to win it.
 *
 * Example: Players A, B, C contribute 50, 100, 200 chips respectively.
 *   - Main pot: 3 × 50 = 150 (A, B, C eligible)
 *   - Side pot 1: 2 × 50 = 100 (B, C eligible — A can't win this)
 *   - Side pot 2: 1 × 100 = 100 (C eligible — only C put in the top 100)
 */

import { Hand } from 'pokersolver'

import { PlayerState, SidePot, PotAward } from './types'

interface HandEvaluationWithRaw {
  rank: number
  description: string
  raw: Hand
}

/** Returns unique values sorted smallest → largest. */
function uniqueSortedAscending(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b)
}

/** Players who put chips in the pot (bet > 0). */
function getContributingPlayers(players: PlayerState[]): PlayerState[] {
  return players.filter(player => player.bet > 0)
}

function chipsInBand(bet: number, low: number, high: number): number {
  return Math.max(0, Math.min(bet, high) - Math.min(bet, low))
}

/**
 * Splits contributions into a main pot and side pots based on all-in levels.
 *
 * Algorithm:
 * 1. Collect all distinct all-in amounts (sorted ascending) — these are the
 *    "level" boundaries that create new side pots.
 * 2. For each level, sum each player's actual chips in the band (previousLevel, level]
 *    using `chipsInBand`. This correctly captures partial contributors (e.g. a blind
 *    poster who folded before meeting the all-in level).
 * 3. Any chips above the highest all-in level go into a final pot that only
 *    non-all-in players are eligible to win.
 *
 * A player who folded is excluded from eligibility even if they contributed chips.
 *
 * @param players - must have `bet` set to the player's total contribution for
 *   the hand (typically `totalBetThisHand`), NOT the current-street `bet`.
 */
export function calculatePots(players: PlayerState[]): SidePot[] {
  const contributingPlayers = getContributingPlayers(players)

  if (contributingPlayers.length === 0) {
    return []
  }

  // Each distinct all-in amount creates a new pot boundary
  const allInLevels = uniqueSortedAscending(
    contributingPlayers
      .filter(player => player.isAllIn)
      .map(player => player.bet)
  )

  const pots: SidePot[] = []
  let previousLevel = 0

  for (const level of allInLevels) {
    const amount = contributingPlayers.reduce((sum, player) => {
      return sum + chipsInBand(player.bet, previousLevel, level)
    }, 0)

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

  // The "overflow" pot: chips contributed above the highest all-in level
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

/**
 * Divides `amount` evenly among `winnerCount` winners.
 * The remainder (odd chips) is returned separately so the caller can decide
 * how to distribute them (typically one extra chip to the player left of dealer).
 *
 * @throws if `winnerCount` is zero or negative
 */
export function splitPotEvenly(amount: number, winnerCount: number): { perPlayer: number; remainder: number } {
  if (winnerCount <= 0) {
    throw new Error('winnerCount must be greater than 0')
  }

  return {
    perPlayer: Math.floor(amount / winnerCount),
    remainder: amount % winnerCount,
  }
}

/**
 * Determines the winner(s) of each pot by comparing hand strengths.
 *
 * For each pot:
 * 1. Filter `handEvaluations` to only the players eligible for that pot.
 * 2. Use `pokersolver.Hand.winners()` to find the best hand(s) among them.
 * 3. If multiple players tie, all are listed as winners (split pot).
 *
 * @throws if a pot has no eligible evaluated hands (data integrity error)
 */
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

    // pokersolver.Hand.winners() handles ties and returns all winning hands
    const winningHandStrings = new Set(
      Hand.winners(eligibleHands.map(hand => hand.raw)).map((h: Hand) => h.toString())
    )
    const winners = eligibleHands.filter(hand => winningHandStrings.has(hand.raw.toString()))

    if (winners.length === 0) {
      throw new Error(`Unable to determine winners for pot ${potIndex}`)
    }

    return {
      potIndex,
      runIndex: 0,
      amount: pot.amount,
      winnerIds: winners.map(winner => winner.playerId),
      handDescription: winners[0].description,
    }
  })
}
