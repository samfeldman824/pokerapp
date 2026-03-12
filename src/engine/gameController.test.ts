import { describe, expect, it } from 'vitest'

import { DEFAULT_CONFIG } from './constants'
import { advanceDealer, createGame, getCurrentBlinds, getPlayerView, getShowdownResults, handleAction, isHandComplete, resetGame, startHand } from './gameController'
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

  it('handleAction() after preflop all-in the opponent must be able to call before the phase advances', () => {
    const started = startHand(makeGame({ playerCount: 2 }))
    const activeSeat = started.activePlayerIndex
    const otherSeat = activeSeat === 0 ? 1 : 0
    const actingPlayer = bySeat(started, activeSeat)

    const allInAmount = actingPlayer.chips + actingPlayer.bet
    const afterAllIn = handleAction(started, actingPlayer.id, { type: ActionType.Raise, amount: allInAmount })

    expect(afterAllIn.phase).toBe(GamePhase.Preflop)
    expect(afterAllIn.activePlayerIndex).toBe(otherSeat)
    expect(afterAllIn.currentBet).toBe(allInAmount)

    const opponent = bySeat(started, otherSeat)
    const afterCall = handleAction(afterAllIn, opponent.id, { type: ActionType.Call })
    expect(afterCall.phase).not.toBe(GamePhase.Preflop)
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
    const showdownActivePlayers = showdownView.players.filter(Boolean)
    expect(showdownActivePlayers.length).toBe(started.players.length)
    expect(showdownActivePlayers.every(p => p!.holeCards !== null)).toBe(true)
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

  it('startHand() clears lastAction for all players', () => {
    const lobby = makeGame({ playerCount: 2 })
    const p0 = bySeat(lobby, 0)
    const p1 = bySeat(lobby, 1)

    const lobbyWithLastAction: GameState = {
      ...lobby,
      players: lobby.players.map(p => ({
        ...p,
        lastAction: {
          type: ActionType.Fold,
          timestamp: Date.now() - 1000,
        },
      })),
    }

    const started = startHand(lobbyWithLastAction)

    for (const player of started.players) {
      expect(player.lastAction).toBeNull()
    }
  })

  it('getPlayerView() reveals hole cards when shownCards is set for a player', () => {
    const started = startHand(makeGame({ playerCount: 2 }))
    const p0 = bySeat(started, 0)
    const p1 = bySeat(started, 1)

    const gameWithShownCards: GameState = {
      ...started,
      shownCards: {
        [p1.id]: true,
      },
    }

    const p0View = getPlayerView(gameWithShownCards, p0.id)
    const p0ViewSelf = p0View.players.find(p => p?.id === p0.id)
    const p0ViewOther = p0View.players.find(p => p?.id === p1.id)

    expect(p0ViewSelf?.holeCards).not.toBeNull()
    expect(p0ViewOther?.holeCards).not.toBeNull()
    expect(p0ViewOther?.holeCards).toEqual(p1.holeCards)
  })

  describe('getCurrentBlinds()', () => {
    const blindSchedule = [
      { smallBlind: 1, bigBlind: 2 },
      { smallBlind: 2, bigBlind: 4 },
      { smallBlind: 5, bigBlind: 10 },
    ]

    it('returns base config blinds when blindSchedule is undefined (backward compat)', () => {
      const config = { ...DEFAULT_CONFIG, blindSchedule: undefined, blindIncreaseInterval: undefined }
      expect(getCurrentBlinds(config, 1)).toEqual({ smallBlind: 1, bigBlind: 2 })
      expect(getCurrentBlinds(config, 99)).toEqual({ smallBlind: 1, bigBlind: 2 })
    })

    it('returns base config blinds when blindSchedule is empty array', () => {
      const config = { ...DEFAULT_CONFIG, blindSchedule: [], blindIncreaseInterval: 5 }
      expect(getCurrentBlinds(config, 1)).toEqual({ smallBlind: 1, bigBlind: 2 })
    })

    it('returns the correct level based on handNumber and interval', () => {
      const config = { ...DEFAULT_CONFIG, blindSchedule, blindIncreaseInterval: 5 }
      // hands 1-5 → level 0
      expect(getCurrentBlinds(config, 1)).toEqual({ smallBlind: 1, bigBlind: 2 })
      expect(getCurrentBlinds(config, 5)).toEqual({ smallBlind: 1, bigBlind: 2 })
      // hands 6-10 → level 1
      expect(getCurrentBlinds(config, 6)).toEqual({ smallBlind: 2, bigBlind: 4 })
      expect(getCurrentBlinds(config, 10)).toEqual({ smallBlind: 2, bigBlind: 4 })
      // hands 11-15 → level 2
      expect(getCurrentBlinds(config, 11)).toEqual({ smallBlind: 5, bigBlind: 10 })
    })

    it('is capped at the last schedule level (does not go out of bounds)', () => {
      const config = { ...DEFAULT_CONFIG, blindSchedule, blindIncreaseInterval: 5 }
      // hand 20+ should still be the last level (index 2)
      expect(getCurrentBlinds(config, 20)).toEqual({ smallBlind: 5, bigBlind: 10 })
      expect(getCurrentBlinds(config, 999)).toEqual({ smallBlind: 5, bigBlind: 10 })
    })

    it('handles hand boundary at exactly the first hand of a new level', () => {
      const config = { ...DEFAULT_CONFIG, blindSchedule, blindIncreaseInterval: 10 }
      // hand 10 → level index = floor(9/10) = 0
      expect(getCurrentBlinds(config, 10)).toEqual({ smallBlind: 1, bigBlind: 2 })
      // hand 11 → level index = floor(10/10) = 1
      expect(getCurrentBlinds(config, 11)).toEqual({ smallBlind: 2, bigBlind: 4 })
    })
  })

  it('startHand() uses correct blinds at different hand numbers when blind schedule is configured', () => {
    const blindSchedule = [
      { smallBlind: 1, bigBlind: 2 },
      { smallBlind: 5, bigBlind: 10 },
    ]
    // interval=5: hands 1-5 → level 0 (1/2), hands 6-10 → level 1 (5/10)
    const game = makeGame({ config: { blindSchedule, blindIncreaseInterval: 5 } })

    // First hand — handNumber starts at 0, startHand uses handNumber+1=1 → level 0
    const hand1 = startHand(game)
    expect(hand1.config.smallBlind).toBe(1)
    expect(hand1.config.bigBlind).toBe(2)
    expect(hand1.handNumber).toBe(1)

    // Simulate 5 more hands to reach level 1 (hand 6)
    let current: GameState = { ...hand1, phase: GamePhase.Showdown }
    for (let i = 0; i < 4; i++) {
      current = startHand(current)
      current = { ...current, phase: GamePhase.Showdown }
    }
    // Now handNumber === 5, next startHand uses handNumber+1=6 → level 1
    const hand6 = startHand(current)
    expect(hand6.config.smallBlind).toBe(5)
    expect(hand6.config.bigBlind).toBe(10)
    expect(hand6.handNumber).toBe(6)
  })

  it('resetGame() keeps players but resets chips, phase, and hand state', () => {
    const lobby = makeGame({ playerCount: 3 })
    const started = startHand(lobby)
    const p0 = bySeat(started, 0)
    const afterAction = handleAction(started, p0.id, { type: ActionType.Fold })

    const reset = resetGame(afterAction)

    expect(reset.phase).toBe(GamePhase.Waiting)
    expect(reset.pot).toBe(0)
    expect(reset.communityCards).toEqual([])
    expect(reset.dealerIndex).toBe(-1)
    expect(reset.activePlayerIndex).toBe(-1)
    expect(reset.handNumber).toBe(0)
    expect(reset.deck).toEqual([])
    expect(reset.isPaused).toBe(false)

    expect(reset.players).toHaveLength(3)
    for (const player of reset.players) {
      expect(player.chips).toBe(reset.config.startingStack)
      expect(player.holeCards).toBeNull()
      expect(player.bet).toBe(0)
      expect(player.totalBetThisHand).toBe(0)
      expect(player.isFolded).toBe(false)
      expect(player.isAllIn).toBe(false)
      expect(player.lastAction).toBeNull()
    }

    expect(reset.players.map(p => p.seatIndex)).toEqual([0, 1, 2])
    expect(reset.config).toEqual(afterAction.config)
  })
})
