import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/persistence', () => ({
  saveGame: vi.fn(),
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
import { ActionType, GamePhase, type ClientGameState, type GameConfig, type HandResult } from '../engine/types'
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

  beforeAll(() => {
    globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>): ReturnType<typeof setTimeout> => {
      const handle = originalSetTimeout(...args)
      const delay = args[1]

      if (delay === 30_000 && hasNodeUnref(handle)) {
        handle.unref()
      }

      return handle
    }) as typeof setTimeout
  })

  afterAll(() => {
    globalThis.setTimeout = originalSetTimeout
  })

  beforeEach(async () => {
    clients = []
    gameIds = []

    const created = await createTestServer()
    httpServer = created.httpServer
    io = created.io
    port = created.port
  })

  afterEach(async () => {
    clients.forEach((client) => {
      client.disconnect()
      client.close()
    })

    await io.disconnectSockets(true)

    await new Promise<void>((resolve, reject) => {
      io.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })

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
    expect(c1InitialState.players.length).toBe(1)

    const { playerId: p2 } = await joinGame(c2, gameId, 'Bob', 1)
    expect(p2).not.toBe(p1)

    const c2State = await waitForEvent(c2, 'game-state')
    await waitForEvent(c2, 'game-state')
    const c1AfterSecondJoinState = await waitForEvent(c1, 'game-state')
    expect(c1AfterSecondJoinState.players.length).toBe(2)
    expect(c2State.players.length).toBe(2)
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
})
