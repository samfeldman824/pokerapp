/**
 * Action timer utilities — tracks when the current player's clock started and
 * automatically folds them when it expires.
 *
 * Timer state is stored in `GameState` (`actionTimerStart`) so the client can
 * display a countdown without needing a separate channel.
 */

import { ActionType, GameState } from './types'
import { applyAction } from './betting'

/**
 * Records the current timestamp as the start of the active player's action clock.
 * Called by `scheduleActionTimer` in socketHandlers immediately after a new actor
 * is determined, so the client-side countdown stays in sync with the server timer.
 */
export function startActionTimer(game: GameState): GameState {
  const actionTimerStart = Date.now()

  return {
    ...game,
    actionTimerStart,
  }
}

/**
 * Returns true if the active player's allotted time has elapsed.
 *
 * Falls back to the legacy `timerStart` field if `actionTimerStart` is unset
 * (for backwards compatibility with older persisted game states).
 * Returns false if time-per-action is disabled (`timePerAction <= 0`).
 */
export function isTimedOut(game: GameState, now: number): boolean {
  if (!Number.isFinite(game.config.timePerAction) || game.config.timePerAction <= 0) {
    return false
  }

  const timerStart = game.actionTimerStart ?? game.timerStart
  if (typeof timerStart !== 'number') {
    return false
  }

  return now - timerStart > game.config.timePerAction * 1000
}

/**
 * Folds the current active player via `applyAction`. Returns the game unchanged
 * if no valid actor exists (guard against stale timer callbacks).
 */
export function autoFoldPlayer(game: GameState): GameState {
  const actingSeat = game.activePlayerIndex
  const actingPlayer = actingSeat >= 0 ? game.players[actingSeat] : undefined

  if (!actingPlayer || actingPlayer.isFolded || actingPlayer.isAllIn || actingPlayer.chips <= 0) {
    return game
  }

  return applyAction(game, { type: ActionType.Fold })
}
