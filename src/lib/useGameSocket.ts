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
 * Token/player persistence (via playerStorage):
 * - Credentials are stored via the playerStorage abstraction, which uses either
 *   localStorage (default, shared across tabs) or sessionStorage (private session mode).
 * - `poker_token_<gameId>`  — reconnect secret; allows the server to restore the player's
 *                             session without re-joining. Written on first join, read on reconnect.
 * - `poker_player_<gameId>` — player ID cache; lets the hook restore `playerId` from storage
 *                             if the component re-mounts before receiving a `joined` event.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import type { ClientGameState, HandResult } from '@/engine/types'
import { getToken, setToken, getPlayerId, setPlayerId as storePlayerId } from '@/lib/playerStorage'

type SocketClient = import('socket.io-client').Socket

export type HandResultEvent = {
  gameId: string
  handNumber: number
  communityCards: ClientGameState['communityCards']
  results: HandResult[]
}

export type ChatMessage = {
  id: string
  gameId: string
  senderId: string
  senderName: string
  text: string
  type: 'custom' | 'reaction'
  timestamp: number
}

type UseGameSocketOptions = {
  onChatMessage?: (msg: ChatMessage) => void
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
export function useGameSocket(gameId: string, options: UseGameSocketOptions = {}): {
  gameState: ClientGameState | null
  playerId: string | null
  spectatorId: string | null
  isConnected: boolean
  lastError: string | null
  lastHandResult: HandResultEvent | null
  emit: (event: string, data: unknown) => void
  registerPlayer: (playerId: string) => void
} {
  const socketRef = useRef<SocketClient | null>(null)
  const [gameState, setGameState] = useState<ClientGameState | null>(null)
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [spectatorId, setSpectatorId] = useState<string | null>(null)
  const [isConnected, setIsConnected] = useState<boolean>(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const [lastHandResult, setLastHandResult] = useState<HandResultEvent | null>(null)
  const onChatMessageRef = useRef<UseGameSocketOptions['onChatMessage']>(options.onChatMessage)

  useEffect(() => {
    onChatMessageRef.current = options.onChatMessage
  }, [options.onChatMessage])

  const emit = useCallback((event: string, data: unknown) => {
    setLastError(null)
    socketRef.current?.emit(event, data)
  }, [])

  /**
   * Saves the player ID to localStorage so it survives page refreshes,
   * then sets it in React state. This is a manual hook for cases where the
   * caller needs to associate a player ID outside of the `joined` event flow.
   */
  const registerPlayer = useCallback(
    (id: string) => {
      storePlayerId(gameId, id)
      setPlayerId(id)
    },
    [gameId],
  )

  useEffect(() => {
    let isCancelled = false
    let detachListeners: (() => void) | null = null

    // Restore the player ID from storage immediately so the UI doesn't flash
    // into an unauthenticated state between mount and the first `joined` event.
    const storedPlayerId = getPlayerId(gameId)
    if (storedPlayerId) setPlayerId(storedPlayerId)

    ;(async () => {
      const { io } = await import('socket.io-client')
      if (isCancelled) {
        return
      }

      const socket = io({ autoConnect: false })
      socketRef.current = socket
      setIsConnected(socket.connected)

      const onConnect = () => {
        setIsConnected(true)
        const storedToken = getToken(gameId)
        if (storedToken) {
          socket.emit('join-game', { gameId, token: storedToken })
        }
      }

      const onDisconnect = () => setIsConnected(false)

      const onJoined = (data: { playerId?: string; spectatorId?: string; token?: string }) => {
        setLastError(null)
        if (data.playerId) {
          storePlayerId(gameId, data.playerId)
          setPlayerId(data.playerId)
          setSpectatorId(null)
          if (data.token) {
            setToken(gameId, data.token)
          }
        } else if (data.spectatorId) {
          setSpectatorId(data.spectatorId)
          setPlayerId(null)
        }
      }

      const onGameState = (state: ClientGameState) => {
        if (state.id !== gameId) return
        setLastError(null)
        setGameState(state)
        setPlayerId((prev) => {
          if (prev) return prev
          const stored = getPlayerId(gameId)
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

      const onChatBroadcast = (event: ChatMessage) => {
        if (event.gameId !== gameId) return
        onChatMessageRef.current?.(event)
      }

      socket.on('connect', onConnect)
      socket.on('disconnect', onDisconnect)
      socket.on('joined', onJoined)
      socket.on('game-state', onGameState)
      socket.on('chat-broadcast', onChatBroadcast)
      socket.on('error', onError)
      socket.on('hand-result', onHandResult)
      socket.connect()

      detachListeners = () => {
        socket.off('connect', onConnect)
        socket.off('disconnect', onDisconnect)
        socket.off('joined', onJoined)
        socket.off('game-state', onGameState)
        socket.off('chat-broadcast', onChatBroadcast)
        socket.off('error', onError)
        socket.off('hand-result', onHandResult)
        socket.disconnect()
      }
    })()

    return () => {
      isCancelled = true
      if (detachListeners) {
        detachListeners()
      }
      if (socketRef.current) {
        socketRef.current = null
      }
      setIsConnected(false)
    }
  }, [gameId])

  return {
    gameState,
    playerId,
    spectatorId,
    isConnected,
    lastError,
    lastHandResult,
    emit,
    registerPlayer,
  }
}
