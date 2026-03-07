'use client'

import { useCallback, useEffect, useState } from 'react'

import type { ClientGameState, HandResult } from '@/engine/types'

import { socket } from './socket'

type HandResultEvent = {
  gameId: string
  handNumber: number
  results: HandResult[]
}

export function useGameSocket(gameId: string): {
  gameState: ClientGameState | null
  playerId: string | null
  isConnected: boolean
  emit: (event: string, data: unknown) => void
  registerPlayer: (playerId: string) => void
} {
  const [gameState, setGameState] = useState<ClientGameState | null>(null)
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [isConnected, setIsConnected] = useState<boolean>(socket.connected)
  const [, setLastHandResult] = useState<HandResultEvent | null>(null)
  const [, setLastError] = useState<string | null>(null)

  const emit = useCallback((event: string, data: unknown) => {
    socket.emit(event, data)
  }, [])

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
    const storedPlayerId = localStorage.getItem(playerKey)
    if (storedPlayerId) setPlayerId(storedPlayerId)

    const onConnect = () => setIsConnected(true)
    const onDisconnect = () => setIsConnected(false)

    const onJoined = (data: { playerId: string }) => {
      localStorage.setItem(playerKey, data.playerId)
      setPlayerId(data.playerId)
    }

    const onGameState = (state: ClientGameState) => {
      if (state.id !== gameId) return
      setGameState(state)

      setPlayerId((prev) => {
        if (prev) return prev
        const stored = localStorage.getItem(playerKey)
        return stored ?? null
      })
    }

    const onHandResult = (data: HandResultEvent) => {
      if (data.gameId !== gameId) return
      setLastHandResult(data)
    }

    const onError = (data: { message: string }) => {
      setLastError(data.message)
    }

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('joined', onJoined)
    socket.on('game-state', onGameState)
    socket.on('hand-result', onHandResult)
    socket.on('error', onError)

    socket.connect()

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('joined', onJoined)
      socket.off('game-state', onGameState)
      socket.off('hand-result', onHandResult)
      socket.off('error', onError)
      socket.disconnect()
    }
  }, [gameId])

  return {
    gameState,
    playerId,
    isConnected,
    emit,
    registerPlayer,
  }
}
