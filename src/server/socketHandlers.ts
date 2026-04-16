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
 *   - `nextHandTimers`    — Delay between hands (per-game config)
 */

import { Server, Socket } from 'socket.io'
import { randomUUID } from 'crypto'

import {
  advanceRunout,
  getPlayerView,
  handleAction,
  isHandComplete,
  resetGame,
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
import { startActionTimer } from '../engine/timeout'
import { awardPots, calculatePots } from '../engine/potCalculator'
import { evaluateHandWithRaw } from '../engine/handEvaluator'

import {
  ActionType,
  Card,
  CompletedHandBoard,
  GamePhase,
  GameState,
  HandResult,
  HandResultBoard,
  PotAward,
  PlayerAction,
  PlayerState,
} from '../engine/types'
import {
  saveGame,
  saveGameWithRebuy,
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

/** Per-game timers for advancing community cards one street at a time during all-in runouts. */
const runoutTimers: Map<string, NodeJS.Timeout> = new Map()

const chatRateLimits = new Map<string, { count: number; windowStart: number }>()

const DISCONNECT_AUTO_FOLD_DELAY_MS = 30_000
const RUNOUT_DELAY_MS = process.env.NODE_ENV === 'test' ? 50 : 1500
const CHAT_RATE_LIMIT_WINDOW_MS = 10_000
const CHAT_RATE_LIMIT_MAX_MESSAGES = 5
const CHAT_MAX_CUSTOM_MESSAGE_LENGTH = 200
const CHAT_REACTIONS = ['Nice hand!', 'GG', 'Well played', 'LOL', 'Unlucky'] as const

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Narrows PlayerState to guarantee hole cards are present (used at showdown). */
type PlayerWithCards = PlayerState & { holeCards: [Card, Card] }

type JoinGamePayload = {
  gameId: string
  displayName: string
  seatIndex?: number
  spectator?: boolean
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

type ChatMessagePayload = {
  gameId: string
  senderId: string
  senderName: string
  text: string
  type: 'custom' | 'reaction'
}

/** Emitted to all clients in the room when a hand concludes. */
type HandResultEvent = {
  gameId: string
  handNumber: number
  boards: CompletedHandBoard[]
  results: HandResult[]
}

type RunItTwiceStartedEvent = {
  gameId: string
}

type RunItTwiceDecisionStartedEvent = {
  gameId: string
  playerIds: string[]
}

type RunItTwiceDecisionUpdatedEvent = {
  gameId: string
  playerId: string
  agree: boolean
}

type BoardResultEvent = {
  gameId: string
  runIndex: 0 | 1
  board: Card[]
  potAwards: PotAward[]
}

type RunItTwiceDecisionPayload = {
  gameId: string
  playerId: string
  agree: boolean
}

type UpdateConfigPayload = {
  gameId: string
  playerId: string
  config: Partial<GameState['config']>
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

/** Cancels and removes the board runout timer for a game (if any). */
function clearRunoutTimer(gameId: string): void {
  const timer = runoutTimers.get(gameId)

  if (timer) {
    clearTimeout(timer)
    runoutTimers.delete(gameId)
  }
}

/**
 * Schedules automatic start of the next hand after the game's configured delay.
 *
 * Guards against stale timers by checking that the game is still in Showdown
 * and not paused at the moment the timer fires. Idempotent — clears any
 * existing next-hand timer before scheduling a new one.
 */
function scheduleNextHand(io: Server, gameId: string): void {
  clearNextHandTimer(gameId)

  const game = gameStore.get(gameId)
  const nextHandDelayMs = (game?.config.betweenHandsDelay ?? 3) * 1000

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
  }, nextHandDelayMs)

  nextHandTimers.set(gameId, timer)
}

function scheduleRunoutAdvance(io: Server, gameId: string): void {
  clearRunoutTimer(gameId)

  const timer = setTimeout(() => {
    void advanceRunoutLocked(io, gameId)
  }, RUNOUT_DELAY_MS)

  runoutTimers.set(gameId, timer)
}

async function advanceRunoutLocked(io: Server, gameId: string): Promise<void> {
  await gameStore.withLock(gameId, async () => {
    try {
      const game = gameStore.get(gameId)

      if (!game || game.isPaused) return

      const nextGame = advanceRunout(game)
      const boardResultEvent = getBoardResultEvent(game, nextGame)
      gameStore.set(nextGame.id, nextGame)
      await saveGame(nextGame)

      await broadcastGameState(io, nextGame)

      if (boardResultEvent) {
        await emitBoardResult(io, boardResultEvent)
      }

      if (isHandComplete(nextGame)) {
        const handResultEvent = await persistCompletedHand(gameId, game, nextGame)
        scheduleNextHand(io, gameId)
        await emitHandResult(io, handResultEvent)
      } else {
        scheduleRunoutAdvance(io, gameId)
      }
    } catch (err) {
      console.error(`[runout] ${gameId}: error in advanceRunoutLocked:`, err)
    }
  })
}

// ---------------------------------------------------------------------------
// Game state helpers
// ---------------------------------------------------------------------------

/** Returns the player whose turn it is, or undefined if no one is to act. */
function getActingPlayer(game: GameState): PlayerState | undefined {
  if (game.activePlayerIndex < 0) {
    return undefined
  }

  return game.players.find(p => p.seatIndex === game.activePlayerIndex)
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
 * Returns all players who participated in the resolved hand.
 * Includes folded players and all-ins — anyone who put chips in or was dealt cards.
 */
function getPlayersInResolvedHand(game: GameState): PlayerState[] {
  return game.players.filter(
    (player) => player.holeCards !== null || player.totalBetThisHand > 0 || player.bet > 0 || player.isAllIn
  )
}

function getUncontestedWinner(game: GameState): PlayerState | null {
  const remainingPlayers = getPlayersInResolvedHand(game).filter((player) => !player.isFolded)
  return remainingPlayers.length === 1 ? remainingPlayers[0] : null
}

function buildCompletedHandBoards(game: GameState): CompletedHandBoard[] {
  if (game.runItTwiceEligible && game.firstBoard && game.secondBoard) {
    return [
      { runIndex: 0, communityCards: game.firstBoard },
      { runIndex: 1, communityCards: game.secondBoard },
    ]
  }

  return [{ runIndex: 0, communityCards: game.communityCards }]
}

function getTotalPotFromResolvedPlayers(players: PlayerState[]): number {
  return players.reduce((sum, player) => sum + player.totalBetThisHand, 0)
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
  const boards = buildCompletedHandBoards(resolvedGame)
  const boardResultsByRunIndex = new Map<
    number,
    {
      evaluatedHands: Map<string, { evaluation: HandResultBoard['evaluation']; rawHand: ReturnType<typeof evaluateHandWithRaw>['rawHand'] }>
      potAwards: PotAward[]
    }
  >()

  for (const board of boards) {
    const evaluatedHands = new Map(
      resolvedPlayers
        .filter((player): player is PlayerWithCards => {
          return !player.isFolded && player.holeCards !== null
        })
        .map((player) => {
          const { evaluation, rawHand } = evaluateHandWithRaw(player.holeCards, board.communityCards)

          return [
            player.id,
            {
              evaluation,
              rawHand,
            },
          ] as const
        })
    )

    const potAwards = boards.length === 1
      ? (pots.length === 0
          ? []
          : awardPots(
              pots,
              new Map(
                Array.from(evaluatedHands.entries()).map(([playerId, hand]) => [
                  playerId,
                  {
                    rank: hand.evaluation?.rank ?? null,
                    description: hand.evaluation?.description ?? null,
                    raw: hand.rawHand,
                  },
                ])
              )
            ))
      : buildRunItTwiceBoardAwards(resolvedGame, board.communityCards, board.runIndex)

    boardResultsByRunIndex.set(board.runIndex, {
      evaluatedHands,
      potAwards,
    })
  }

  const potAwards = Array.from(boardResultsByRunIndex.values()).flatMap((boardResult) => boardResult.potAwards)

  return resolvedPlayers.map((player) => {
    const previousPlayer = previousPlayersById.get(player.id)
    const winnings = previousPlayer ? Math.max(0, player.chips - previousPlayer.chips) : 0
    const chipDelta = previousPlayer ? player.chips - previousPlayer.chips : 0
    const boardResults = boards.map<HandResultBoard>((board) => {
      const boardData = boardResultsByRunIndex.get(board.runIndex)
      const boardPotAwards = boardData?.potAwards.filter((potAward) => potAward.winnerIds.includes(player.id)) ?? []

      return {
        runIndex: board.runIndex,
        evaluation: player.isFolded || player.holeCards === null
          ? null
          : boardData?.evaluatedHands.get(player.id)?.evaluation ?? null,
        winnings: boardPotAwards.reduce((sum, award) => sum + award.amount, 0),
        potAwards: boardPotAwards.map((potAward) => ({
          potIndex: potAward.potIndex,
          runIndex: potAward.runIndex,
          amount: potAward.amount,
          winnerIds: potAward.winnerIds,
          handDescription: potAward.handDescription,
        })),
      }
    })
    const evaluation = boardResults.length === 1 ? boardResults[0].evaluation : null

    return {
      playerId: player.id,
      holeCards: player.holeCards,
      evaluation,
      winnings,
      chipDelta,
      potAwards: potAwards.filter((potAward) => potAward.winnerIds.includes(player.id)).map((potAward) => ({
        potIndex: potAward.potIndex,
        runIndex: potAward.runIndex,
        amount: potAward.amount,
        winnerIds: potAward.winnerIds,
        handDescription: potAward.handDescription,
      })),
      boardResults,
    }
  })
}

function emitRunItTwiceReplayEvents(socket: Socket, game: GameState): void {
  if (!game.runItTwiceEligible) {
    return
  }

  socket.emit('runItTwiceStarted', { gameId: game.id })

  if (game.firstBoard && (game.currentRunIndex === 1 || game.phase === GamePhase.Showdown)) {
    socket.emit('boardResult', {
      gameId: game.id,
      runIndex: 0,
      board: game.firstBoard,
      potAwards: buildRunItTwiceBoardAwards(game, game.firstBoard, 0),
    })
  }

  if (game.secondBoard && game.phase === GamePhase.Showdown) {
    socket.emit('boardResult', {
      gameId: game.id,
      runIndex: 1,
      board: game.secondBoard,
      potAwards: buildRunItTwiceBoardAwards(game, game.secondBoard, 1),
    })
  }
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
        const playerId = socketInfo?.gameId === game.id && !socketInfo.isSpectator
          ? (socketInfo.playerId ?? '')
          : ''
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

async function emitRunItTwiceStarted(io: Server, event: RunItTwiceStartedEvent): Promise<void> {
  io.to(event.gameId).emit('runItTwiceStarted', event)
}

async function emitRunItTwiceDecisionStarted(io: Server, event: RunItTwiceDecisionStartedEvent): Promise<void> {
  console.info('[RIT] decision-started emit', event)
  io.to(event.gameId).emit('runItTwiceDecisionStarted', event)
}

async function emitRunItTwiceDecisionUpdated(io: Server, event: RunItTwiceDecisionUpdatedEvent): Promise<void> {
  console.info('[RIT] decision-updated emit', event)
  io.to(event.gameId).emit('runItTwiceDecisionUpdated', event)
}

async function emitBoardResult(io: Server, event: BoardResultEvent): Promise<void> {
  io.to(event.gameId).emit('boardResult', event)
}

function buildRunItTwiceBoardAwards(game: GameState, board: Card[], runIndex: 0 | 1): PotAward[] {
  const handPlayers = getPlayersInResolvedHand(game)
  const potPlayers = handPlayers.map((player) => ({
    ...player,
    bet: player.totalBetThisHand,
  }))
  const pots = calculatePots(potPlayers)
  const runPots = pots.map((pot) => ({
    ...pot,
    amount: runIndex === 0 ? Math.ceil(pot.amount / 2) : Math.floor(pot.amount / 2),
  }))

  if (runPots.length === 0) {
    return []
  }

  const evaluatedHands = new Map(
    handPlayers
      .filter((player): player is PlayerWithCards => {
        return !player.isFolded && player.holeCards !== null
      })
      .map((player) => {
        const { evaluation, rawHand } = evaluateHandWithRaw(player.holeCards, board)
        return [
          player.id,
          {
            rank: evaluation.rank,
            description: evaluation.description,
            raw: rawHand,
          },
        ] as const
      })
  )

  return awardPots(runPots, evaluatedHands).map((award) => ({
    ...award,
    runIndex,
  }))
}

function getDecisionPlayerIds(game: GameState): string[] {
  return Object.keys(game.runItTwiceVotes)
}

function resolveRunItTwiceDecision(game: GameState, playerId: string, agree: boolean): {
  nextGame: GameState
  decisionCompleted: boolean
  startRunout: boolean
} {
  const vote = game.runItTwiceVotes[playerId]

  if (!game.runItTwiceDecisionPending || vote === undefined) {
    throw new Error('No Run It Twice decision pending for this player')
  }

  if (vote !== null) {
    throw new Error('Run It Twice decision already submitted')
  }

  const updatedVotes = {
    ...game.runItTwiceVotes,
    [playerId]: agree,
  }

  if (!agree) {
    return {
      nextGame: {
        ...game,
        runItTwiceDecisionPending: false,
        runItTwiceEligible: false,
        runItTwiceVotes: updatedVotes,
        currentRunIndex: null,
        runoutStartPhase: null,
        runoutPhase: null,
        firstBoard: null,
        secondBoard: null,
        activePlayerIndex: -1,
        timerStart: null,
        actionTimerStart: null,
      },
      decisionCompleted: true,
      startRunout: true,
    }
  }

  const allAgreed = Object.values(updatedVotes).every((value) => value === true)

  if (!allAgreed) {
    return {
      nextGame: {
        ...game,
        runItTwiceVotes: updatedVotes,
      },
      decisionCompleted: false,
      startRunout: false,
    }
  }

  return {
    nextGame: {
      ...game,
      runItTwiceDecisionPending: false,
      runItTwiceEligible: true,
      runItTwiceVotes: updatedVotes,
      currentRunIndex: 0,
      runoutStartPhase: game.phase,
      runoutPhase: game.phase,
      firstBoard: null,
      secondBoard: null,
      activePlayerIndex: -1,
      timerStart: null,
      actionTimerStart: null,
    },
    decisionCompleted: true,
    startRunout: true,
  }
}

async function applyRunItTwiceDecisionLocked(
  io: Server,
  game: GameState,
  playerId: string,
  agree: boolean,
): Promise<GameState> {
  const { nextGame, decisionCompleted, startRunout } = resolveRunItTwiceDecision(
    game,
    playerId,
    agree,
  )

  gameStore.set(nextGame.id, nextGame)
  await saveGame(nextGame)

  await emitRunItTwiceDecisionUpdated(io, {
    gameId: nextGame.id,
    playerId,
    agree,
  })

  if (decisionCompleted && nextGame.runItTwiceEligible) {
    await emitRunItTwiceStarted(io, { gameId: nextGame.id })
  }

  await broadcastGameState(io, nextGame)

  if (decisionCompleted && startRunout) {
    scheduleRunoutAdvance(io, nextGame.id)
  }

  return nextGame
}

function getBoardResultEvent(previousGame: GameState, nextGame: GameState): BoardResultEvent | null {
  if (!nextGame.runItTwiceEligible) {
    return null
  }

  if (previousGame.currentRunIndex === 0 && nextGame.currentRunIndex === 1 && nextGame.firstBoard) {
    return {
      gameId: nextGame.id,
      runIndex: 0,
      board: nextGame.firstBoard,
      potAwards: buildRunItTwiceBoardAwards(nextGame, nextGame.firstBoard, 0),
    }
  }

  if (previousGame.currentRunIndex === 1 && nextGame.phase === GamePhase.Showdown && nextGame.secondBoard) {
    return {
      gameId: nextGame.id,
      runIndex: 1,
      board: nextGame.secondBoard,
      potAwards: buildRunItTwiceBoardAwards(nextGame, nextGame.secondBoard, 1),
    }
  }

  return null
}

function emitRunItTwiceDecisionReplayEvents(socket: Socket, game: GameState): void {
  if (!game.runItTwiceDecisionPending) {
    return
  }

  const playerIds = getDecisionPlayerIds(game)
  socket.emit('runItTwiceDecisionStarted', { gameId: game.id, playerIds })

  playerIds.forEach((playerId) => {
    const vote = game.runItTwiceVotes[playerId]
    if (vote === null) {
      return
    }

    socket.emit('runItTwiceDecisionUpdated', {
      gameId: game.id,
      playerId,
      agree: vote,
    })
  })
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
  const resolvedPlayers = getPlayersInResolvedHand(resolvedGame)
  const boards = buildCompletedHandBoards(resolvedGame)
  const results = buildHandResults(previousGame, resolvedGame)

  await saveHandResults(
    handId,
    {
      communityCards: resolvedGame.communityCards,
      boards,
      potTotal: getTotalPotFromResolvedPlayers(resolvedPlayers),
    },
    results,
  )
  activeHandIds.delete(gameId)
  handActionOrder.delete(gameId)

  return {
    gameId: resolvedGame.id,
    handNumber: resolvedGame.handNumber,
    boards,
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

  const actionResult = handleAction(currentGame, expectedPlayerId, { type: ActionType.Fold })
  let nextGame = actionResult.game
  let handResultEvent: HandResultEvent | undefined
  let runItTwiceStartedEvent: RunItTwiceStartedEvent | undefined
  let runItTwiceDecisionStartedEvent: RunItTwiceDecisionStartedEvent | undefined
  const handId = getCurrentHandId(currentGame.id)

  await saveHandAction(
    handId,
    expectedPlayerId,
    currentGame.phase,
    ActionType.Fold,
    null,
    getNextActionOrder(currentGame.id)
  )

  if (nextGame.runItTwiceDecisionPending && !currentGame.runItTwiceDecisionPending) {
    runItTwiceDecisionStartedEvent = {
      gameId: nextGame.id,
      playerIds: getDecisionPlayerIds(nextGame),
    }
  }

  if (actionResult.kind === 'showdown') {
    handResultEvent = await persistCompletedHand(currentGame.id, currentGame, nextGame)
    scheduleNextHand(io, currentGame.id)
  } else if (actionResult.kind === 'runout') {
    if (!currentGame.runItTwiceEligible && nextGame.runItTwiceEligible) {
      runItTwiceStartedEvent = { gameId: nextGame.id }
    }
    scheduleRunoutAdvance(io, currentGame.id)
  }

  nextGame = scheduleActionTimer(io, nextGame)
  gameStore.set(nextGame.id, nextGame)
  await saveGame(nextGame)

  if (handResultEvent) {
    await emitHandResult(io, handResultEvent)
  }

  if (runItTwiceStartedEvent) {
    await emitRunItTwiceStarted(io, runItTwiceStartedEvent)
  }

  if (runItTwiceDecisionStartedEvent) {
    await emitRunItTwiceDecisionStarted(io, runItTwiceDecisionStartedEvent)
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

        if (payload.spectator) {
          const spectatorId = randomUUID()
          const updatedGame: GameState = {
            ...game,
            spectators: [...game.spectators, { id: spectatorId, displayName: payload.displayName }],
          }

          gameStore.set(updatedGame.id, updatedGame)
          registerSocket(socket.id, { gameId: updatedGame.id, spectatorId, isSpectator: true })
          await saveGame(updatedGame)
          socket.emit('joined', { spectatorId })
          socket.emit('game-state', getPlayerView(updatedGame, ''))
          emitRunItTwiceDecisionReplayEvents(socket, updatedGame)
          emitRunItTwiceReplayEvents(socket, updatedGame)
          await broadcastGameState(io, updatedGame)
          return
        }

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
            registerSocket(socket.id, {
              gameId: updatedGame.id,
              playerId: existingPlayer.id,
              isSpectator: false,
            })
            await saveGame(updatedGame)
            socket.emit('joined', { playerId: existingPlayer.id })
            socket.emit('game-state', getPlayerView(updatedGame, existingPlayer.id))
            emitRunItTwiceDecisionReplayEvents(socket, updatedGame)
            emitRunItTwiceReplayEvents(socket, updatedGame)
            await broadcastGameState(io, updatedGame)
            return
          }
        }

        if (payload.seatIndex === undefined) {
          throw new Error('Seat index is required')
        }

        if (game.phase !== GamePhase.Waiting) {
          throw new Error('Cannot join a game that is already in progress')
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
        registerSocket(socket.id, {
          gameId: updatedGame.id,
          playerId,
          isSpectator: false,
        })

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

        const socketInfo = getSocketInfo(socket.id)
        if (socketInfo?.gameId === payload.gameId && socketInfo.isSpectator) {
          throw new Error('Spectators cannot start games')
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

        const socketInfo = getSocketInfo(socket.id)
        if (socketInfo?.gameId === payload.gameId && socketInfo.isSpectator) {
          throw new Error('Spectators cannot perform actions')
        }

        clearGameTimer(payload.gameId)

        const actionResult = handleAction(game, payload.playerId, payload.action)
        let nextGame = actionResult.game
        let handResultEvent: HandResultEvent | undefined
        let runItTwiceStartedEvent: RunItTwiceStartedEvent | undefined
        let runItTwiceDecisionStartedEvent: RunItTwiceDecisionStartedEvent | undefined
        const handId = getCurrentHandId(payload.gameId)
        const actionAmount = (payload.action.type === ActionType.Bet || payload.action.type === ActionType.Raise)
          ? payload.action.amount
          : null

        console.info('[RIT] player-action handled', {
          gameId: payload.gameId,
          playerId: payload.playerId,
          actionType: payload.action.type,
          kind: actionResult.kind,
          phaseBefore: game.phase,
          phaseAfter: nextGame.phase,
          activePlayerAfter: nextGame.activePlayerIndex,
          runItTwiceEnabled: nextGame.config.runItTwice,
          decisionPendingAfter: nextGame.runItTwiceDecisionPending,
          eligibleAfter: nextGame.runItTwiceEligible,
          votesAfter: nextGame.runItTwiceVotes,
        })

        await saveHandAction(
          handId,
          payload.playerId,
          game.phase,
          payload.action.type,
          actionAmount,
          getNextActionOrder(payload.gameId)
        )

        if (nextGame.runItTwiceDecisionPending && !game.runItTwiceDecisionPending) {
          runItTwiceDecisionStartedEvent = {
            gameId: nextGame.id,
            playerIds: getDecisionPlayerIds(nextGame),
          }
        }

        if (actionResult.kind === 'showdown') {
          handResultEvent = await persistCompletedHand(payload.gameId, game, nextGame)
          scheduleNextHand(io, payload.gameId)
        } else if (actionResult.kind === 'runout') {
          if (!game.runItTwiceEligible && nextGame.runItTwiceEligible) {
            runItTwiceStartedEvent = { gameId: nextGame.id }
          }
          scheduleRunoutAdvance(io, payload.gameId)
        }

        nextGame = scheduleActionTimer(io, nextGame)
        gameStore.set(nextGame.id, nextGame)

        await saveGame(nextGame)

        if (handResultEvent) {
          await emitHandResult(io, handResultEvent)
        }

        if (runItTwiceStartedEvent) {
          await emitRunItTwiceStarted(io, runItTwiceStartedEvent)
        }

        if (runItTwiceDecisionStartedEvent) {
          await emitRunItTwiceDecisionStarted(io, runItTwiceDecisionStartedEvent)
        }

        if (nextGame.runItTwiceDecisionPending) {
          console.info('[RIT] broadcasting decision-pending game-state', {
            gameId: nextGame.id,
            phase: nextGame.phase,
            activePlayerIndex: nextGame.activePlayerIndex,
            votes: nextGame.runItTwiceVotes,
          })
        }

        await broadcastGameState(io, nextGame)
      } catch (error) {
        emitSocketError(socket, error)
      }
    })
  })

  socket.on('run-it-twice-decision', (payload: RunItTwiceDecisionPayload) => {
    void gameStore.withLock(payload.gameId, async () => {
      try {
        const game = await getOrLoadGame(payload.gameId)

        if (!game) {
          throw new Error('Game not found')
        }

        const socketInfo = getSocketInfo(socket.id)
        if (socketInfo?.gameId === payload.gameId && socketInfo.isSpectator) {
          throw new Error('Spectators cannot vote on Run It Twice')
        }

        const socketPlayerId = socketInfo?.gameId === payload.gameId ? socketInfo.playerId : undefined
        if (!socketPlayerId || socketPlayerId !== payload.playerId) {
          throw new Error('Invalid Run It Twice decision sender')
        }

        const actingPlayer = game.players.find((player) => player.id === payload.playerId)
        if (!actingPlayer) {
          throw new Error('Player not found')
        }

        if (!actingPlayer.isConnected) {
          throw new Error('Disconnected players cannot vote on Run It Twice')
        }

        const { nextGame, decisionCompleted, startRunout } = resolveRunItTwiceDecision(
          game,
          payload.playerId,
          payload.agree,
        )

        console.info('[RIT] decision received', {
          gameId: payload.gameId,
          playerId: payload.playerId,
          agree: payload.agree,
          decisionCompleted,
          startRunout,
          eligibleAfter: nextGame.runItTwiceEligible,
          votesAfter: nextGame.runItTwiceVotes,
        })

        await applyRunItTwiceDecisionLocked(io, game, payload.playerId, payload.agree)
      } catch (error) {
        emitSocketError(socket, error)
      }
    })
  })

  socket.on('update-config', (payload: UpdateConfigPayload) => {
    void gameStore.withLock(payload.gameId, async () => {
      try {
        const game = await getOrLoadGame(payload.gameId)

        if (!game) {
          throw new Error('Game not found')
        }

        const socketInfo = getSocketInfo(socket.id)
        if (socketInfo?.gameId === payload.gameId && socketInfo.isSpectator) {
          throw new Error('Spectators cannot update config')
        }

        if (payload.playerId !== game.hostPlayerId) {
          throw new Error('Only the host can update config')
        }

        const nextConfig = {
          ...game.config,
          ...payload.config,
          runItTwice: typeof payload.config.runItTwice === 'boolean'
            ? payload.config.runItTwice
            : game.config.runItTwice,
        }

        if (game.phase !== GamePhase.Waiting && payload.config.runItTwice !== undefined) {
          console.info('[RIT] update-config during active hand: defer until next hand semantics expected', {
            gameId: game.id,
            runItTwiceBefore: game.config.runItTwice,
            requestedRunItTwice: payload.config.runItTwice,
            phase: game.phase,
          })
        }

        const nextGame = {
          ...game,
          config: nextConfig,
        }

        console.info('[RIT] config-updated', {
          gameId: game.id,
          byPlayerId: payload.playerId,
          runItTwiceBefore: game.config.runItTwice,
          runItTwiceAfter: nextGame.config.runItTwice,
          phase: game.phase,
        })

        gameStore.set(nextGame.id, nextGame)
        await saveGame(nextGame)
        await broadcastGameState(io, nextGame)
      } catch (error) {
        emitSocketError(socket, error)
      }
    })
  })

  socket.on('chat-message', (payload: ChatMessagePayload) => {
    void (async () => {
      try {
        const game = await getOrLoadGame(payload.gameId)

        if (!game) {
          throw new Error('Game not found')
        }

        const normalizedText = payload.text.trim()
        const normalizedSenderName = payload.senderName.trim()
        const senderId = payload.senderId.trim()

        if (!normalizedText) {
          throw new Error('Message cannot be empty')
        }

        if (!senderId) {
          throw new Error('Sender ID is required')
        }

        if (!normalizedSenderName) {
          throw new Error('Sender name is required')
        }

        if (payload.type === 'custom') {
          if (normalizedText.length > CHAT_MAX_CUSTOM_MESSAGE_LENGTH) {
            throw new Error(`Custom messages cannot exceed ${CHAT_MAX_CUSTOM_MESSAGE_LENGTH} characters`)
          }
        } else if (!CHAT_REACTIONS.includes(normalizedText as (typeof CHAT_REACTIONS)[number])) {
          throw new Error('Invalid reaction')
        }

        const now = Date.now()
        const currentRateLimit = chatRateLimits.get(senderId)

        if (!currentRateLimit || now - currentRateLimit.windowStart >= CHAT_RATE_LIMIT_WINDOW_MS) {
          chatRateLimits.set(senderId, { count: 1, windowStart: now })
        } else {
          if (currentRateLimit.count >= CHAT_RATE_LIMIT_MAX_MESSAGES) {
            throw new Error('Too many chat messages. Please wait a moment before sending more.')
          }

          chatRateLimits.set(senderId, {
            count: currentRateLimit.count + 1,
            windowStart: currentRateLimit.windowStart,
          })
        }

        io.to(payload.gameId).emit('chat-broadcast', {
          id: crypto.randomUUID(),
          gameId: payload.gameId,
          senderId,
          senderName: normalizedSenderName,
          text: normalizedText,
          type: payload.type,
          timestamp: now,
        })
      } catch (error) {
        emitSocketError(socket, error)
      }
    })()
  })

  socket.on('show-cards', (payload: GamePlayerPayload) => {
    void gameStore.withLock(payload.gameId, async () => {
      try {
        const game = await getOrLoadGame(payload.gameId)

        if (!game) {
          throw new Error('Game not found')
        }

        if (game.phase !== GamePhase.Showdown || !isHandComplete(game)) {
          throw new Error('Cards can only be shown after a hand has ended')
        }

        const winner = getUncontestedWinner(game)

        if (!winner) {
          throw new Error('Cards can only be shown after an uncontested win')
        }

        if (winner.id !== payload.playerId) {
          throw new Error('Only the hand winner can show cards')
        }

        const nextGame: GameState = {
          ...game,
          shownCards: {
            ...game.shownCards,
            [payload.playerId]: true,
          },
        }

        gameStore.set(nextGame.id, nextGame)
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

        const socketInfo = getSocketInfo(socket.id)
        if (socketInfo?.gameId === payload.gameId && socketInfo.isSpectator) {
          throw new Error('Spectators cannot pause games')
        }

        if (payload.playerId !== game.hostPlayerId) {
          throw new Error('Only the host can pause the game')
        }

        clearGameTimer(payload.gameId)
        clearNextHandTimer(payload.gameId)
        clearRunoutTimer(payload.gameId)

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

        const socketInfo = getSocketInfo(socket.id)
        if (socketInfo?.gameId === payload.gameId && socketInfo.isSpectator) {
          throw new Error('Spectators cannot resume games')
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
        } else if (
          nextGame.activePlayerIndex === -1 &&
          !isHandComplete(nextGame) &&
          (nextGame.runoutPhase !== null || nextGame.currentRunIndex !== null)
        ) {
          scheduleRunoutAdvance(io, nextGame.id)
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

  socket.on('reset-game', (payload: GamePlayerPayload) => {
    void gameStore.withLock(payload.gameId, async () => {
      try {
        const game = await getOrLoadGame(payload.gameId)

        if (!game) {
          throw new Error('Game not found')
        }

        if (payload.playerId !== game.hostPlayerId) {
          throw new Error('Only the host can reset the game')
        }

        clearGameTimer(payload.gameId)
        clearNextHandTimer(payload.gameId)
        clearRunoutTimer(payload.gameId)

        const nextGame = resetGame(game)

        gameStore.set(nextGame.id, nextGame)
        activeHandIds.delete(nextGame.id)
        handActionOrder.delete(nextGame.id)
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

        const socketInfo = getSocketInfo(socket.id)
        if (socketInfo?.gameId === payload.gameId && socketInfo.isSpectator) {
          throw new Error('Spectators cannot rebuy')
        }

        const player = game.players.find((candidate) => candidate.id === payload.playerId)

        if (!player) {
          throw new Error('Player not found')
        }

        if (player.chips >= game.config.startingStack) {
          throw new Error('Already at or above starting stack')
        }

        if (game.phase !== GamePhase.Waiting && !isHandComplete(game)) {
          throw new Error('Rebuy only allowed between hands')
        }

        const rebuyAmount = game.config.startingStack - player.chips
        const nextGame = rebuyPlayer(game, payload.playerId)
        gameStore.set(nextGame.id, nextGame)
        await saveGameWithRebuy(nextGame, payload.playerId, rebuyAmount)
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

        if (socketInfo.isSpectator) {
          if (!socketInfo.spectatorId) {
            return
          }

          const nextGame: GameState = {
            ...game,
            spectators: game.spectators.filter((spectator) => spectator.id !== socketInfo.spectatorId),
          }

          gameStore.set(nextGame.id, nextGame)
          await saveGame(nextGame)
          await broadcastGameState(io, nextGame)
          return
        }

        if (!socketInfo.playerId) {
          return
        }

        const disconnectedPlayerId = socketInfo.playerId
        let nextGame = markPlayerDisconnected(game, disconnectedPlayerId)

        // Reassign host if needed
        if (nextGame.hostPlayerId === disconnectedPlayerId) {
          const newHost = nextGame.players.find(
            p => p.id !== disconnectedPlayerId && p.isConnected
          )
          if (newHost) {
            nextGame = { ...nextGame, hostPlayerId: newHost.id }
          }
        }

        const disconnectedGameId = socketInfo.gameId

        // Cancel any existing disconnect timer for this player
        const existingDisconnectTimer = disconnectTimers.get(disconnectedPlayerId)
        if (existingDisconnectTimer) {
          clearTimeout(existingDisconnectTimer)
        }

        const pendingVote = nextGame.runItTwiceVotes[disconnectedPlayerId]

        if (nextGame.runItTwiceDecisionPending && pendingVote === null) {
          await applyRunItTwiceDecisionLocked(io, nextGame, disconnectedPlayerId, false)
          return
        }

        gameStore.set(nextGame.id, nextGame)
        await saveGame(nextGame)
        await broadcastGameState(io, nextGame)

        // Evict the game from memory after 5 minutes if all players are gone
        if (nextGame.players.every(p => !p.isConnected)) {
          setTimeout(() => {
            const latestGame = gameStore.get(disconnectedGameId)
            if (latestGame && latestGame.players.every(p => !p.isConnected)) {
              gameStore.delete(disconnectedGameId)
            }
          }, 5 * 60 * 1000)
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
