'use client'

/**
 * useGameSocket — React hook that manages the Socket.IO connection for a game room.
 *
 * Responsibilities:
 * - Connect/disconnect the socket on mount/unmount.
 * - Re-authenticate automatically on reconnect using the stored token.
 * - Subscribe to server events (`joined`, `game-state`, `error`).
 * - Expose a stable `emit` callback and reactive state for the game page to consume.
 *
 * Token/player persistence (localStorage):
 * - `poker_token_<gameId>`  — reconnect secret; allows the server to restore the player's
 *                             session without re-joining. Written on first join, read on reconnect.
 * - `poker_player_<gameId>` — player ID cache; lets the hook restore `playerId` from storage
 *                             if the component re-mounts before receiving a `joined` event.
 */

import { useCallback, useEffect, useState } from 'react'

import type { ClientGameState, HandResult } from '@/engine/types'

import { socket } from './socket'

export type HandResultEvent = {
  gameId: string
  handNumber: number
  communityCards: ClientGameState['communityCards']
  results: HandResult[]
}

/**
 * @param gameId - The game UUID from the URL. All events and storage keys are scoped to this ID.
 *
 * @returns
 *   - `gameState`      Latest server-broadcasted game state for this player's view.
 *   - `playerId`       This player's ID (restored from localStorage if available).
 *   - `isConnected`    Live Socket.IO connection status.
 *   - `lastError`      Most recent server error message (null if none).
 *   - `emit`           Stable wrapper around `socket.emit` — safe to use in callbacks.
 *   - `registerPlayer` Manually set and persist a player ID (used after joining).
 */
export function useGameSocket(gameId: string): {
  gameState: ClientGameState | null
  playerId: string | null
  isConnected: boolean
  lastError: string | null
  lastHandResult: HandResultEvent | null
  emit: (event: string, data: unknown) => void
  registerPlayer: (playerId: string) => void
} {
  const [gameState, setGameState] = useState<ClientGameState | null>(null)
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [isConnected, setIsConnected] = useState<boolean>(socket.connected)
  const [lastError, setLastError] = useState<string | null>(null)
  const [lastHandResult, setLastHandResult] = useState<HandResultEvent | null>(null)

  const emit = useCallback((event: string, data: unknown) => {
    setLastError(null)
    socket.emit(event, data)
  }, [])

  /**
   * Saves the player ID to localStorage so it survives page refreshes,
   * then sets it in React state. This is a manual hook for cases where the
   * caller needs to associate a player ID outside of the `joined` event flow.
   */
  const registerPlayer = useCallback(
    (id: string) => {
      const key = `poker_player_${gameId}`
      localStorage.setItem(key, id)
      setPlayerId(id)
    },
    [gameId],
  )

  useEffect(() => {
    const playerKey = `poker_player_${gameId}`

    // Restore the player ID from storage immediately so the UI doesn't flash
    // into an unauthenticated state between mount and the first `joined` event.
    const storedPlayerId = localStorage.getItem(playerKey)
    if (storedPlayerId) setPlayerId(storedPlayerId)

    const onConnect = () => {
      setIsConnected(true)
      // On reconnect, re-authenticate using the stored token.
      // The server will restore the player's state without creating a new player record.
      const storedToken = localStorage.getItem(`poker_token_${gameId}`)
      if (storedToken) {
        socket.emit('join-game', { gameId, token: storedToken })
      }
    }
    const onDisconnect = () => setIsConnected(false)

    /**
     * `joined` fires after the server successfully admits a player (new or reconnecting).
     * - Always updates `playerId` and persists it.
     * - Only updates the stored token if the server returns one (new joins return a token;
     *   reconnects do not — the existing token remains valid).
     */
    const onJoined = (data: { playerId: string; token?: string }) => {
      setLastError(null)
      localStorage.setItem(playerKey, data.playerId)
      setPlayerId(data.playerId)
      if (data.token) {
        localStorage.setItem(`poker_token_${gameId}`, data.token)
      }
    }

    const onGameState = (state: ClientGameState) => {
      // Guard against stale events from a previous game room (shouldn't happen, but defensive)
      if (state.id !== gameId) return
      setLastError(null)
      setGameState(state)

      // Fallback: if playerId was cleared but localStorage still has it, restore it.
      // This covers the edge case where the hook re-mounts after a HMR reload.
      setPlayerId((prev) => {
        if (prev) return prev
        const stored = localStorage.getItem(playerKey)
        return stored ?? null
      })
    }

    const onError = (data: { message: string }) => {
      setLastError(data.message)
    }

    const onHandResult = (event: HandResultEvent) => {
      if (event.gameId !== gameId) return
      setLastHandResult(event)
    }

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('joined', onJoined)
    socket.on('game-state', onGameState)
    socket.on('error', onError)
    socket.on('hand-result', onHandResult)

    socket.connect()

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('joined', onJoined)
      socket.off('game-state', onGameState)
      socket.off('error', onError)
      socket.off('hand-result', onHandResult)
      socket.disconnect()
    }
  }, [gameId])

  return {
    gameState,
    playerId,
    isConnected,
    lastError,
    lastHandResult,
    emit,
    registerPlayer,
  }
}
