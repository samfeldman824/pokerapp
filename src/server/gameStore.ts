import { GameState } from '../engine/types'
import { loadPersistedGame } from '../db/persistence'

type SocketGameInfo = {
  gameId: string
  playerId: string
}

export class GameStore {
  private games: Map<string, GameState> = new Map()

  private locks: Map<string, Promise<void>> = new Map()

  get(gameId: string): GameState | undefined {
    return this.games.get(gameId)
  }

  set(gameId: string, state: GameState): void {
    this.games.set(gameId, state)
  }

  delete(gameId: string): void {
    this.games.delete(gameId)
    this.locks.delete(gameId)
  }

  has(gameId: string): boolean {
    return this.games.has(gameId)
  }

  async withLock<T>(gameId: string, fn: () => Promise<T>): Promise<T> {
    const LOCK_TIMEOUT_MS = 30_000
    const previousLock = this.locks.get(gameId) ?? Promise.resolve()

    let releaseLock: (() => void) | undefined
    const currentLock = new Promise<void>((resolve) => {
      releaseLock = resolve
    })

    const chainedLock = previousLock.catch(() => undefined).then(() => currentLock)
    this.locks.set(gameId, chainedLock)

    await previousLock.catch(() => undefined)

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Lock timeout for game ' + gameId)), LOCK_TIMEOUT_MS)
    )

    try {
      return await Promise.race([fn(), timeoutPromise])
    } finally {
      releaseLock?.()

      if (this.locks.get(gameId) === chainedLock) {
        this.locks.delete(gameId)
      }
    }
  }
}

export const gameStore = new GameStore()

export async function getOrLoadGame(gameId: string): Promise<GameState | undefined> {
  const existingGame = gameStore.get(gameId)

  if (existingGame) {
    return existingGame
  }

  const persistedGame = await loadPersistedGame(gameId)

  if (persistedGame) {
    gameStore.set(gameId, persistedGame)
    return persistedGame
  }

  return undefined
}

const socketToGame: Map<string, SocketGameInfo> = new Map()

export function registerSocket(socketId: string, gameId: string, playerId: string): void {
  socketToGame.set(socketId, { gameId, playerId })
}

export function unregisterSocket(socketId: string): SocketGameInfo | undefined {
  const socketInfo = socketToGame.get(socketId)

  if (socketInfo) {
    socketToGame.delete(socketId)
  }

  return socketInfo
}

export function getSocketInfo(socketId: string): SocketGameInfo | undefined {
  return socketToGame.get(socketId)
}
