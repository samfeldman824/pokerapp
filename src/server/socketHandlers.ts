import { Server, Socket } from 'socket.io'

import {
  getPlayerView,
  getShowdownResults,
  handleAction,
  isHandComplete,
  startHand,
} from '../engine/gameController'
import {
  addPlayer,
  findPlayerByToken,
  rebuyPlayer,
  markPlayerDisconnected,
  markPlayerReconnected,
  shouldAutoFoldDisconnected,
} from '../engine/playerManager'
import { autoFoldPlayer, startActionTimer } from '../engine/timeout'
import { awardPots, calculatePots } from '../engine/potCalculator'
import { evaluateHandWithRaw } from '../engine/handEvaluator'
import { advancePhase } from '../engine/betting'
import {
  ActionType,
  Card,
  GamePhase,
  GameState,
  HandResult,
  PlayerAction,
  PlayerState,
} from '../engine/types'
import {
  saveGame,
  saveHand,
  saveHandAction,
  saveHandResults,
  savePlayer,
} from '../db/persistence'
import {
  gameStore,
  getOrLoadGame,
  getSocketInfo,
  registerSocket,
  unregisterSocket,
} from './gameStore'

const timers: Map<string, NodeJS.Timeout> = new Map()
const activeHandIds: Map<string, string> = new Map()
const handActionOrder: Map<string, number> = new Map()
const DISCONNECT_AUTO_FOLD_DELAY_MS = 30_000

type PlayerWithCards = PlayerState & { holeCards: [Card, Card] }

type JoinGamePayload = {
  gameId: string
  displayName: string
  seatIndex: number
  token?: string
}

type GamePlayerPayload = {
  gameId: string
  playerId: string
}

type PlayerActionPayload = GamePlayerPayload & {
  action: PlayerAction
}

type RebuyPayload = GamePlayerPayload

type HandResultEvent = {
  gameId: string
  handNumber: number
  communityCards: GameState['communityCards']
  results: HandResult[]
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Unexpected server error'
}

function emitSocketError(socket: Socket, error: unknown): void {
  socket.emit('error', { message: getErrorMessage(error) })
}

function clearGameTimer(gameId: string): void {
  const timer = timers.get(gameId)

  if (timer) {
    clearTimeout(timer)
    timers.delete(gameId)
  }
}

function getActingPlayer(game: GameState): PlayerState | undefined {
  if (game.activePlayerIndex < 0) {
    return undefined
  }

  return game.players[game.activePlayerIndex]
}

function resetTimerState(game: GameState): GameState {
  return {
    ...game,
    timerStart: null,
    actionTimerStart: null,
  }
}

function resolvePendingRound(game: GameState): GameState {
  if (game.activePlayerIndex !== -1 || isHandComplete(game)) {
    return game
  }

  if (game.phase === GamePhase.River) {
    return getShowdownResults(game)
  }

  return advancePhase(game)
}

function getPlayersInResolvedHand(game: GameState): PlayerState[] {
  return game.players.filter(
    (player) => player.holeCards !== null || player.totalBetThisHand > 0 || player.bet > 0 || player.isAllIn
  )
}

function getCurrentHandId(gameId: string): string {
  const handId = activeHandIds.get(gameId)

  if (!handId) {
    throw new Error('No active hand found for game')
  }

  return handId
}

function getNextActionOrder(gameId: string): number {
  const nextOrder = (handActionOrder.get(gameId) ?? 0) + 1
  handActionOrder.set(gameId, nextOrder)
  return nextOrder
}

function buildHandResults(previousGame: GameState, resolvedGame: GameState): HandResult[] {
  const previousPlayersById = new Map(previousGame.players.map((player) => [player.id, player]))
  const resolvedPlayers = getPlayersInResolvedHand(resolvedGame)
  const handPlayers = resolvedPlayers.map((player) => ({
    ...player,
    bet: player.totalBetThisHand,
  }))
  const pots = resolvedGame.sidePots.length > 0 ? resolvedGame.sidePots : calculatePots(handPlayers)

  const evaluatedHands = new Map(
    resolvedPlayers
      .filter((player): player is PlayerWithCards => {
        return !player.isFolded && player.holeCards !== null
      })
      .map((player) => {
        const { evaluation, rawHand } = evaluateHandWithRaw(player.holeCards, resolvedGame.communityCards)

        return [
          player.id,
          {
            evaluation,
            rawHand,
          },
        ] as const
      })
  )

  const potAwards = pots.length === 0
    ? []
    : awardPots(
        pots,
        new Map(
          Array.from(evaluatedHands.entries()).map(([playerId, hand]) => [
            playerId,
            {
              rank: hand.evaluation.rank,
              description: hand.evaluation.description,
              raw: hand.rawHand,
            },
          ])
        )
      )

  return resolvedPlayers.map((player) => {
    const previousPlayer = previousPlayersById.get(player.id)
    const winnings = previousPlayer ? Math.max(0, player.chips - previousPlayer.chips) : 0
    const evaluation = player.isFolded || player.holeCards === null
      ? null
      : evaluatedHands.get(player.id)?.evaluation ?? null

    return {
      playerId: player.id,
      holeCards: player.holeCards,
      evaluation,
      winnings,
      potAwards: potAwards.filter((potAward) => potAward.winnerIds.includes(player.id)).map((potAward) => ({
        potIndex: potAward.potIndex,
        amount: potAward.amount,
        winnerIds: potAward.winnerIds,
        handDescription: potAward.handDescription,
      })),
    }
  })
}

async function broadcastGameState(io: Server, game: GameState): Promise<void> {
  const sockets = await io.in(game.id).fetchSockets()

  await Promise.all(
    sockets.map(async (roomSocket) => {
      const socketInfo = getSocketInfo(roomSocket.id)
      const playerId = socketInfo?.gameId === game.id ? socketInfo.playerId : ''

      roomSocket.emit('game-state', getPlayerView(game, playerId))
    })
  )
}

async function emitHandResult(io: Server, event: HandResultEvent): Promise<void> {
  io.to(event.gameId).emit('hand-result', event)
}

async function persistCompletedHand(gameId: string, previousGame: GameState, resolvedGame: GameState): Promise<HandResultEvent> {
  const handId = getCurrentHandId(gameId)
  const results = buildHandResults(previousGame, resolvedGame)

  await saveHandResults(handId, results)
  activeHandIds.delete(gameId)
  handActionOrder.delete(gameId)

  return {
    gameId: resolvedGame.id,
    handNumber: resolvedGame.handNumber,
    communityCards: resolvedGame.communityCards,
    results,
  }
}

async function autoFoldCurrentPlayerLocked(
  io: Server,
  currentGame: GameState,
  expectedPlayerId: string
): Promise<void> {
  if (currentGame.isPaused || isHandComplete(currentGame)) {
    return
  }

  const actingPlayer = getActingPlayer(currentGame)

  if (!actingPlayer || actingPlayer.id !== expectedPlayerId) {
    return
  }

  clearGameTimer(currentGame.id)

  let nextGame = resolvePendingRound(autoFoldPlayer(currentGame))
  let handResultEvent: HandResultEvent | undefined
  const handId = getCurrentHandId(currentGame.id)

  await saveHandAction(
    handId,
    expectedPlayerId,
    currentGame.phase,
    ActionType.Fold,
    null,
    getNextActionOrder(currentGame.id)
  )

  if (isHandComplete(nextGame)) {
    const resolvedGame = nextGame.phase === GamePhase.Showdown
      ? nextGame
      : getShowdownResults(nextGame)

    handResultEvent = await persistCompletedHand(currentGame.id, currentGame, resolvedGame)
    nextGame = resolvedGame
  }

  nextGame = scheduleActionTimer(io, nextGame)
  gameStore.set(nextGame.id, nextGame)
  await saveGame(nextGame)

  if (handResultEvent) {
    await emitHandResult(io, handResultEvent)
  }

  await broadcastGameState(io, nextGame)
}

function scheduleActionTimer(io: Server, game: GameState): GameState {
  clearGameTimer(game.id)

  const nextGame = resetTimerState(game)
  const actingPlayer = getActingPlayer(nextGame)

  if (
    nextGame.config.timePerAction <= 0 ||
    nextGame.isPaused ||
    isHandComplete(nextGame) ||
    !actingPlayer
  ) {
    return nextGame
  }

  const timedGame = startActionTimer(nextGame)
  gameStore.set(timedGame.id, timedGame)

  const timer = setTimeout(() => {
    void autoFoldCurrentPlayer(io, timedGame.id, actingPlayer.id, 'timer')
  }, timedGame.config.timePerAction * 1000)

  timers.set(timedGame.id, timer)

  return timedGame
}

async function autoFoldCurrentPlayer(
  io: Server,
  gameId: string,
  expectedPlayerId: string,
  _source: 'disconnect' | 'timer'
): Promise<void> {
  await gameStore.withLock(gameId, async () => {
    const currentGame = gameStore.get(gameId)

    if (!currentGame) {
      return
    }

    await autoFoldCurrentPlayerLocked(io, currentGame, expectedPlayerId)
  })
}

export function registerSocketHandlers(io: Server, socket: Socket): void {
  socket.on('join-game', (payload: JoinGamePayload) => {
    void gameStore.withLock(payload.gameId, async () => {
      try {
        const game = await getOrLoadGame(payload.gameId)

        if (!game) {
          throw new Error('Game not found')
        }

        await socket.join(payload.gameId)

        if (payload.token) {
          const existingPlayer = findPlayerByToken(game, payload.token)

          if (existingPlayer) {
            const updatedGame = markPlayerReconnected(game, existingPlayer.id)
            gameStore.set(updatedGame.id, updatedGame)
            registerSocket(socket.id, updatedGame.id, existingPlayer.id)
            await saveGame(updatedGame)
            socket.emit('joined', { playerId: existingPlayer.id })
            socket.emit('game-state', getPlayerView(updatedGame, existingPlayer.id))
            await broadcastGameState(io, updatedGame)
            return
          }
        }

        const { game: gameWithPlayer, playerId } = addPlayer(game, payload.displayName, payload.seatIndex)
        const updatedGame = game.hostPlayerId
          ? gameWithPlayer
          : {
              ...gameWithPlayer,
              hostPlayerId: playerId,
            }

        gameStore.set(updatedGame.id, updatedGame)
        registerSocket(socket.id, updatedGame.id, playerId)

        const player = updatedGame.players.find((candidate) => candidate.id === playerId)

        if (!player) {
          throw new Error('Failed to create player')
        }

        await savePlayer(player, updatedGame.id)
        await saveGame(updatedGame)
        socket.emit('joined', { playerId })
        socket.emit('game-state', getPlayerView(updatedGame, playerId))
        await broadcastGameState(io, updatedGame)
      } catch (error) {
        console.error('join-game error', error)
        emitSocketError(socket, error)
      }
    })
  })

  socket.on('start-game', (payload: GamePlayerPayload) => {
    void gameStore.withLock(payload.gameId, async () => {
      try {
        const game = await getOrLoadGame(payload.gameId)

        if (!game) {
          throw new Error('Game not found')
        }

        if (payload.playerId !== game.hostPlayerId) {
          throw new Error('Only the host can start the game')
        }

        let nextGame = startHand(game)
        nextGame = scheduleActionTimer(io, nextGame)
        gameStore.set(nextGame.id, nextGame)

        const handId = await saveHand(nextGame)
        activeHandIds.set(nextGame.id, handId)
        handActionOrder.set(nextGame.id, 0)
        await saveGame(nextGame)
        await broadcastGameState(io, nextGame)
      } catch (error) {
        emitSocketError(socket, error)
      }
    })
  })

  socket.on('player-action', (payload: PlayerActionPayload) => {
    void gameStore.withLock(payload.gameId, async () => {
      try {
        const game = await getOrLoadGame(payload.gameId)

        if (!game) {
          throw new Error('Game not found')
        }

        clearGameTimer(payload.gameId)

        let nextGame = handleAction(game, payload.playerId, payload.action)
        let handResultEvent: HandResultEvent | undefined
        const handId = getCurrentHandId(payload.gameId)
        const actionAmount = payload.action.type === ActionType.Raise
          ? payload.action.amount
          : null

        await saveHandAction(
          handId,
          payload.playerId,
          game.phase,
          payload.action.type,
          actionAmount,
          getNextActionOrder(payload.gameId)
        )

        if (isHandComplete(nextGame)) {
          const resolvedGame = nextGame.phase === GamePhase.Showdown
            ? nextGame
            : getShowdownResults(nextGame)
          handResultEvent = await persistCompletedHand(payload.gameId, game, resolvedGame)
          nextGame = resolvedGame
        }

        nextGame = scheduleActionTimer(io, nextGame)
        gameStore.set(nextGame.id, nextGame)

        await saveGame(nextGame)

        if (handResultEvent) {
          await emitHandResult(io, handResultEvent)
        }

        await broadcastGameState(io, nextGame)
      } catch (error) {
        emitSocketError(socket, error)
      }
    })
  })

  socket.on('pause-game', (payload: GamePlayerPayload) => {
    void gameStore.withLock(payload.gameId, async () => {
      try {
        const game = await getOrLoadGame(payload.gameId)

        if (!game) {
          throw new Error('Game not found')
        }

        if (payload.playerId !== game.hostPlayerId) {
          throw new Error('Only the host can pause the game')
        }

        clearGameTimer(payload.gameId)

        const nextGame = {
          ...resetTimerState(game),
          isPaused: true,
        }

        gameStore.set(nextGame.id, nextGame)
        await saveGame(nextGame)
        await broadcastGameState(io, nextGame)
      } catch (error) {
        emitSocketError(socket, error)
      }
    })
  })

  socket.on('resume-game', (payload: GamePlayerPayload) => {
    void gameStore.withLock(payload.gameId, async () => {
      try {
        const game = await getOrLoadGame(payload.gameId)

        if (!game) {
          throw new Error('Game not found')
        }

        if (payload.playerId !== game.hostPlayerId) {
          throw new Error('Only the host can resume the game')
        }

        let nextGame = {
          ...game,
          isPaused: false,
        }

        nextGame = scheduleActionTimer(io, nextGame)
        gameStore.set(nextGame.id, nextGame)
        await saveGame(nextGame)
        await broadcastGameState(io, nextGame)
      } catch (error) {
        emitSocketError(socket, error)
      }
    })
  })

  socket.on('rebuy', (payload: RebuyPayload) => {
    void gameStore.withLock(payload.gameId, async () => {
      try {
        const game = await getOrLoadGame(payload.gameId)

        if (!game) {
          throw new Error('Game not found')
        }

        const player = game.players.find((candidate) => candidate.id === payload.playerId)

        if (!player) {
          throw new Error('Player not found')
        }

        if (game.phase !== GamePhase.Waiting && player.chips !== 0) {
          throw new Error('Rebuy only allowed when busted')
        }

        if (game.phase !== GamePhase.Waiting && !isHandComplete(game)) {
          throw new Error('Rebuy only allowed between hands')
        }

        const nextGame = player.chips === 0 ? rebuyPlayer(game, payload.playerId) : game
        gameStore.set(nextGame.id, nextGame)
        await saveGame(nextGame)
        await broadcastGameState(io, nextGame)
      } catch (error) {
        emitSocketError(socket, error)
      }
    })
  })

  socket.on('disconnect', () => {
    const socketInfo = unregisterSocket(socket.id)

    if (!socketInfo) {
      return
    }

    void gameStore.withLock(socketInfo.gameId, async () => {
      try {
        const game = gameStore.get(socketInfo.gameId)

        if (!game) {
          return
        }

        const nextGame = markPlayerDisconnected(game, socketInfo.playerId)
        gameStore.set(nextGame.id, nextGame)

        await saveGame(nextGame)
        await broadcastGameState(io, nextGame)

        const disconnectedPlayerId = socketInfo.playerId
        const disconnectedGameId = socketInfo.gameId

        setTimeout(() => {
          void gameStore.withLock(disconnectedGameId, async () => {
            const latestGame = gameStore.get(disconnectedGameId)

            if (!latestGame) {
              return
            }

            const actingPlayer = getActingPlayer(latestGame)

            if (
              actingPlayer?.id !== disconnectedPlayerId ||
              !shouldAutoFoldDisconnected(latestGame, disconnectedPlayerId, Date.now(), DISCONNECT_AUTO_FOLD_DELAY_MS)
            ) {
              return
            }

            await autoFoldCurrentPlayerLocked(io, latestGame, disconnectedPlayerId)
          })
        }, DISCONNECT_AUTO_FOLD_DELAY_MS)
      } catch {
        return
      }
    })
  })
}
