import { nanoid } from 'nanoid'
import { GameState, PlayerState, GameConfig } from './types'

/**
 * Creates a new player token for reconnection
 */
export function createPlayerToken(): string {
  return nanoid(16)
}

/**
 * Creates a new player ID
 */
export function createPlayerId(): string {
  return nanoid(12)
}

/**
 * Returns list of available seat indices (0-8) not occupied by any player
 */
export function getAvailableSeats(game: GameState): number[] {
  const occupiedSeats = new Set(game.players.map(p => p.seatIndex))
  const available: number[] = []
  for (let i = 0; i < game.config.maxPlayers; i++) {
    if (!occupiedSeats.has(i)) {
      available.push(i)
    }
  }
  return available
}

/**
 * Returns true if the game has room for another player
 */
export function canPlayerJoin(game: GameState): boolean {
  return game.players.length < game.config.maxPlayers
}

/**
 * Adds a player to the game at the specified seat.
 * Returns the updated game state and the player's reconnection token.
 */
export function addPlayer(
  game: GameState,
  displayName: string,
  seatIndex: number
): { game: GameState; token: string; playerId: string } {
  const availableSeats = getAvailableSeats(game)
  if (!availableSeats.includes(seatIndex)) {
    throw new Error(`Seat ${seatIndex} is not available`)
  }
  if (!canPlayerJoin(game)) {
    throw new Error('Game is full')
  }

  const token = createPlayerToken()
  const playerId = createPlayerId()

  const newPlayer: PlayerState = {
    id: playerId,
    displayName,
    chips: game.config.startingStack,
    holeCards: null,
    bet: 0,
    totalBetThisHand: 0,
    isFolded: false,
    isAllIn: false,
    isConnected: true,
    seatIndex,
    token,
  }

  return {
    game: {
      ...game,
      players: [...game.players, newPlayer],
    },
    token,
    playerId,
  }
}

/**
 * Removes a player from the game by their ID.
 */
export function removePlayer(game: GameState, playerId: string): GameState {
  return {
    ...game,
    players: game.players.filter(p => p.id !== playerId),
  }
}

/**
 * Finds a player by their reconnection token.
 * Returns null if not found.
 */
export function findPlayerByToken(
  game: GameState,
  token: string
): PlayerState | null {
  return game.players.find(p => p.token === token) ?? null
}

/**
 * Finds a player by their ID.
 */
export function findPlayerById(
  game: GameState,
  playerId: string
): PlayerState | null {
  return game.players.find(p => p.id === playerId) ?? null
}

/**
 * Marks a player as disconnected.
 */
export function markPlayerDisconnected(
  game: GameState,
  playerId: string
): GameState {
  return {
    ...game,
    players: game.players.map(p =>
      p.id === playerId ? { ...p, isConnected: false } : p
    ),
  }
}

/**
 * Marks a player as reconnected.
 */
export function markPlayerReconnected(
  game: GameState,
  playerId: string
): GameState {
  return {
    ...game,
    players: game.players.map(p =>
      p.id === playerId ? { ...p, isConnected: true } : p
    ),
  }
}

/**
 * Rebuys a player — resets their chips to the starting stack.
 * Only valid when player has 0 chips.
 */
export function rebuyPlayer(game: GameState, playerId: string): GameState {
  const player = findPlayerById(game, playerId)
  if (!player) {
    throw new Error(`Player ${playerId} not found`)
  }
  if (player.chips > 0) {
    throw new Error(`Player ${playerId} still has chips — cannot rebuy`)
  }

  return {
    ...game,
    players: game.players.map(p =>
      p.id === playerId
        ? { ...p, chips: game.config.startingStack, isAllIn: false }
        : p
    ),
  }
}

/**
 * Returns active players (not folded, has chips or is all-in)
 */
export function getActivePlayers(game: GameState): PlayerState[] {
  return game.players.filter(p => !p.isFolded)
}

/**
 * Returns players who can still act (not folded, not all-in)
 */
export function getActablePlayers(game: GameState): PlayerState[] {
  return game.players.filter(p => !p.isFolded && !p.isAllIn)
}
