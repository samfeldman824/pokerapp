import { GameConfig } from './types'

export const DEFAULT_CONFIG: GameConfig = {
  smallBlind: 1,
  bigBlind: 2,
  startingStack: 1000,
  timePerAction: 30,
  maxPlayers: 9,
}

export const CONFIG_LIMITS = {
  smallBlind: { min: 1, max: 10000 },
  bigBlind: { min: 2, max: 20000 },
  startingStack: { min: 10, max: 1000000 },
  timePerAction: { min: 0, max: 300 },
  maxPlayers: { min: 2, max: 9 },
}

export const DISCONNECT_TIMEOUT_MS = 30_000
export const BETWEEN_HANDS_DELAY_MS = 3_000
export const HAND_RESULT_DISPLAY_MS = 5_000
