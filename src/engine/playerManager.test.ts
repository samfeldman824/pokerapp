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
import { GameConfig, GamePhase, GameState, Rank, Suit } from './types'

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

  it('rebuyPlayer() throws if player is at or above startingStack; tops up short-stacked or busted player', () => {
    let game = makeLobby({ startingStack: 500 })
    const added = addPlayer(game, 'A', 0)
    game = added.game

    expect(() => rebuyPlayer(game, added.playerId)).toThrow(/already at or above starting stack/i)

    const shortStacked: GameState = {
      ...game,
      players: game.players.map(p => (p.id === added.playerId ? { ...p, chips: 200 } : p)),
    }

    const toppedUp = rebuyPlayer(shortStacked, added.playerId)
    expect(toppedUp.players.find(p => p.id === added.playerId)?.chips).toBe(500)

    const busted: GameState = {
      ...game,
      players: game.players.map(p => (p.id === added.playerId ? { ...p, chips: 0 } : p)),
    }

    const rebought = rebuyPlayer(busted, added.playerId)
    const player = rebought.players.find(p => p.id === added.playerId)
    expect(player?.chips).toBe(500)
  })

  it('rebuyPlayer() throws when player is short-stacked and hand is in progress (Preflop)', () => {
    let game = makeLobby({ startingStack: 500 })
    const addedA = addPlayer(game, 'A', 0)
    game = addedA.game
    const addedB = addPlayer(game, 'B', 1)
    game = addedB.game

    const inHand: GameState = {
      ...game,
      phase: GamePhase.Preflop,
      players: game.players.map(p =>
        p.id === addedA.playerId
          ? {
              ...p,
              chips: 100,
              holeCards: [
                { rank: Rank.Ace, suit: Suit.Spades },
                { rank: Rank.King, suit: Suit.Clubs },
              ],
            }
          : p
      ),
    }

    expect(() => rebuyPlayer(inHand, addedA.playerId)).toThrow(/cannot rebuy during an active hand/i)
  })

  it('rebuyPlayer() throws when hand is at River (mid-hand, multiple players still active)', () => {
    let game = makeLobby({ startingStack: 500 })
    const addedA = addPlayer(game, 'A', 0)
    game = addedA.game
    const addedB = addPlayer(game, 'B', 1)
    game = addedB.game

    const midHand: GameState = {
      ...game,
      phase: GamePhase.River,
      players: game.players.map(p =>
        p.id === addedA.playerId ? { ...p, chips: 200, totalBetThisHand: 50 } : p
      ),
    }

    expect(() => rebuyPlayer(midHand, addedA.playerId)).toThrow(/cannot rebuy during an active hand/i)
  })

  it('rebuyPlayer() allows rebuy at Showdown (hand complete, hole cards still set)', () => {
    let game = makeLobby({ startingStack: 500 })
    const added = addPlayer(game, 'A', 0)
    game = added.game

    const atShowdown: GameState = {
      ...game,
      phase: GamePhase.Showdown,
      players: game.players.map(p =>
        p.id === added.playerId
          ? {
              ...p,
              chips: 0,
              isAllIn: false,
              holeCards: [
                { rank: Rank.Ace, suit: Suit.Spades },
                { rank: Rank.King, suit: Suit.Clubs },
              ],
              totalBetThisHand: 500,
            }
          : p
      ),
    }

    const result = rebuyPlayer(atShowdown, added.playerId)
    expect(result.players.find(p => p.id === added.playerId)?.chips).toBe(500)
  })

  it('rebuyPlayer() throws when player chips equals startingStack (exactly at stack)', () => {
    let game = makeLobby({ startingStack: 500 })
    const added = addPlayer(game, 'A', 0)
    game = added.game

    expect(() => rebuyPlayer(game, added.playerId)).toThrow(/already at or above starting stack/i)
  })

  it('rebuyPlayer() throws when player chips exceed startingStack', () => {
    let game = makeLobby({ startingStack: 500 })
    const added = addPlayer(game, 'A', 0)
    game = added.game

    const overStack: GameState = {
      ...game,
      players: game.players.map(p => (p.id === added.playerId ? { ...p, chips: 600 } : p)),
    }

    expect(() => rebuyPlayer(overStack, added.playerId)).toThrow(/already at or above starting stack/i)
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
