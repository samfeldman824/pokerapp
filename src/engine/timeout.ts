import { ActionType, GameState } from './types'
import { applyAction } from './betting'

export function startActionTimer(game: GameState): GameState {
  const timerStart = Date.now()

  return {
    ...game,
    timerStart,
    actionTimerStart: timerStart,
  }
}

export function isTimedOut(game: GameState, now: number): boolean {
  if (!Number.isFinite(game.config.timePerAction) || game.config.timePerAction <= 0) {
    return false
  }

  const timerStart = game.timerStart ?? game.actionTimerStart
  if (typeof timerStart !== 'number') {
    return false
  }

  return now - timerStart > game.config.timePerAction * 1000
}

export function autoFoldPlayer(game: GameState): GameState {
  const actingSeat = game.activePlayerIndex
  const actingPlayer = actingSeat >= 0 ? game.players[actingSeat] : undefined

  if (!actingPlayer || actingPlayer.isFolded || actingPlayer.isAllIn || actingPlayer.chips <= 0) {
    return game
  }

  return applyAction(game, { type: ActionType.Fold })
}
