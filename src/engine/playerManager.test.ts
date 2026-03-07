import { describe, expect, it } from 'vitest'

import { DEFAULT_CONFIG } from './constants'
import { createGame } from './gameController'
import {
  addPlayer,
  findPlayerByToken,
  markPlayerDisconnected,
  markPlayerReconnected,
  rebuyPlayer,
  removePlayer,
  shouldAutoFoldDisconnected,
} from './playerManager'
import { GameConfig, GameState } from './types'

function makeLobby(configOverrides: Partial<GameConfig> = {}): GameState {
  return createGame({ ...DEFAULT_CONFIG, ...configOverrides })
}

describe('playerManager', () => {
  it('addPlayer() adds player at seat; throws if seat occupied or game is full', () => {
    let game = makeLobby({ maxPlayers: 2 })
    game = addPlayer(game, 'A', 0).game
    expect(() => addPlayer(game, 'B', 0)).toThrow(/not available/i)

    game = addPlayer(game, 'B', 1).game
    expect(game.players).toHaveLength(2)
    expect(() => addPlayer(game, 'C', 0)).toThrow()
  })

  it('removePlayer() removes player by id', () => {
    let game = makeLobby({ maxPlayers: 3 })
    const added = addPlayer(game, 'A', 0)
    game = added.game
    game = addPlayer(game, 'B', 1).game

    const after = removePlayer(game, added.playerId)
    expect(after.players.some(p => p.id === added.playerId)).toBe(false)
    expect(after.players).toHaveLength(1)
  })

  it('findPlayerByToken() finds player by token, returns null if not found', () => {
    let game = makeLobby()
    const added = addPlayer(game, 'A', 0)
    game = added.game

    const found = findPlayerByToken(game, added.token)
    expect(found?.id).toBe(added.playerId)
    expect(findPlayerByToken(game, 'nope')).toBeNull()
  })

  it('markPlayerDisconnected() / markPlayerReconnected() toggles isConnected and disconnectTime', () => {
    let game = makeLobby()
    const added = addPlayer(game, 'A', 0)
    game = added.game

    const disconnected = markPlayerDisconnected(game, added.playerId)
    const discPlayer = disconnected.players.find(p => p.id === added.playerId)
    expect(discPlayer?.isConnected).toBe(false)
    expect(typeof discPlayer?.disconnectTime).toBe('number')

    const reconnected = markPlayerReconnected(disconnected, added.playerId)
    const recPlayer = reconnected.players.find(p => p.id === added.playerId)
    expect(recPlayer?.isConnected).toBe(true)
    expect(recPlayer?.disconnectTime).toBeNull()
  })

  it('rebuyPlayer() throws if player has chips > 0; resets chips to startingStack when busted', () => {
    let game = makeLobby({ startingStack: 500 })
    const added = addPlayer(game, 'A', 0)
    game = added.game

    expect(() => rebuyPlayer(game, added.playerId)).toThrow(/rebuy only allowed/i)

    const busted: GameState = {
      ...game,
      players: game.players.map(p => (p.id === added.playerId ? { ...p, chips: 0 } : p)),
    }

    const rebought = rebuyPlayer(busted, added.playerId)
    const player = rebought.players.find(p => p.id === added.playerId)
    expect(player?.chips).toBe(500)
  })

  it('shouldAutoFoldDisconnected() returns false when connected, false before timeout, true after timeout', () => {
    let game = makeLobby()
    const added = addPlayer(game, 'A', 0)
    game = added.game

    expect(shouldAutoFoldDisconnected(game, added.playerId, Date.now(), 30_000)).toBe(false)

    const justDisconnected = markPlayerDisconnected(game, added.playerId)
    expect(shouldAutoFoldDisconnected(justDisconnected, added.playerId, Date.now(), 30_000)).toBe(false)

    const longAgo = Date.now() - 31_000
    const timedOut: GameState = {
      ...justDisconnected,
      players: justDisconnected.players.map(p =>
        p.id === added.playerId ? { ...p, disconnectTime: longAgo } : p
      ),
    }
    expect(shouldAutoFoldDisconnected(timedOut, added.playerId, Date.now(), 30_000)).toBe(true)
  })
})
