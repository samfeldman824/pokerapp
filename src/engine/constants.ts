/**
 * Shared constants for game configuration and server behaviour.
 *
 * `DEFAULT_CONFIG` — used by `createGame` when no config is provided, and as
 * fallback values in the betting engine when individual config fields are missing.
 *
 * `CONFIG_LIMITS` — the absolute allowed range for each config field. Note that
 * the API route (`/api/games`) enforces its own (narrower) validation; these
 * limits exist for reference and potential future use in a shared validator.
 *
 * Timing constants — `DISCONNECT_TIMEOUT_MS` is process-level server behaviour.
 * Between-hand timing is game-configurable via `GameConfig.betweenHandsDelay`.
 */

import { GameConfig } from './types'

export const DEFAULT_CONFIG: GameConfig = {
  smallBlind: 1,
  bigBlind: 2,
  blindSchedule: undefined,
  blindIncreaseInterval: undefined,
  startingStack: 1000,
  timePerAction: 30,
  betweenHandsDelay: 3,
  runItTwice: false,
  maxPlayers: 9,
}

export const CONFIG_LIMITS = {
  smallBlind: { min: 1, max: 10000 },
  bigBlind: { min: 2, max: 20000 },
  startingStack: { min: 10, max: 1000000 },
  blindIncreaseInterval: { min: 1, max: 100 },
  timePerAction: { min: 0, max: 300 },
  betweenHandsDelay: { min: 2, max: 15 },
  maxPlayers: { min: 2, max: 9 },
}

/** How long a disconnected player has before being auto-folded (ms). */
export const DISCONNECT_TIMEOUT_MS = 30_000

/** How long the hand result overlay is displayed on the client (ms). */
export const HAND_RESULT_DISPLAY_MS = 5_000
