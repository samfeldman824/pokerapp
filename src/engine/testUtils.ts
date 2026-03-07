import { DEFAULT_CONFIG } from './constants'
import { createGame } from './gameController'
import { addPlayer } from './playerManager'
import { GameConfig, GameState } from './types'

export interface MakeGameOptions {
  config?: Partial<GameConfig>
  playerCount?: number
}

export function makeGame(options: MakeGameOptions = {}): GameState {
  const config: GameConfig = {
    ...DEFAULT_CONFIG,
    ...options.config,
  }

  let game = createGame(config)

  const playerCount = options.playerCount ?? 3
  if (playerCount < 0 || playerCount > config.maxPlayers) {
    throw new Error(`Invalid playerCount ${playerCount}`)
  }

  for (let seatIndex = 0; seatIndex < playerCount; seatIndex += 1) {
    game = addPlayer(game, `P${seatIndex + 1}`, seatIndex).game
  }

  return game
}
