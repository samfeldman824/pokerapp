/**
 * In-memory game state store with per-game serialised locking.
 *
 * Why locking?
 * Socket.IO events for the same game can arrive concurrently on the same Node.js
 * process (e.g., two players submitting actions within the same event-loop tick).
 * Without a lock, the second event could read stale state before the first has
 * written its result, leading to lost updates or corrupted chip counts.
 *
 * `withLock(gameId, fn)` guarantees that only one async callback runs at a time
 * per game. Callers chain on the previous lock Promise, forming a per-game FIFO
 * queue. A 30-second timeout prevents indefinite blocking if a callback hangs.
 */

import { GameState } from '../engine/types'
import { loadPersistedGame } from '../db/persistence'

/** Associates a socket connection with its game and player. */
type SocketGameInfo = {
  gameId: string
  playerId: string
}

/**
 * Singleton in-memory store for active game states.
 *
 * Games are loaded from the database on first access and remain in memory until
 * all players disconnect for 5+ minutes (see `socketHandlers.ts`).
 */
export class GameStore {
  private games: Map<string, GameState> = new Map()

  /** Tracks the tail of the lock chain for each game. */
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

  /**
   * Runs `fn` exclusively for the given game — no other `withLock` call for the
   * same `gameId` will execute until `fn` resolves.
   *
   * Implementation: each call appends to a per-game Promise chain.
   * - `previousLock` is the current tail of the chain.
   * - `currentLock` is a new Promise whose resolver (`releaseLock`) is called in
   *   `finally`, allowing the next queued callback to proceed.
   * - A 30-second timeout races against `fn()` to guard against hung callbacks.
   *
   * @throws the error from `fn`, or a timeout error if `fn` takes > 30 seconds
   */
  async withLock<T>(gameId: string, fn: () => Promise<T>): Promise<T> {
    const LOCK_TIMEOUT_MS = 30_000
    const previousLock = this.locks.get(gameId) ?? Promise.resolve()

    let releaseLock: (() => void) | undefined
    const currentLock = new Promise<void>((resolve) => {
      releaseLock = resolve
    })

    // Chain: previous tail → this lock's promise (so the next waiter chains off this one)
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

      // Clean up the lock entry if nothing else is waiting
      if (this.locks.get(gameId) === chainedLock) {
        this.locks.delete(gameId)
      }
    }
  }
}

export const gameStore = new GameStore()

/**
 * Returns the game from in-memory store, falling back to the database if not
 * cached. Populates the cache on a DB hit so subsequent calls are fast.
 * Returns `undefined` if the game doesn't exist in either store.
 */
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

/** Maps socket ID → game/player association for the lifetime of the connection. */
const socketToGame: Map<string, SocketGameInfo> = new Map()

/** Records which game and player a socket is associated with on join/reconnect. */
export function registerSocket(socketId: string, gameId: string, playerId: string): void {
  socketToGame.set(socketId, { gameId, playerId })
}

/**
 * Removes the socket → game mapping on disconnect.
 * Returns the removed info (or undefined if the socket was never registered).
 */
export function unregisterSocket(socketId: string): SocketGameInfo | undefined {
  const socketInfo = socketToGame.get(socketId)

  if (socketInfo) {
    socketToGame.delete(socketId)
  }

  return socketInfo
}

/** Looks up the game/player associated with a socket without removing the mapping. */
export function getSocketInfo(socketId: string): SocketGameInfo | undefined {
  return socketToGame.get(socketId)
}
