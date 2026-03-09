/**
 * Socket.IO event handlers — the real-time bridge between clients and the game engine.
 *
 * All game mutations are funnelled through `gameStore.withLock(gameId, fn)` to
 * prevent concurrent updates from corrupting state (e.g., two players acting
 * simultaneously). Every handler follows the same pattern:
 *   1. Acquire the lock for the affected game.
 *   2. Load the current game state (from memory or DB via `getOrLoadGame`).
 *   3. Apply the mutation using pure engine functions.
 *   4. Persist the new state.
 *   5. Broadcast the updated state to all sockets in the game room.
 *
 * Socket events handled:
 *   - `join-game`    — Player joins or reconnects to an existing game
 *   - `start-game`   — Host starts the first hand
 *   - `player-action`— Fold / check / call / raise
 *   - `pause-game`   — Host pauses between hands
 *   - `resume-game`  — Host resumes
 *   - `rebuy`        — Busted player tops up their stack
 *   - `disconnect`   — Socket disconnects (may trigger auto-fold after 30 s)
 *
 * Timer architecture:
 *   - `timers`            — Per-game action countdown (auto-fold when it fires)
 *   - `disconnectTimers`  — Per-player grace period before auto-fold on disconnect
 *   - `nextHandTimers`    — Delay between hands (NEXT_HAND_DELAY_MS)
 */

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

// ---------------------------------------------------------------------------
// Module-level state (server process lifetime)
// ---------------------------------------------------------------------------

/** Per-game action countdown timers. Fires auto-fold when `config.timePerAction` elapses. */
const timers: Map<string, NodeJS.Timeout> = new Map()

/** Maps gameId → handId for the currently active hand. Cleared after each hand completes. */
const activeHandIds: Map<string, string> = new Map()

/** Monotonically increasing action order counter per game. Used for hand history ordering. */
const handActionOrder: Map<string, number> = new Map()

/** Per-player grace timers. If a disconnected player is the active actor, auto-fold fires after this delay. */
const disconnectTimers: Map<string, NodeJS.Timeout> = new Map()

/** Per-game delay before automatically starting the next hand after showdown. */
const nextHandTimers: Map<string, NodeJS.Timeout> = new Map()

const DISCONNECT_AUTO_FOLD_DELAY_MS = 30_000
const NEXT_HAND_DELAY_MS = 2_000

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Narrows PlayerState to guarantee hole cards are present (used at showdown). */
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

/** Emitted to all clients in the room when a hand concludes. */
type HandResultEvent = {
  gameId: string
  handNumber: number
  communityCards: GameState['communityCards']
  results: HandResult[]
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Unexpected server error'
}

/** Emits an `error` event to a single socket with a human-readable message. */
function emitSocketError(socket: Socket, error: unknown): void {
  socket.emit('error', { message: getErrorMessage(error) })
}

// ---------------------------------------------------------------------------
// Timer management
// ---------------------------------------------------------------------------

/** Cancels and removes the action countdown timer for a game (if any). */
function clearGameTimer(gameId: string): void {
  const timer = timers.get(gameId)

  if (timer) {
    clearTimeout(timer)
    timers.delete(gameId)
  }
}

/** Cancels and removes the next-hand delay timer for a game (if any). */
function clearNextHandTimer(gameId: string): void {
  const timer = nextHandTimers.get(gameId)

  if (timer) {
    clearTimeout(timer)
    nextHandTimers.delete(gameId)
  }
}

/**
 * Schedules automatic start of the next hand after `NEXT_HAND_DELAY_MS`.
 *
 * Guards against stale timers by checking that the game is still in Showdown
 * and not paused at the moment the timer fires. Idempotent — clears any
 * existing next-hand timer before scheduling a new one.
 */
function scheduleNextHand(io: Server, gameId: string): void {
  clearNextHandTimer(gameId)

  const timer = setTimeout(() => {
    void gameStore.withLock(gameId, async () => {
      const game = gameStore.get(gameId)

      if (!game || game.phase !== GamePhase.Showdown || game.isPaused) {
        return
      }

      try {
        let nextGame = startHand(game)
        nextGame = scheduleActionTimer(io, nextGame)
        gameStore.set(nextGame.id, nextGame)

        const handId = await saveHand(nextGame)
        activeHandIds.set(nextGame.id, handId)
        handActionOrder.set(nextGame.id, 0)

        await saveGame(nextGame)
        await broadcastGameState(io, nextGame)
      } catch {
        // If startHand throws (e.g., only one player has chips), stay in Showdown
      }
    })
  }, NEXT_HAND_DELAY_MS)

  nextHandTimers.set(gameId, timer)
}

// ---------------------------------------------------------------------------
// Game state helpers
// ---------------------------------------------------------------------------

/** Returns the player whose turn it is, or undefined if no one is to act. */
function getActingPlayer(game: GameState): PlayerState | undefined {
  if (game.activePlayerIndex < 0) {
    return undefined
  }

  return game.players[game.activePlayerIndex]
}

/** Clears both timer-related timestamp fields from a game state snapshot. */
function resetTimerState(game: GameState): GameState {
  return {
    ...game,
    timerStart: null,
    actionTimerStart: null,
  }
}

/**
 * Advances a game that is between rounds (no active player, hand not complete).
 * Used after an auto-fold resolves a street without explicit player input.
 *
 * - If we're on the River: go to showdown.
 * - Otherwise: deal the next community cards via `advancePhase`.
 */
function resolvePendingRound(game: GameState): GameState {
  if (game.activePlayerIndex !== -1 || isHandComplete(game)) {
    return game
  }

  if (game.phase === GamePhase.River) {
    return getShowdownResults(game)
  }

  return advancePhase(game)
}

/**
 * Returns all players who participated in the resolved hand.
 * Includes folded players and all-ins — anyone who put chips in or was dealt cards.
 */
function getPlayersInResolvedHand(game: GameState): PlayerState[] {
  return game.players.filter(
    (player) => player.holeCards !== null || player.totalBetThisHand > 0 || player.bet > 0 || player.isAllIn
  )
}

// ---------------------------------------------------------------------------
// Hand history helpers
// ---------------------------------------------------------------------------

/** Retrieves the active hand DB ID for a game, throwing if none is set. */
function getCurrentHandId(gameId: string): string {
  const handId = activeHandIds.get(gameId)

  if (!handId) {
    throw new Error('No active hand found for game')
  }

  return handId
}

/** Increments and returns the next action sequence number for a game. */
function getNextActionOrder(gameId: string): number {
  const nextOrder = (handActionOrder.get(gameId) ?? 0) + 1
  handActionOrder.set(gameId, nextOrder)
  return nextOrder
}

/**
 * Computes the final `HandResult` array by comparing chip counts before and after
 * the hand, evaluating non-folded hands, and reconstructing pot awards.
 *
 * `previousGame` is the state immediately before the last action; `resolvedGame`
 * is the post-showdown state with updated chip counts.
 */
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
    const chipDelta = previousPlayer ? player.chips - previousPlayer.chips : 0
    const evaluation = player.isFolded || player.holeCards === null
      ? null
      : evaluatedHands.get(player.id)?.evaluation ?? null

    return {
      playerId: player.id,
      holeCards: player.holeCards,
      evaluation,
      winnings,
      chipDelta,
      potAwards: potAwards.filter((potAward) => potAward.winnerIds.includes(player.id)).map((potAward) => ({
        potIndex: potAward.potIndex,
        amount: potAward.amount,
        winnerIds: potAward.winnerIds,
        handDescription: potAward.handDescription,
      })),
    }
  })
}

// ---------------------------------------------------------------------------
// Broadcast helpers
// ---------------------------------------------------------------------------

/**
 * Sends a personalised `game-state` event to every socket currently in the
 * game room. Each socket receives a view where their own hole cards are visible
 * but all other players' hole cards are hidden (unless it's showdown).
 */
async function broadcastGameState(io: Server, game: GameState): Promise<void> {
  const sockets = await io.in(game.id).fetchSockets()

  await Promise.all(
    sockets.map(async (roomSocket) => {
      try {
        const socketInfo = getSocketInfo(roomSocket.id)
        const playerId = socketInfo?.gameId === game.id ? socketInfo.playerId : ''
        roomSocket.emit('game-state', getPlayerView(game, playerId))
      } catch {
        // Ignore errors from individual sockets (e.g., socket disconnected mid-broadcast)
      }
    })
  )
}

/** Broadcasts a `hand-result` event to all sockets in the game room. */
async function emitHandResult(io: Server, event: HandResultEvent): Promise<void> {
  io.to(event.gameId).emit('hand-result', event)
}

/**
 * Saves hand results to the database and returns the `HandResultEvent` payload
 * ready to be emitted to clients.
 *
 * Clears `activeHandIds` and `handActionOrder` after persisting so the game
 * is ready for the next hand.
 */
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

// ---------------------------------------------------------------------------
// Auto-fold logic
// ---------------------------------------------------------------------------

/**
 * Auto-folds the current actor and advances game state.
 * Must be called while holding the game lock.
 *
 * Guards against stale timer callbacks by confirming the player who should be
 * auto-folded (`expectedPlayerId`) is still the active actor before proceeding.
 */
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
    scheduleNextHand(io, currentGame.id)
  }

  nextGame = scheduleActionTimer(io, nextGame)
  gameStore.set(nextGame.id, nextGame)
  await saveGame(nextGame)

  if (handResultEvent) {
    await emitHandResult(io, handResultEvent)
  }

  await broadcastGameState(io, nextGame)
}

/**
 * Schedules or resets the action countdown timer for the current actor.
 *
 * If `config.timePerAction <= 0`, the game has no timer and this is a no-op.
 * Otherwise, a `setTimeout` is registered; when it fires, `autoFoldCurrentPlayer`
 * is called to fold the acting player (if they haven't acted yet).
 *
 * Returns an updated GameState with `actionTimerStart` set (or null if no timer).
 */
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

/**
 * Acquires the game lock before calling `autoFoldCurrentPlayerLocked`.
 * This is the entry point for both timer-based and disconnect-based auto-folds.
 */
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

// ---------------------------------------------------------------------------
// Socket event registration
// ---------------------------------------------------------------------------

/**
 * Registers all Socket.IO event listeners for a new socket connection.
 * Called once per socket from the server entry point.
 */
export function registerSocketHandlers(io: Server, socket: Socket): void {
  /**
   * `join-game`: Player joins an existing game by seat index.
   *
   * If a `token` is provided and matches an existing player, the socket is
   * treated as a reconnection — the player's state is restored and no new
   * player record is created. Otherwise a new player is added to the game.
   *
   * The first player to join becomes the host (can start/pause/resume the game).
   */
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
            // Reconnection: cancel any pending disconnect timer for this player
            const pendingDisconnectTimer = disconnectTimers.get(existingPlayer.id)
            if (pendingDisconnectTimer) {
              clearTimeout(pendingDisconnectTimer)
              disconnectTimers.delete(existingPlayer.id)
            }
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
        // The first player to join becomes the host
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
        // Include the reconnection token in the join confirmation (stored client-side)
        socket.emit('joined', { playerId, token: player.token })
        socket.emit('game-state', getPlayerView(updatedGame, playerId))
        await broadcastGameState(io, updatedGame)
      } catch (error) {
        emitSocketError(socket, error)
      }
    })
  })

  /** `start-game`: Host starts the first hand. Restricted to the host player. */
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

  /**
   * `player-action`: A player makes a betting decision (fold/check/call/raise).
   *
   * After applying the action:
   * - If the hand is complete: persist results, schedule next hand.
   * - Otherwise: reset and restart the action timer for the next player.
   */
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
        const actionAmount = (payload.action.type === ActionType.Bet || payload.action.type === ActionType.Raise)
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
          scheduleNextHand(io, payload.gameId)
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

  /** `pause-game`: Host pauses the game. Clears all timers until resumed. */
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
        clearNextHandTimer(payload.gameId)

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

  /**
   * `resume-game`: Host resumes a paused game.
   * If the game is in Showdown, re-schedules the next hand.
   * Otherwise, restarts the action timer for the current actor.
   */
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

        if (nextGame.phase === GamePhase.Showdown) {
          scheduleNextHand(io, nextGame.id)
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

  /**
   * `rebuy`: A busted player reloads their stack to the starting amount.
   * Only allowed when the player has 0 chips and the hand is complete (or Waiting).
   */
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

  /**
   * `disconnect`: Socket connection lost.
   *
   * On disconnect:
   * 1. The player is marked as disconnected in game state.
   * 2. If the disconnected player was the host, the host role is reassigned to
   *    the next connected player.
   * 3. If all players disconnect, the game is evicted from memory after 5 minutes.
   * 4. A `DISCONNECT_AUTO_FOLD_DELAY_MS` timer is started. If the disconnected
   *    player is still the active actor when it fires, they are auto-folded.
   *    If they reconnect before it fires, the timer is cancelled.
   */
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

        let nextGame = markPlayerDisconnected(game, socketInfo.playerId)

        // Reassign host if needed
        if (nextGame.hostPlayerId === socketInfo.playerId) {
          const newHost = nextGame.players.find(
            p => p.id !== socketInfo.playerId && p.isConnected
          )
          if (newHost) {
            nextGame = { ...nextGame, hostPlayerId: newHost.id }
          }
        }

        gameStore.set(nextGame.id, nextGame)
        await saveGame(nextGame)
        await broadcastGameState(io, nextGame)

        const disconnectedPlayerId = socketInfo.playerId
        const disconnectedGameId = socketInfo.gameId

        // Evict the game from memory after 5 minutes if all players are gone
        if (nextGame.players.every(p => !p.isConnected)) {
          setTimeout(() => {
            const latestGame = gameStore.get(disconnectedGameId)
            if (latestGame && latestGame.players.every(p => !p.isConnected)) {
              gameStore.delete(disconnectedGameId)
            }
          }, 5 * 60 * 1000)
        }

        // Cancel any existing disconnect timer for this player
        const existingDisconnectTimer = disconnectTimers.get(disconnectedPlayerId)
        if (existingDisconnectTimer) {
          clearTimeout(existingDisconnectTimer)
        }

        const disconnectTimer = setTimeout(() => {
          disconnectTimers.delete(disconnectedPlayerId)
          void gameStore.withLock(disconnectedGameId, async () => {
            const latestGame = gameStore.get(disconnectedGameId)
            if (!latestGame) return
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

        disconnectTimers.set(disconnectedPlayerId, disconnectTimer)
      } catch {
        return
      }
    })
  })
}
