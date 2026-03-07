import { describe, expect, it } from 'vitest'

import { DEFAULT_CONFIG } from './constants'
import { advanceDealer, createGame, getPlayerView, getShowdownResults, handleAction, isHandComplete, startHand } from './gameController'
import { makeGame } from './testUtils'
import { ActionType, GamePhase, GameState, Rank, Suit } from './types'

function bySeat(game: GameState, seatIndex: number) {
  const player = game.players.find(p => p.seatIndex === seatIndex)
  if (!player) {
    throw new Error(`Missing player at seat ${seatIndex}`)
  }
  return player
}

describe('gameController', () => {
  it('createGame() creates a game with correct config, waiting phase, empty players', () => {
    const game = createGame(DEFAULT_CONFIG)
    expect(game.config).toEqual(DEFAULT_CONFIG)
    expect(game.phase).toBe(GamePhase.Waiting)
    expect(game.players).toEqual([])
  })

  it('startHand() throws if < 2 players; deals 2 cards; posts blinds; sets activePlayerIndex', () => {
    const onePlayer = makeGame({ playerCount: 1 })
    expect(() => startHand(onePlayer)).toThrow(/Minimum 2 active players/)

    const lobby = makeGame({ playerCount: 2 })
    const started = startHand(lobby)

    expect(started.phase).toBe(GamePhase.Preflop)
    expect(started.communityCards).toHaveLength(0)
    expect(started.deck).toHaveLength(48)

    for (const p of started.players) {
      expect(p.holeCards).not.toBeNull()
      expect(p.holeCards).toHaveLength(2)
    }

    const p0 = bySeat(started, 0)
    const p1 = bySeat(started, 1)
    expect(p0.bet).toBe(started.config.smallBlind)
    expect(p1.bet).toBe(started.config.bigBlind)
    expect(started.activePlayerIndex).toBe(0)
  })

  it('handleAction() enforces turn order; processes fold/check/call/raise; advances phase when round completes', () => {
    const started2 = startHand(makeGame({ playerCount: 2 }))
    const activeSeat = started2.activePlayerIndex
    const inactiveSeat = activeSeat === 0 ? 1 : 0
    const active = bySeat(started2, activeSeat)
    const inactive = bySeat(started2, inactiveSeat)

    expect(() => handleAction(started2, inactive.id, { type: ActionType.Call })).toThrow(/Not this player's turn/)

    const afterCall = handleAction(started2, active.id, { type: ActionType.Call })
    expect(afterCall.activePlayerIndex).toBe(inactiveSeat)

    const afterCheck = handleAction(afterCall, inactive.id, { type: ActionType.Check })
    expect(afterCheck.phase).toBe(GamePhase.Flop)
    expect(afterCheck.communityCards).toHaveLength(3)
    expect(afterCheck.pot).toBe(4)
    expect(afterCheck.players.every(p => p.bet === 0)).toBe(true)
    expect(afterCheck.currentBet).toBe(0)

    const started3 = startHand(makeGame({ playerCount: 3 }))
    const raiser = bySeat(started3, started3.activePlayerIndex)
    const raisedTo = started3.config.bigBlind + started3.config.bigBlind
    const afterRaise = handleAction(started3, raiser.id, { type: ActionType.Raise, amount: raisedTo })
    expect(afterRaise.currentBet).toBe(raisedTo)
    expect(afterRaise.activePlayerIndex).not.toBe(raiser.seatIndex)

    const folded = handleAction(started2, active.id, { type: ActionType.Fold })
    expect(folded.phase).toBe(GamePhase.Showdown)
    expect(isHandComplete(folded)).toBe(true)
  })

  it('isHandComplete() false during preflop; true after showdown', () => {
    const started = startHand(makeGame({ playerCount: 2 }))
    expect(isHandComplete(started)).toBe(false)
    expect(isHandComplete({ ...started, phase: GamePhase.Showdown })).toBe(true)
  })

  it('getPlayerView() hides other hole cards; reveals at showdown; does not expose token', () => {
    const started = startHand(makeGame({ playerCount: 2 }))
    const viewer = bySeat(started, 0)
    const other = bySeat(started, 1)

    const view = getPlayerView(started, viewer.id)
    const viewViewer = view.players.find(p => p?.id === viewer.id)
    const viewOther = view.players.find(p => p?.id === other.id)
    expect(viewViewer?.holeCards).not.toBeNull()
    expect(viewOther?.holeCards).toBeNull()

    const tokenInView = view.players.some(p => {
      if (!p) {
        return false
      }
      const record = p as unknown as Record<string, unknown>
      return Object.prototype.hasOwnProperty.call(record, 'token')
    })
    expect(tokenInView).toBe(false)

    const showdownView = getPlayerView({ ...started, phase: GamePhase.Showdown }, viewer.id)
    expect(showdownView.players.every(p => p !== null && p.holeCards !== null)).toBe(true)
  })

  it('splits odd pots with remainder to first player by seat', () => {
    const lobby = makeGame({ playerCount: 2 })
    const board = [
      { rank: Rank.Two, suit: Suit.Clubs },
      { rank: Rank.Three, suit: Suit.Diamonds },
      { rank: Rank.Four, suit: Suit.Hearts },
      { rank: Rank.Five, suit: Suit.Spades },
      { rank: Rank.Six, suit: Suit.Diamonds },
    ]

    const p0 = bySeat(lobby, 0)
    const p1 = bySeat(lobby, 1)

    const river: GameState = {
      ...lobby,
      phase: GamePhase.River,
      communityCards: board,
      players: lobby.players.map(p => {
        if (p.id === p0.id) {
          return {
            ...p,
            chips: 0,
            holeCards: [
              { rank: Rank.Ace, suit: Suit.Spades },
              { rank: Rank.King, suit: Suit.Spades },
            ],
            totalBetThisHand: 3,
            bet: 0,
          }
        }
        if (p.id === p1.id) {
          return {
            ...p,
            chips: 0,
            holeCards: [
              { rank: Rank.Ace, suit: Suit.Hearts },
              { rank: Rank.King, suit: Suit.Hearts },
            ],
            totalBetThisHand: 2,
            bet: 0,
          }
        }
        return p
      }),
    }

    const showdown = getShowdownResults(river)
    expect(showdown.phase).toBe(GamePhase.Showdown)
    expect(bySeat(showdown, 0).chips).toBe(3)
    expect(bySeat(showdown, 1).chips).toBe(2)
  })

  it('advanceDealer() rotates dealer seat clockwise across multiple hands', () => {
    const lobby = makeGame({ playerCount: 3 })

    const hand1 = startHand(lobby)
    expect(hand1.dealerIndex).toBe(0)

    const hand2 = startHand({ ...hand1, phase: GamePhase.Showdown })
    expect(hand2.dealerIndex).toBe(1)

    const hand3 = startHand({ ...hand2, phase: GamePhase.Showdown })
    expect(hand3.dealerIndex).toBe(2)

    const hand4 = startHand({ ...hand3, phase: GamePhase.Showdown })
    expect(hand4.dealerIndex).toBe(0)
  })

  it('advanceDealer() skips busted seats (0 chips) when rotating', () => {
    const lobby = makeGame({ playerCount: 3 })
    const p1 = bySeat(lobby, 1)
    const lobbyWithBustedP1: GameState = {
      ...lobby,
      players: lobby.players.map(p => p.id === p1.id ? { ...p, chips: 0 } : p),
    }

    const hand1 = startHand(lobbyWithBustedP1)
    expect(hand1.dealerIndex).toBe(0)

    const hand2 = startHand({ ...hand1, phase: GamePhase.Showdown })
    expect(hand2.dealerIndex).toBe(1)
  })
})
