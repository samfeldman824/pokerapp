import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/persistence', () => ({
  saveGame: vi.fn(),
  saveGameWithRebuy: vi.fn(),
  savePlayer: vi.fn(),
  saveHand: vi.fn().mockResolvedValue('hand-id'),
  saveHandAction: vi.fn(),
  saveHandResults: vi.fn(),
  loadPersistedGame: vi.fn().mockResolvedValue(null),
}))

import { randomUUID } from 'crypto'
import { createServer, type Server as HttpServer } from 'http'
import type { AddressInfo } from 'net'
import { Server } from 'socket.io'
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client'

import { createGame } from '../engine/gameController'
import { DEFAULT_CONFIG } from '../engine/constants'
import { ActionType, GamePhase, type ClientGameState, type GameConfig, type HandResult, type PlayerAction } from '../engine/types'
import { gameStore } from './gameStore'
import { registerSocketHandlers } from './socketHandlers'

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
  action:
    | { type: ActionType.Fold }
    | { type: ActionType.Check }
    | { type: ActionType.Call }
    | { type: ActionType.Bet; amount: number }
    | { type: ActionType.Raise; amount: number }
}

type ClientToServerEvents = {
  'join-game': (payload: JoinGamePayload) => void
  'start-game': (payload: GamePlayerPayload) => void
  'player-action': (payload: PlayerActionPayload) => void
  'pause-game': (payload: GamePlayerPayload) => void
  'resume-game': (payload: GamePlayerPayload) => void
}

type ServerToClientEvents = {
  joined: (payload: { playerId: string }) => void
  'game-state': (payload: ClientGameState) => void
  'hand-result': (payload: {
    gameId: string
    handNumber: number
    communityCards: ClientGameState['communityCards']
    results: HandResult[]
  }) => void
  error: (payload: { message: string }) => void
}

type TestClientSocket = ClientSocket<ServerToClientEvents, ClientToServerEvents>

type CapturedEvent = keyof ServerToClientEvents

type SocketEventState = {
  queues: Record<CapturedEvent, unknown[]>
  waiters: Record<CapturedEvent, Array<(payload: unknown) => void>>
}

const socketEventState = new WeakMap<TestClientSocket, SocketEventState>()

function ensureSocketEventState(socket: TestClientSocket): SocketEventState {
  const existing = socketEventState.get(socket)
  if (existing) {
    return existing
  }

  const created: SocketEventState = {
    queues: {
      joined: [],
      'game-state': [],
      'hand-result': [],
      error: [],
    },
    waiters: {
      joined: [],
      'game-state': [],
      'hand-result': [],
      error: [],
    },
  }

  socketEventState.set(socket, created)

  const capture = <K extends CapturedEvent>(event: K) => {
    const handler = ((payload: Parameters<ServerToClientEvents[K]>[0]) => {
      const state = ensureSocketEventState(socket)
      const waiter = state.waiters[event].shift()
      if (waiter) {
        waiter(payload)
        return
      }

      state.queues[event].push(payload)
    }) as unknown as ServerToClientEvents[K]

    const untypedSocket = socket as unknown as {
      on: (event: string, listener: (...args: unknown[]) => void) => void
    }

    untypedSocket.on(event, handler as (...args: unknown[]) => void)
  }

  capture('joined')
  capture('game-state')
  capture('hand-result')
  capture('error')

  return created
}

function waitForEvent<K extends keyof ServerToClientEvents>(
  socket: TestClientSocket,
  event: K,
  timeoutMs: number = 2_000,
): Promise<Parameters<ServerToClientEvents[K]>[0]> {
  const state = ensureSocketEventState(socket)
  const queued = state.queues[event].shift()
  if (queued !== undefined) {
    return Promise.resolve(queued as Parameters<ServerToClientEvents[K]>[0])
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      const waiters = state.waiters[event]
      const index = waiters.indexOf(onPayload)
      if (index >= 0) {
        waiters.splice(index, 1)
      }
      reject(new Error(`Timed out waiting for ${String(event)}`))
    }, timeoutMs)

    const onPayload = (payload: unknown) => {
      clearTimeout(timeout)
      resolve(payload as Parameters<ServerToClientEvents[K]>[0])
    }

    state.waiters[event].push(onPayload)
  })
}

async function joinGame(
  socket: TestClientSocket,
  gameId: string,
  displayName: string,
  seatIndex: number,
): Promise<{ playerId: string }> {
  const joined = waitForEvent(socket, 'joined')
  socket.emit('join-game', { gameId, displayName, seatIndex })
  return await joined
}

async function createTestServer(): Promise<{
  io: Server
  httpServer: HttpServer
  port: number
}> {
  const httpServer = createServer()
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  })

  io.on('connection', (socket) => {
    registerSocketHandlers(io, socket)
  })

  await new Promise<void>((resolve) => {
    httpServer.listen(0, resolve)
  })

  const address = httpServer.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind test server')
  }

  return {
    io,
    httpServer,
    port: (address as AddressInfo).port,
  }
}

function createClient(port: number): TestClientSocket {
  const socket = ioc(`http://localhost:${port}`, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  })

  ensureSocketEventState(socket)
  return socket
}

function seedGame(config?: Partial<GameConfig>): string {
  const gameId = `test-${randomUUID()}`
  const fullConfig: GameConfig = {
    ...DEFAULT_CONFIG,
    timePerAction: 0,
    ...config,
  }
  const game = {
    ...createGame(fullConfig),
    id: gameId,
  }
  gameStore.set(gameId, game)
  return gameId
}

function findPlayerBySeat(game: ClientGameState, seatIndex: number): NonNullable<ClientGameState['players'][number]> {
  const player = game.players.find(
    (candidate) => candidate !== null && candidate.seatIndex === seatIndex,
  )
  if (!player) {
    throw new Error(`No player found for seatIndex ${seatIndex}`)
  }
  return player
}

function hasNodeUnref(value: unknown): value is { unref: () => void } {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  if (!('unref' in value)) {
    return false
  }

  return typeof (value as { unref?: unknown }).unref === 'function'
}

describe('registerSocketHandlers (integration)', () => {
  let httpServer: HttpServer
  let io: Server
  let port: number
  let clients: TestClientSocket[]
  let gameIds: string[]

  const originalSetTimeout = globalThis.setTimeout

  beforeAll(async () => {
    globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>): ReturnType<typeof setTimeout> => {
      const handle = originalSetTimeout(...args)
      const delay = args[1]

      if (delay === 30_000 && hasNodeUnref(handle)) {
        handle.unref()
      }

      return handle
    }) as typeof setTimeout

    const created = await createTestServer()
    httpServer = created.httpServer
    io = created.io
    port = created.port
  })

  afterAll(() => {
    io.disconnectSockets(true)
    io.close()
    if (httpServer.listening) {
      httpServer.close()
    }
    globalThis.setTimeout = originalSetTimeout
  })

  beforeEach(() => {
    clients = []
    gameIds = []
  })

  afterEach(async () => {
    clients.forEach((client) => {
      client.disconnect()
      client.close()
    })

    io.disconnectSockets(true)

    gameIds.forEach((gameId) => gameStore.delete(gameId))
  })

  it('join-game: two clients join the same game and both receive game-state broadcasts', async () => {
    const gameId = seedGame()
    gameIds.push(gameId)

    const c1 = createClient(port)
    const c2 = createClient(port)
    clients.push(c1, c2)

    const { playerId: p1 } = await joinGame(c1, gameId, 'Alice', 0)
    const c1InitialState = await waitForEvent(c1, 'game-state')
    await waitForEvent(c1, 'game-state')
    expect(c1InitialState.id).toBe(gameId)
    expect(c1InitialState.players.filter(Boolean).length).toBe(1)

    const { playerId: p2 } = await joinGame(c2, gameId, 'Bob', 1)
    expect(p2).not.toBe(p1)

    const c2State = await waitForEvent(c2, 'game-state')
    await waitForEvent(c2, 'game-state')
    const c1AfterSecondJoinState = await waitForEvent(c1, 'game-state')
    expect(c1AfterSecondJoinState.players.filter(Boolean).length).toBe(2)
    expect(c2State.players.filter(Boolean).length).toBe(2)
  })

  it('join-game: client with valid token reconnects and receives joined + game-state', async () => {
    const gameId = seedGame()
    gameIds.push(gameId)

    const c1 = createClient(port)
    clients.push(c1)

    const { playerId } = await joinGame(c1, gameId, 'Alice', 0)
    await waitForEvent(c1, 'game-state')
    await waitForEvent(c1, 'game-state')

    const storedGame = gameStore.get(gameId)
    if (!storedGame) {
      throw new Error('Expected seeded game to exist')
    }
    const token = storedGame.players.find((player) => player.id === playerId)?.token
    if (!token) {
      throw new Error('Expected player token to be stored')
    }

    c1.disconnect()
    c1.close()

    const c2 = createClient(port)
    clients.push(c2)

    c2.emit('join-game', { gameId, displayName: 'Alice', seatIndex: 0, token })
    const rejoined = await waitForEvent(c2, 'joined')
    const gameState = await waitForEvent(c2, 'game-state')
    expect(rejoined.playerId).toBe(playerId)
    expect(gameState.id).toBe(gameId)
    const player = gameState.players.find((candidate) => candidate !== null && candidate.id === playerId)
    expect(player?.isConnected).toBe(true)
  })

  it('join-game: invalid gameId emits error', async () => {
    const c1 = createClient(port)
    clients.push(c1)

    const errP = waitForEvent(c1, 'error')
    c1.emit('join-game', {
      gameId: `missing-${randomUUID()}`,
      displayName: 'Alice',
      seatIndex: 0,
    })
    const err = await errP
    expect(err.message).toBe('Game not found')
  })

  it('start-game: host starts with 2+ players and all clients receive phase=preflop', async () => {
    const gameId = seedGame()
    gameIds.push(gameId)

    const host = createClient(port)
    const other = createClient(port)
    clients.push(host, other)

    const { playerId: hostId } = await joinGame(host, gameId, 'Host', 0)
    await waitForEvent(host, 'game-state')
    await waitForEvent(host, 'game-state')

    await joinGame(other, gameId, 'Other', 1)
    await waitForEvent(other, 'game-state')
    await waitForEvent(other, 'game-state')
    await waitForEvent(host, 'game-state')

    host.emit('start-game', { gameId, playerId: hostId })
    const hostStarted = await waitForEvent(host, 'game-state')
    const otherStarted = await waitForEvent(other, 'game-state')

    expect(hostStarted.phase).toBe(GamePhase.Preflop)
    expect(otherStarted.phase).toBe(GamePhase.Preflop)
  })

  it('start-game: non-host cannot start and receives error', async () => {
    const gameId = seedGame()
    gameIds.push(gameId)

    const host = createClient(port)
    const other = createClient(port)
    clients.push(host, other)

    await joinGame(host, gameId, 'Host', 0)
    await waitForEvent(host, 'game-state')
    await waitForEvent(host, 'game-state')

    const { playerId: otherId } = await joinGame(other, gameId, 'Other', 1)
    await waitForEvent(other, 'game-state')
    await waitForEvent(other, 'game-state')
    await waitForEvent(host, 'game-state')

    const errP = waitForEvent(other, 'error')
    other.emit('start-game', { gameId, playerId: otherId })
    const err = await errP
    expect(err.message).toBe('Only the host can start the game')
  })

  it('start-game: starting with <2 players emits error', async () => {
    const gameId = seedGame()
    gameIds.push(gameId)

    const host = createClient(port)
    clients.push(host)

    const { playerId: hostId } = await joinGame(host, gameId, 'Host', 0)
    await waitForEvent(host, 'game-state')
    await waitForEvent(host, 'game-state')

    const errP = waitForEvent(host, 'error')
    host.emit('start-game', { gameId, playerId: hostId })
    const err = await errP
    expect(err.message).toBe('Minimum 2 active players required to start a hand')
  })

  it('player-action (fold): active player folds and game-state broadcasts updated state', async () => {
    const gameId = seedGame()
    gameIds.push(gameId)

    const host = createClient(port)
    const other = createClient(port)
    clients.push(host, other)

    const { playerId: hostId } = await joinGame(host, gameId, 'Host', 0)
    await waitForEvent(host, 'game-state')
    await waitForEvent(host, 'game-state')

    await joinGame(other, gameId, 'Other', 1)
    await waitForEvent(other, 'game-state')
    await waitForEvent(other, 'game-state')
    await waitForEvent(host, 'game-state')

    host.emit('start-game', { gameId, playerId: hostId })
    const hostStarted = await waitForEvent(host, 'game-state')
    const otherStarted = await waitForEvent(other, 'game-state')
    expect(hostStarted.phase).toBe(GamePhase.Preflop)
    expect(otherStarted.phase).toBe(GamePhase.Preflop)

    const actingSeat = hostStarted.activePlayerIndex
    expect(actingSeat).toBeGreaterThanOrEqual(0)

    const actingPlayer = findPlayerBySeat(hostStarted, actingSeat)
    const actingSocket = actingPlayer.id === hostId ? host : other
    const actingPlayerId = actingPlayer.id

    actingSocket.emit('player-action', {
      gameId,
      playerId: actingPlayerId,
      action: { type: ActionType.Fold },
    })
    const hostAfterFold = await waitForEvent(host, 'game-state')
    const otherAfterFold = await waitForEvent(other, 'game-state')

    const hostViewActing = hostAfterFold.players.find((p) => p !== null && p.id === actingPlayerId)
    const otherViewActing = otherAfterFold.players.find((p) => p !== null && p.id === actingPlayerId)
    expect(hostViewActing?.isFolded).toBe(true)
    expect(otherViewActing?.isFolded).toBe(true)
  })

  it('player-action: wrong player acts and receives error', async () => {
    const gameId = seedGame()
    gameIds.push(gameId)

    const host = createClient(port)
    const other = createClient(port)
    clients.push(host, other)

    const { playerId: hostId } = await joinGame(host, gameId, 'Host', 0)
    await waitForEvent(host, 'game-state')
    await waitForEvent(host, 'game-state')

    const { playerId: otherId } = await joinGame(other, gameId, 'Other', 1)
    await waitForEvent(other, 'game-state')
    await waitForEvent(other, 'game-state')
    await waitForEvent(host, 'game-state')

    host.emit('start-game', { gameId, playerId: hostId })
    const hostStarted = await waitForEvent(host, 'game-state')
    await waitForEvent(other, 'game-state')

    const actingSeat = hostStarted.activePlayerIndex
    const actingPlayerId = findPlayerBySeat(hostStarted, actingSeat).id
    const wrongPlayerId = actingPlayerId === hostId ? otherId : hostId
    const wrongSocket = wrongPlayerId === hostId ? host : other

    const errP = waitForEvent(wrongSocket, 'error')
    wrongSocket.emit('player-action', {
      gameId,
      playerId: wrongPlayerId,
      action: { type: ActionType.Fold },
    })
    const err = await errP
    expect(err.message).toBe("Not this player's turn")
  })

  it('pause-game / resume-game: host pauses and resumes and all clients see updates', async () => {
    const gameId = seedGame()
    gameIds.push(gameId)

    const host = createClient(port)
    const other = createClient(port)
    clients.push(host, other)

    const { playerId: hostId } = await joinGame(host, gameId, 'Host', 0)
    await waitForEvent(host, 'game-state')
    await waitForEvent(host, 'game-state')

    await joinGame(other, gameId, 'Other', 1)
    await waitForEvent(other, 'game-state')
    await waitForEvent(other, 'game-state')
    await waitForEvent(host, 'game-state')

    host.emit('start-game', { gameId, playerId: hostId })
    await waitForEvent(host, 'game-state')
    await waitForEvent(other, 'game-state')

    host.emit('pause-game', { gameId, playerId: hostId })
    const hostPaused = await waitForEvent(host, 'game-state')
    const otherPaused = await waitForEvent(other, 'game-state')
    expect(hostPaused.isPaused).toBe(true)
    expect(otherPaused.isPaused).toBe(true)

    host.emit('resume-game', { gameId, playerId: hostId })
    const hostResumed = await waitForEvent(host, 'game-state')
    const otherResumed = await waitForEvent(other, 'game-state')
    expect(hostResumed.isPaused).toBe(false)
    expect(otherResumed.isPaused).toBe(false)
  })

  it('pause-game: non-host cannot pause and receives error', async () => {
    const gameId = seedGame()
    gameIds.push(gameId)

    const host = createClient(port)
    const other = createClient(port)
    clients.push(host, other)

    await joinGame(host, gameId, 'Host', 0)
    await waitForEvent(host, 'game-state')
    await waitForEvent(host, 'game-state')

    const { playerId: otherId } = await joinGame(other, gameId, 'Other', 1)
    await waitForEvent(other, 'game-state')
    await waitForEvent(other, 'game-state')
    await waitForEvent(host, 'game-state')

    const errP = waitForEvent(other, 'error')
    other.emit('pause-game', { gameId, playerId: otherId })
    const err = await errP
    expect(err.message).toBe('Only the host can pause the game')
  })

  it('disconnect: disconnecting player updates isConnected=false in remaining clients game-state', async () => {
    const gameId = seedGame()
    gameIds.push(gameId)

    const c1 = createClient(port)
    const c2 = createClient(port)
    clients.push(c1, c2)

    const { playerId: p1 } = await joinGame(c1, gameId, 'Alice', 0)
    await waitForEvent(c1, 'game-state')
    await waitForEvent(c1, 'game-state')

    await joinGame(c2, gameId, 'Bob', 1)
    await waitForEvent(c2, 'game-state')
    await waitForEvent(c2, 'game-state')
    await waitForEvent(c1, 'game-state')

    const remainingStateP = waitForEvent(c2, 'game-state')
    c1.disconnect()
    const remainingState = await remainingStateP

    const disconnected = remainingState.players.find((p) => p !== null && p.id === p1)
    expect(disconnected?.isConnected).toBe(false)
  })

  it('full hand to showdown: 2 players at non-consecutive seats (0, 3) complete all streets via call/check', async () => {
    const gameId = seedGame({ betweenHandsDelay: 60 })
    gameIds.push(gameId)

    const host = createClient(port)
    const other = createClient(port)
    clients.push(host, other)

    const { playerId: hostId } = await joinGame(host, gameId, 'Host', 0)
    await waitForEvent(host, 'game-state')
    await waitForEvent(host, 'game-state')

    const { playerId: otherId } = await joinGame(other, gameId, 'Other', 3)
    await waitForEvent(other, 'game-state')
    await waitForEvent(other, 'game-state')
    await waitForEvent(host, 'game-state')

    host.emit('start-game', { gameId, playerId: hostId })
    let state = await waitForEvent(host, 'game-state')
    await waitForEvent(other, 'game-state')

    expect(state.phase).toBe(GamePhase.Preflop)
    expect(state.communityCards).toHaveLength(0)
    expect(state.activePlayerIndex).toBeGreaterThanOrEqual(0)

    const socketFor = (id: string) => id === hostId ? host : other

    const act = async (action: PlayerAction): Promise<ClientGameState> => {
      const actingPlayer = findPlayerBySeat(state, state.activePlayerIndex)
      const socket = socketFor(actingPlayer.id)
      const hostNextP = waitForEvent(host, 'game-state')
      const otherNextP = waitForEvent(other, 'game-state')
      socket.emit('player-action', { gameId, playerId: actingPlayer.id, action })
      const [hostState] = await Promise.all([hostNextP, otherNextP])
      return hostState
    }

    const actFinal = async (action: PlayerAction) => {
      const actingPlayer = findPlayerBySeat(state, state.activePlayerIndex)
      const socket = socketFor(actingPlayer.id)
      const hostStateP = waitForEvent(host, 'game-state')
      const otherStateP = waitForEvent(other, 'game-state')
      const hostHandResultP = waitForEvent(host, 'hand-result')
      const otherHandResultP = waitForEvent(other, 'hand-result')
      socket.emit('player-action', { gameId, playerId: actingPlayer.id, action })
      const [hostState, , handResult] = await Promise.all([hostStateP, otherStateP, hostHandResultP, otherHandResultP])
      return { state: hostState, handResult }
    }

    expect(state.activePlayerIndex).toBe(0)
    state = await act({ type: ActionType.Call })
    expect(state.phase).toBe(GamePhase.Preflop)
    expect(state.activePlayerIndex).toBe(3)

    state = await act({ type: ActionType.Check })
    expect(state.phase).toBe(GamePhase.Flop)
    expect(state.communityCards).toHaveLength(3)
    expect(state.pot).toBe(4)
    expect(state.currentBet).toBe(0)

    expect(state.activePlayerIndex).toBe(3)
    state = await act({ type: ActionType.Check })
    expect(state.activePlayerIndex).toBe(0)
    state = await act({ type: ActionType.Check })
    expect(state.phase).toBe(GamePhase.Turn)
    expect(state.communityCards).toHaveLength(4)
    expect(state.pot).toBe(4)

    expect(state.activePlayerIndex).toBe(3)
    state = await act({ type: ActionType.Check })
    expect(state.activePlayerIndex).toBe(0)
    state = await act({ type: ActionType.Check })
    expect(state.phase).toBe(GamePhase.River)
    expect(state.communityCards).toHaveLength(5)
    expect(state.pot).toBe(4)

    expect(state.activePlayerIndex).toBe(3)
    state = await act({ type: ActionType.Check })
    expect(state.activePlayerIndex).toBe(0)

    const { state: finalState, handResult } = await actFinal({ type: ActionType.Check })

    expect(finalState.phase).toBe(GamePhase.Showdown)
    expect(finalState.communityCards).toHaveLength(5)
    expect(finalState.activePlayerIndex).toBe(-1)

    expect(handResult.handNumber).toBe(1)
    expect(handResult.results).toHaveLength(2)
    expect(handResult.communityCards).toHaveLength(5)

    const p0 = findPlayerBySeat(finalState, 0)
    const p3 = findPlayerBySeat(finalState, 3)
    expect(p0.chips + p3.chips).toBe(DEFAULT_CONFIG.startingStack * 2)
  })

  it('showdown visibility: each player sees own hole cards, opponents stay hidden', async () => {
    const gameId = seedGame({ betweenHandsDelay: 60 })
    gameIds.push(gameId)

    const host = createClient(port)
    const other = createClient(port)
    clients.push(host, other)

    const { playerId: hostId } = await joinGame(host, gameId, 'Host', 0)
    await waitForEvent(host, 'game-state')
    await waitForEvent(host, 'game-state')

    const { playerId: otherId } = await joinGame(other, gameId, 'Other', 3)
    await waitForEvent(other, 'game-state')
    await waitForEvent(other, 'game-state')
    await waitForEvent(host, 'game-state')

    host.emit('start-game', { gameId, playerId: hostId })
    let state = await waitForEvent(host, 'game-state')
    await waitForEvent(other, 'game-state')

    const socketFor = (id: string) => id === hostId ? host : other

    const act = async (action: PlayerAction): Promise<ClientGameState> => {
      const actingPlayer = findPlayerBySeat(state, state.activePlayerIndex)
      const socket = socketFor(actingPlayer.id)
      const hostNextP = waitForEvent(host, 'game-state')
      const otherNextP = waitForEvent(other, 'game-state')
      socket.emit('player-action', { gameId, playerId: actingPlayer.id, action })
      const [hostState] = await Promise.all([hostNextP, otherNextP])
      return hostState
    }

    const actFinal = async (action: PlayerAction): Promise<{ hostState: ClientGameState; otherState: ClientGameState }> => {
      const actingPlayer = findPlayerBySeat(state, state.activePlayerIndex)
      const socket = socketFor(actingPlayer.id)
      const hostStateP = waitForEvent(host, 'game-state')
      const otherStateP = waitForEvent(other, 'game-state')
      socket.emit('player-action', { gameId, playerId: actingPlayer.id, action })
      const [hostState, otherState] = await Promise.all([hostStateP, otherStateP])
      return { hostState, otherState }
    }

    state = await act({ type: ActionType.Call })
    state = await act({ type: ActionType.Check })
    state = await act({ type: ActionType.Check })
    state = await act({ type: ActionType.Check })
    state = await act({ type: ActionType.Check })
    state = await act({ type: ActionType.Check })
    state = await act({ type: ActionType.Check })

    const { hostState: finalHostState, otherState: finalOtherState } = await actFinal({ type: ActionType.Check })

    expect(finalHostState.phase).toBe(GamePhase.Showdown)
    expect(finalOtherState.phase).toBe(GamePhase.Showdown)

    const hostViewHost = finalHostState.players.find((p) => p !== null && p.id === hostId)
    const hostViewOther = finalHostState.players.find((p) => p !== null && p.id === otherId)
    const otherViewHost = finalOtherState.players.find((p) => p !== null && p.id === hostId)
    const otherViewOther = finalOtherState.players.find((p) => p !== null && p.id === otherId)

    expect(hostViewHost?.holeCards).not.toBeNull()
    expect(hostViewOther?.holeCards).toBeNull()
    expect(otherViewHost?.holeCards).toBeNull()
    expect(otherViewOther?.holeCards).not.toBeNull()
  })

  it('full hand: 3 players at non-consecutive seats (0, 2, 5), raise reopens action, folds to uncontested win', async () => {
    const gameId = seedGame({ betweenHandsDelay: 60 })
    gameIds.push(gameId)

    const host = createClient(port)
    const second = createClient(port)
    const third = createClient(port)
    clients.push(host, second, third)

    const { playerId: hostId } = await joinGame(host, gameId, 'Host', 0)
    await waitForEvent(host, 'game-state')
    await waitForEvent(host, 'game-state')

    const { playerId: secondId } = await joinGame(second, gameId, 'Second', 2)
    await waitForEvent(second, 'game-state')
    await waitForEvent(second, 'game-state')
    await waitForEvent(host, 'game-state')

    const { playerId: thirdId } = await joinGame(third, gameId, 'Third', 5)
    await waitForEvent(third, 'game-state')
    await waitForEvent(third, 'game-state')
    await waitForEvent(host, 'game-state')
    await waitForEvent(second, 'game-state')

    host.emit('start-game', { gameId, playerId: hostId })
    let state = await waitForEvent(host, 'game-state')
    await waitForEvent(second, 'game-state')
    await waitForEvent(third, 'game-state')

    expect(state.phase).toBe(GamePhase.Preflop)

    const allSockets = [host, second, third]
    const socketFor = (id: string) => {
      if (id === hostId) return host
      if (id === secondId) return second
      return third
    }

    const act = async (action: PlayerAction): Promise<ClientGameState> => {
      const actingPlayer = findPlayerBySeat(state, state.activePlayerIndex)
      const socket = socketFor(actingPlayer.id)
      const nextStates = allSockets.map(s => waitForEvent(s, 'game-state'))
      socket.emit('player-action', { gameId, playerId: actingPlayer.id, action })
      const [hostState] = await Promise.all(nextStates)
      return hostState
    }

    const actFinal = async (action: PlayerAction) => {
      const actingPlayer = findPlayerBySeat(state, state.activePlayerIndex)
      const socket = socketFor(actingPlayer.id)
      const nextStates = allSockets.map(s => waitForEvent(s, 'game-state'))
      const handResults = allSockets.map(s => waitForEvent(s, 'hand-result'))
      socket.emit('player-action', { gameId, playerId: actingPlayer.id, action })
      const [states, results] = await Promise.all([Promise.all(nextStates), Promise.all(handResults)])
      return { state: states[0], handResult: results[0] }
    }

    expect(state.activePlayerIndex).toBe(0)

    state = await act({ type: ActionType.Raise, amount: 6 })
    expect(state.currentBet).toBe(6)
    expect(state.activePlayerIndex).toBe(2)

    state = await act({ type: ActionType.Fold })
    expect(state.activePlayerIndex).toBe(5)
    expect(findPlayerBySeat(state, 2).isFolded).toBe(true)

    const { state: finalState, handResult } = await actFinal({ type: ActionType.Fold })

    expect(finalState.phase).toBe(GamePhase.Showdown)
    expect(finalState.activePlayerIndex).toBe(-1)
    expect(findPlayerBySeat(finalState, 5).isFolded).toBe(true)

    expect(handResult.handNumber).toBe(1)
    expect(handResult.results).toHaveLength(3)
    const utgResult = handResult.results.find(r => r.playerId === hostId)!
    expect(utgResult.chipDelta).toBeGreaterThan(0)

    const p0 = findPlayerBySeat(finalState, 0)
    const p2 = findPlayerBySeat(finalState, 2)
    const p5 = findPlayerBySeat(finalState, 5)
    expect(p0.chips + p2.chips + p5.chips).toBe(DEFAULT_CONFIG.startingStack * 3)
  })

  it('disconnect: host disconnecting transfers host role to next connected player', async () => {
    const gameId = seedGame()
    gameIds.push(gameId)

    const host = createClient(port)
    const other = createClient(port)
    clients.push(host, other)

    const { playerId: hostId } = await joinGame(host, gameId, 'Host', 0)
    await waitForEvent(host, 'game-state')
    await waitForEvent(host, 'game-state')

    await joinGame(other, gameId, 'Other', 1)
    await waitForEvent(other, 'game-state')
    await waitForEvent(other, 'game-state')
    await waitForEvent(host, 'game-state')

    const stateAfterDisconnectP = waitForEvent(other, 'game-state')
    host.disconnect()
    const stateAfterDisconnect = await stateAfterDisconnectP

    expect(stateAfterDisconnect.hostPlayerId).not.toBe(hostId)
    const otherPlayer = stateAfterDisconnect.players.find(p => p !== null && p.id !== hostId)
    expect(stateAfterDisconnect.hostPlayerId).toBe(otherPlayer?.id)
  })

  // ---------------------------------------------------------------------------
  // Wave 3: Spectator mode tests
  // ---------------------------------------------------------------------------

  it('join-game (spectator): joining with spectator:true emits joined with spectatorId (no playerId)', async () => {
    const gameId = seedGame()
    gameIds.push(gameId)

    const spectator = createClient(port)
    clients.push(spectator)

    const joinedP = new Promise<{ spectatorId?: string; playerId?: string }>((resolve) => {
      const raw = spectator as unknown as { on: (event: string, handler: (payload: unknown) => void) => void }
      raw.on('joined', (payload) => resolve(payload as { spectatorId?: string; playerId?: string }))
    })

    const rawSpectator = spectator as unknown as { emit: (event: string, payload: unknown) => void }
    rawSpectator.emit('join-game', { gameId, displayName: 'Viewer', spectator: true })

    const joined = await joinedP
    expect(joined.spectatorId).toBeTruthy()
    expect(joined.playerId).toBeUndefined()
  })

  it('join-game (spectator): spectator receives game-state with no hole cards for other players', async () => {
    const gameId = seedGame()
    gameIds.push(gameId)

    const player = createClient(port)
    clients.push(player)
    await joinGame(player, gameId, 'Alice', 0)
    await waitForEvent(player, 'game-state')
    await waitForEvent(player, 'game-state')

    const spectator = createClient(port)
    clients.push(spectator)

    const gameStateP = new Promise<ClientGameState>((resolve) => {
      const raw = spectator as unknown as { on: (event: string, handler: (payload: unknown) => void) => void }
      raw.on('game-state', (payload) => resolve(payload as ClientGameState))
    })

    const rawSpectator = spectator as unknown as { emit: (event: string, payload: unknown) => void }
    rawSpectator.emit('join-game', { gameId, displayName: 'Viewer', spectator: true })

    const state = await gameStateP
    expect(state.id).toBe(gameId)
    const playerWithCards = state.players.find(p => p !== null && p.holeCards !== null)
    expect(playerWithCards).toBeUndefined()
  })

  it('join-game (spectator): spectator count appears in game state after joining', async () => {
    const gameId = seedGame()
    gameIds.push(gameId)

    const player = createClient(port)
    clients.push(player)
    const { playerId } = await joinGame(player, gameId, 'Alice', 0)
    await waitForEvent(player, 'game-state')
    const initialState = await waitForEvent(player, 'game-state')
    expect(initialState.players.filter(Boolean).length).toBe(1)

    const spectator = createClient(port)
    clients.push(spectator)

    const rawSpectator = spectator as unknown as { emit: (event: string, payload: unknown) => void }
    rawSpectator.emit('join-game', { gameId, displayName: 'Viewer', spectator: true })

    const stateAfterSpectator = await waitForEvent(player, 'game-state')
    expect(stateAfterSpectator.spectators).toHaveLength(1)
    expect(stateAfterSpectator.spectators[0].displayName).toBe('Viewer')
    expect(playerId).toBeTruthy()
  })

  it('join-game (spectator): spectator cannot perform player-action', async () => {
    const gameId = seedGame()
    gameIds.push(gameId)

    const host = createClient(port)
    const other = createClient(port)
    const spectatorClient = createClient(port)
    clients.push(host, other, spectatorClient)

    const { playerId: hostId } = await joinGame(host, gameId, 'Host', 0)
    await waitForEvent(host, 'game-state')
    await waitForEvent(host, 'game-state')

    await joinGame(other, gameId, 'Other', 1)
    await waitForEvent(other, 'game-state')
    await waitForEvent(other, 'game-state')
    await waitForEvent(host, 'game-state')

    host.emit('start-game', { gameId, playerId: hostId })
    const gameStarted = await waitForEvent(host, 'game-state')
    await waitForEvent(other, 'game-state')

    expect(gameStarted.phase).toBe(GamePhase.Preflop)

    const rawSpectatorClient = spectatorClient as unknown as { emit: (event: string, payload: unknown) => void }
    rawSpectatorClient.emit('join-game', { gameId, displayName: 'Watcher', spectator: true })

    await waitForEvent(host, 'game-state')

    const errP = new Promise<{ message: string }>((resolve) => {
      const raw = spectatorClient as unknown as { on: (event: string, handler: (payload: unknown) => void) => void }
      raw.on('error', (payload) => resolve(payload as { message: string }))
    })

    const actingSeat = gameStarted.activePlayerIndex
    const actingPlayer = findPlayerBySeat(gameStarted, actingSeat)

    spectatorClient.emit('player-action', {
      gameId,
      playerId: actingPlayer.id,
      action: { type: ActionType.Fold },
    })

    const err = await errP
    expect(err.message).toBe('Spectators cannot perform actions')
  })

  it('chat-message: valid message broadcasts to room', async () => {
    const gameId = seedGame()
    gameIds.push(gameId)

    const c1 = createClient(port)
    const c2 = createClient(port)
    clients.push(c1, c2)

    const { playerId: p1 } = await joinGame(c1, gameId, 'Alice', 0)
    await waitForEvent(c1, 'game-state')
    await waitForEvent(c1, 'game-state')

    await joinGame(c2, gameId, 'Bob', 1)
    await waitForEvent(c2, 'game-state')
    await waitForEvent(c2, 'game-state')
    await waitForEvent(c1, 'game-state')

    const chatP = new Promise<{
      id: string
      senderId: string
      senderName: string
      text: string
      type: string
    }>((resolve) => {
      const raw = c2 as unknown as { on: (event: string, handler: (payload: unknown) => void) => void }
      raw.on('chat-broadcast', (payload) => resolve(payload as { id: string; senderId: string; senderName: string; text: string; type: string }))
    })

    const rawC1 = c1 as unknown as { emit: (event: string, payload: unknown) => void }
    rawC1.emit('chat-message', { gameId, senderId: p1, senderName: 'Alice', text: 'Hello everyone', type: 'custom' })

    const msg = await chatP
    expect(msg.text).toBe('Hello everyone')
    expect(msg.senderId).toBe(p1)
    expect(msg.senderName).toBe('Alice')
    expect(msg.type).toBe('custom')
    expect(msg.id).toBeTruthy()
  })

  it('chat-message: reaction message broadcasts correctly', async () => {
    const gameId = seedGame()
    gameIds.push(gameId)

    const c1 = createClient(port)
    clients.push(c1)

    const { playerId: p1 } = await joinGame(c1, gameId, 'Alice', 0)
    await waitForEvent(c1, 'game-state')
    await waitForEvent(c1, 'game-state')

    const chatP = new Promise<{ text: string; type: string }>((resolve) => {
      const raw = c1 as unknown as { on: (event: string, handler: (payload: unknown) => void) => void }
      raw.on('chat-broadcast', (payload) => resolve(payload as { text: string; type: string }))
    })

    const rawC1 = c1 as unknown as { emit: (event: string, payload: unknown) => void }
    rawC1.emit('chat-message', { gameId, senderId: p1, senderName: 'Alice', text: 'GG', type: 'reaction' })

    const msg = await chatP
    expect(msg.text).toBe('GG')
    expect(msg.type).toBe('reaction')
  })

  it('chat-message: invalid reaction emits error', async () => {
    const gameId = seedGame()
    gameIds.push(gameId)

    const c1 = createClient(port)
    clients.push(c1)

    const { playerId: p1 } = await joinGame(c1, gameId, 'Alice', 0)
    await waitForEvent(c1, 'game-state')
    await waitForEvent(c1, 'game-state')

    const errP = waitForEvent(c1, 'error')

    const rawC1 = c1 as unknown as { emit: (event: string, payload: unknown) => void }
    rawC1.emit('chat-message', { gameId, senderId: p1, senderName: 'Alice', text: 'NOT A REACTION', type: 'reaction' })

    const err = await errP
    expect(err.message).toBe('Invalid reaction')
  })

  it('chat-message: rate limiting blocks 6th message in 10s window', async () => {
    const gameId = seedGame()
    gameIds.push(gameId)

    const c1 = createClient(port)
    clients.push(c1)

    await joinGame(c1, gameId, 'Alice', 0)
    await waitForEvent(c1, 'game-state')
    await waitForEvent(c1, 'game-state')

    const uniqueSender = `rate-limit-test-${randomUUID()}`
    const rawC1 = c1 as unknown as { emit: (event: string, payload: unknown) => void; once: (event: string, handler: () => void) => void }

    const sent: Promise<void>[] = []
    for (let i = 0; i < 5; i++) {
      const broadcastReceived = new Promise<void>((resolve) => {
        const raw = c1 as unknown as { once: (event: string, handler: () => void) => void }
        raw.once('chat-broadcast', resolve)
      })
      rawC1.emit('chat-message', { gameId, senderId: uniqueSender, senderName: 'Alice', text: `Message ${i + 1}`, type: 'custom' })
      sent.push(broadcastReceived)
    }

    await Promise.all(sent)

    const errP = waitForEvent(c1, 'error')
    rawC1.emit('chat-message', { gameId, senderId: uniqueSender, senderName: 'Alice', text: 'This should be blocked', type: 'custom' })

    const err = await errP
    expect(err.message).toContain('Too many chat messages')
  })

  it('chat-message: empty message emits error', async () => {
    const gameId = seedGame()
    gameIds.push(gameId)

    const c1 = createClient(port)
    clients.push(c1)

    const { playerId: p1 } = await joinGame(c1, gameId, 'Alice', 0)
    await waitForEvent(c1, 'game-state')
    await waitForEvent(c1, 'game-state')

    const errP = waitForEvent(c1, 'error')

    const rawC1 = c1 as unknown as { emit: (event: string, payload: unknown) => void }
    rawC1.emit('chat-message', { gameId, senderId: p1, senderName: 'Alice', text: '   ', type: 'custom' })

    const err = await errP
    expect(err.message).toBe('Message cannot be empty')
  })

  it('socket: board runs out street-by-street to showdown when solo non-all-in player calls flop all-in', async () => {
    const gameId = seedGame({ betweenHandsDelay: 60 })
    gameIds.push(gameId)

    const host = createClient(port)
    const other = createClient(port)
    clients.push(host, other)

    const { playerId: hostId } = await joinGame(host, gameId, 'Host', 0)
    await waitForEvent(host, 'game-state')
    await waitForEvent(host, 'game-state')

    const { playerId: otherId } = await joinGame(other, gameId, 'Other', 3)
    await waitForEvent(other, 'game-state')
    await waitForEvent(other, 'game-state')
    await waitForEvent(host, 'game-state')

    host.emit('start-game', { gameId, playerId: hostId })
    let state = await waitForEvent(host, 'game-state')
    await waitForEvent(other, 'game-state')

    const act = async (action: PlayerAction): Promise<ClientGameState> => {
      const actingPlayer = findPlayerBySeat(state, state.activePlayerIndex)
      const socket = actingPlayer.id === hostId ? host : other
      const hostNext = waitForEvent(host, 'game-state')
      const otherNext = waitForEvent(other, 'game-state')
      socket.emit('player-action', { gameId, playerId: actingPlayer.id, action })
      const [hostState] = await Promise.all([hostNext, otherNext])
      state = hostState
      return hostState
    }

    state = await act({ type: ActionType.Call })
    state = await act({ type: ActionType.Check })
    expect(state.phase).toBe(GamePhase.Flop)

    const liveGame = gameStore.get(gameId)!
    const flopActorId = findPlayerBySeat(state, state.activePlayerIndex).id
    gameStore.set(gameId, {
      ...liveGame,
      players: liveGame.players.map((p) => (p.id === flopActorId ? { ...p, chips: 50 } : p)),
    })

    state = await act({ type: ActionType.Bet, amount: 50 })
    expect(state.phase).toBe(GamePhase.Flop)
    expect(state.activePlayerIndex).not.toBe(-1)

    state = await act({ type: ActionType.Call })
    expect(state.phase).toBe(GamePhase.Turn)
    expect(state.activePlayerIndex).toBe(-1)
    expect(state.communityCards).toHaveLength(4)

    const [riverState] = await Promise.all([
      waitForEvent(host, 'game-state'),
      waitForEvent(other, 'game-state'),
    ])
    expect(riverState.phase).toBe(GamePhase.River)
    expect(riverState.communityCards).toHaveLength(5)

    const [showdownState] = await Promise.all([
      waitForEvent(host, 'game-state'),
      waitForEvent(other, 'game-state'),
    ])
    expect(showdownState.phase).toBe(GamePhase.Showdown)
    expect(showdownState.activePlayerIndex).toBe(-1)
    expect(showdownState.communityCards).toHaveLength(5)
    void otherId
  }, 15_000)

  it('socket: board runs out street-by-street to showdown when preflop all-in is called by larger stack', async () => {
    const gameId = seedGame({ betweenHandsDelay: 60 })
    gameIds.push(gameId)

    const host = createClient(port)
    const other = createClient(port)
    clients.push(host, other)

    const { playerId: hostId } = await joinGame(host, gameId, 'Host', 0)
    await waitForEvent(host, 'game-state')
    await waitForEvent(host, 'game-state')

    const { playerId: otherId } = await joinGame(other, gameId, 'Other', 3)
    await waitForEvent(other, 'game-state')
    await waitForEvent(other, 'game-state')
    await waitForEvent(host, 'game-state')

    host.emit('start-game', { gameId, playerId: hostId })
    let state = await waitForEvent(host, 'game-state')
    await waitForEvent(other, 'game-state')

    const liveGame = gameStore.get(gameId)!
    const preflopActorId = findPlayerBySeat(state, state.activePlayerIndex).id
    gameStore.set(gameId, {
      ...liveGame,
      players: liveGame.players.map((p) => (p.id === preflopActorId ? { ...p, chips: 49 } : p)),
    })

    const act = async (action: PlayerAction): Promise<ClientGameState> => {
      const actingPlayer = findPlayerBySeat(state, state.activePlayerIndex)
      const socket = actingPlayer.id === hostId ? host : other
      const hostNext = waitForEvent(host, 'game-state')
      const otherNext = waitForEvent(other, 'game-state')
      socket.emit('player-action', { gameId, playerId: actingPlayer.id, action })
      const [hostState] = await Promise.all([hostNext, otherNext])
      state = hostState
      return hostState
    }

    state = await act({ type: ActionType.Raise, amount: 50 })
    expect(state.phase).toBe(GamePhase.Preflop)

    state = await act({ type: ActionType.Call })
    expect(state.phase).toBe(GamePhase.Flop)
    expect(state.activePlayerIndex).toBe(-1)
    expect(state.communityCards).toHaveLength(3)

    const [turnState] = await Promise.all([
      waitForEvent(host, 'game-state'),
      waitForEvent(other, 'game-state'),
    ])
    expect(turnState.phase).toBe(GamePhase.Turn)
    expect(turnState.communityCards).toHaveLength(4)

    const [riverState] = await Promise.all([
      waitForEvent(host, 'game-state'),
      waitForEvent(other, 'game-state'),
    ])
    expect(riverState.phase).toBe(GamePhase.River)
    expect(riverState.communityCards).toHaveLength(5)

    const [showdownState] = await Promise.all([
      waitForEvent(host, 'game-state'),
      waitForEvent(other, 'game-state'),
    ])
    expect(showdownState.phase).toBe(GamePhase.Showdown)
    expect(showdownState.activePlayerIndex).toBe(-1)
    expect(showdownState.communityCards).toHaveLength(5)
    void otherId
  }, 15_000)
})
