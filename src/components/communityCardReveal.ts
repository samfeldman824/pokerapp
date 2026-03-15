import type { Card } from '@/engine/types'
import { GamePhase } from '@/engine/types'

/**
 * Timing constants for community card reveal animations (in milliseconds)
 */
export const FLOP_STAGGER = 120
export const PER_CARD_REVEAL_DURATION = 260
export const REVEAL_SETTLE_BUFFER = 120
export const TURN_RIVER_DELAY = 0

/**
 * Generate a stable snapshot key for a board state.
 * Used to detect when the board has changed (new hand or reset).
 *
 * @param cards - Current community cards
 * @param handNumber - Current hand number
 * @returns Deterministic string key combining handNumber and card identities
 */
export function getBoardSnapshotKey(cards: Card[], handNumber: number): string {
  const cardIdentities = cards
    .map((card) => `${card.rank}${card.suit}`)
    .join(',')
  return `${handNumber}:${cardIdentities}`
}

/**
 * Detect newly added card indices by comparing previous and current boards.
 * Returns indices present in next but not prev (by position).
 *
 * @param prev - Previous card array
 * @param next - Current card array
 * @returns Array of newly added card indices
 */
export function detectNewIndices(prev: Card[], next: Card[]): number[] {
  if (next.length <= prev.length) {
    return []
  }

  const newIndices: number[] = []
  for (let i = prev.length; i < next.length; i++) {
    newIndices.push(i)
  }
  return newIndices
}

/**
 * Check if the board should be reset (no reveal animations).
 * Reset occurs when we're in Waiting/Preflop phase or board is empty.
 *
 * @param phase - Current game phase
 * @param cards - Current community cards
 * @returns true if reset condition is met
 */
export function isResetCondition(phase: GamePhase, cards: Card[]): boolean {
  return (
    (phase === GamePhase.Waiting || phase === GamePhase.Preflop) ||
    cards.length === 0
  )
}

/**
 * Generate the reveal schedule for newly added cards.
 * Flop cards (indices 0, 1, 2) have staggered delays (0, 90, 180).
 * Turn and River cards (indices 3, 4) have no delay.
 *
 * @param newIndices - Indices of newly added cards
 * @returns Array of {index, delay} objects for animation scheduling
 */
export function getRevealSchedule(
  newIndices: number[]
): Array<{ index: number; delay: number }> {
  if (newIndices.length === 0) {
    return []
  }

  const schedule: Array<{ index: number; delay: number }> = []

  // Flop: indices 0, 1, 2 with stagger
  if (newIndices[0] === 0) {
    // This is the flop reveal
    for (let i = 0; i < 3; i++) {
      schedule.push({
        index: i,
        delay: i * FLOP_STAGGER,
      })
    }
  } else {
    // Turn (index 3) or River (index 4): no stagger
    for (const index of newIndices) {
      schedule.push({
        index,
        delay: TURN_RIVER_DELAY,
      })
    }
  }

  return schedule
}
