import { describe, expect, it } from 'vitest'

import { DEFAULT_CONFIG } from './constants'
import { advanceDealer, advanceRunout, createGame, getCurrentBlinds, getPlayerView, getRunItTwiceResults, getShowdownResults, handleAction as handleActionResult, isHandComplete, resetGame, startHand } from './gameController'
import { makeGame } from './testUtils'
import { ActionType, GamePhase, GameState, PlayerAction, Rank, Suit } from './types'

function bySeat(game: GameState, seatIndex: number) {
  const player = game.players.find(p => p.seatIndex === seatIndex)
  if (!player) {
    throw new Error(`Missing player at seat ${seatIndex}`)
  }
  return player
}

function handleAction(game: GameState, playerId: string, action: PlayerAction): GameState {
  return handleActionResult(game, playerId, action).game
}

function handleActionWithResult(game: GameState, playerId: string, action: PlayerAction) {
  return handleActionResult(game, playerId, action)
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

  it('handleAction() advances to flop (not showdown) when only one player is not all-in after preflop', () => {
    const lobby = makeGame({ playerCount: 3 })
    const started = startHand(lobby)
    const p0 = bySeat(started, 0)
    const p1 = bySeat(started, 1)
    const p2 = bySeat(started, 2)

    const setupGame: GameState = {
      ...started,
      phase: GamePhase.Preflop,
      currentBet: 500,
      playersToAct: [p2.seatIndex],
      activePlayerIndex: p2.seatIndex,
      players: started.players.map((p) => {
        if (p.id === p0.id) return { ...p, chips: 0, bet: 500, totalBetThisHand: 500, isAllIn: true }
        if (p.id === p1.id) return { ...p, chips: 0, bet: 500, totalBetThisHand: 500, isAllIn: true }
        if (p.id === p2.id) return { ...p, chips: 1000, bet: 0, totalBetThisHand: 0, isAllIn: false }
        return p
      }),
    }

    const result = handleAction(setupGame, p2.id, { type: ActionType.Call })

    expect(result.phase).toBe(GamePhase.Flop)
    expect(result.activePlayerIndex).toBe(-1)
    expect(result.communityCards).toHaveLength(3)
  })

  it('handleAction() advances to turn (not showdown) when player goes all-in on flop and is called by bigger stack', () => {
    const lobby = makeGame({ playerCount: 2 })
    const started = startHand(lobby)
    const p0 = bySeat(started, 0)
    const p1 = bySeat(started, 1)

    const flopGame: GameState = {
      ...started,
      phase: GamePhase.Flop,
      currentBet: 0,
      communityCards: started.deck.slice(0, 3),
      deck: started.deck.slice(3),
      pot: 10,
      playersToAct: [p0.seatIndex, p1.seatIndex],
      activePlayerIndex: p0.seatIndex,
      players: started.players.map((p) => {
        if (p.id === p0.id) return { ...p, chips: 100, bet: 0, totalBetThisHand: 5, isFolded: false, isAllIn: false }
        if (p.id === p1.id) return { ...p, chips: 500, bet: 0, totalBetThisHand: 5, isFolded: false, isAllIn: false }
        return p
      }),
    }

    const afterAllIn = handleAction(flopGame, p0.id, { type: ActionType.Bet, amount: 100 })
    expect(afterAllIn.phase).toBe(GamePhase.Flop)
    expect(afterAllIn.activePlayerIndex).toBe(p1.seatIndex)

    const result = handleAction(afterAllIn, p1.id, { type: ActionType.Call })

    expect(result.phase).toBe(GamePhase.Turn)
    expect(result.activePlayerIndex).toBe(-1)
    expect(result.communityCards).toHaveLength(4)
  })

  it('handleAction() advances to turn via real flow: preflop call, flop all-in, bigger stack calls', () => {
    const lobby = makeGame({ playerCount: 2 })
    const started = startHand(lobby)
    const p0 = bySeat(started, 0)
    const p1 = bySeat(started, 1)

    const afterCall = handleAction(started, p0.id, { type: ActionType.Call })
    const afterFlop = handleAction(afterCall, p1.id, { type: ActionType.Check })
    expect(afterFlop.phase).toBe(GamePhase.Flop)

    const flopP0 = bySeat(afterFlop, p0.seatIndex)
    const flopP1 = bySeat(afterFlop, p1.seatIndex)
    const firstActor = afterFlop.activePlayerIndex === flopP0.seatIndex ? flopP0 : flopP1
    const secondActor = firstActor.id === flopP0.id ? flopP1 : flopP0

    const afterFlopAllIn = handleAction(afterFlop, firstActor.id, {
      type: ActionType.Bet,
      amount: firstActor.chips,
    })
    expect(afterFlopAllIn.phase).toBe(GamePhase.Flop)
    expect(afterFlopAllIn.activePlayerIndex).toBe(secondActor.seatIndex)

    const result = handleAction(afterFlopAllIn, secondActor.id, { type: ActionType.Call })

    expect(result.phase).toBe(GamePhase.Turn)
    expect(result.activePlayerIndex).toBe(-1)
    expect(result.communityCards).toHaveLength(4)
  })

  it('handleAction() advances to turn (not showdown) when mid-flop fold leaves only one non-all-in player', () => {
    const lobby = makeGame({ playerCount: 3 })
    const started = startHand(lobby)
    const p0 = bySeat(started, 0)
    const p1 = bySeat(started, 1)
    const p2 = bySeat(started, 2)

    const flopGame: GameState = {
      ...started,
      phase: GamePhase.Flop,
      currentBet: 0,
      communityCards: started.deck.slice(0, 3),
      deck: started.deck.slice(3),
      pot: 300,
      playersToAct: [p0.seatIndex, p2.seatIndex],
      activePlayerIndex: p0.seatIndex,
      players: started.players.map((p) => {
        if (p.id === p0.id) return { ...p, chips: 200, bet: 0, totalBetThisHand: 100, isFolded: false }
        if (p.id === p1.id) return { ...p, chips: 0, bet: 0, totalBetThisHand: 100, isAllIn: true }
        if (p.id === p2.id) return { ...p, chips: 700, bet: 0, totalBetThisHand: 100, isFolded: false }
        return p
      }),
    }

    const result = handleAction(flopGame, p0.id, { type: ActionType.Fold })

    expect(result.phase).toBe(GamePhase.Turn)
    expect(result.activePlayerIndex).toBe(-1)
    expect(result.communityCards).toHaveLength(4)
  })

  it('handleAction() advances to river (not showdown) when player goes all-in on turn and is called by bigger stack', () => {
    const lobby = makeGame({ playerCount: 2 })
    const started = startHand(lobby)
    const p0 = bySeat(started, 0)
    const p1 = bySeat(started, 1)

    const turnGame: GameState = {
      ...started,
      phase: GamePhase.Turn,
      currentBet: 0,
      communityCards: started.deck.slice(0, 4),
      deck: started.deck.slice(4),
      pot: 10,
      playersToAct: [p0.seatIndex, p1.seatIndex],
      activePlayerIndex: p0.seatIndex,
      players: started.players.map((p) => {
        if (p.id === p0.id) return { ...p, chips: 100, bet: 0, totalBetThisHand: 5, isFolded: false, isAllIn: false }
        if (p.id === p1.id) return { ...p, chips: 500, bet: 0, totalBetThisHand: 5, isFolded: false, isAllIn: false }
        return p
      }),
    }

    const afterAllIn = handleAction(turnGame, p0.id, { type: ActionType.Bet, amount: 100 })
    expect(afterAllIn.phase).toBe(GamePhase.Turn)
    expect(afterAllIn.activePlayerIndex).toBe(p1.seatIndex)

    const result = handleAction(afterAllIn, p1.id, { type: ActionType.Call })

    expect(result.phase).toBe(GamePhase.River)
    expect(result.activePlayerIndex).toBe(-1)
    expect(result.communityCards).toHaveLength(5)
  })

  it('handleAction() advances to river (not showdown) when mid-turn fold leaves only one non-all-in player', () => {
    const lobby = makeGame({ playerCount: 3 })
    const started = startHand(lobby)
    const p0 = bySeat(started, 0)
    const p1 = bySeat(started, 1)
    const p2 = bySeat(started, 2)

    const turnGame: GameState = {
      ...started,
      phase: GamePhase.Turn,
      currentBet: 0,
      communityCards: started.deck.slice(0, 4),
      deck: started.deck.slice(4),
      pot: 300,
      playersToAct: [p0.seatIndex, p2.seatIndex],
      activePlayerIndex: p0.seatIndex,
      players: started.players.map((p) => {
        if (p.id === p0.id) return { ...p, chips: 200, bet: 0, totalBetThisHand: 100, isFolded: false, isAllIn: false }
        if (p.id === p1.id) return { ...p, chips: 0, bet: 0, totalBetThisHand: 100, isAllIn: true }
        if (p.id === p2.id) return { ...p, chips: 700, bet: 0, totalBetThisHand: 100, isFolded: false, isAllIn: false }
        return p
      }),
    }

    const result = handleAction(turnGame, p0.id, { type: ActionType.Fold })

    expect(result.phase).toBe(GamePhase.River)
    expect(result.activePlayerIndex).toBe(-1)
    expect(result.communityCards).toHaveLength(5)
  })

  it('handleAction() runs board out via real flow: 3-player, p0 folds preflop, p1 all-in on flop, p2 bigger stack calls', () => {
    const lobby = makeGame({ playerCount: 3 })
    const started = startHand(lobby)
    const p0 = bySeat(started, 0)
    const p1 = bySeat(started, 1)
    const p2 = bySeat(started, 2)

    const afterP0Fold = handleAction(started, p0.id, { type: ActionType.Fold })
    const afterP1Call = handleAction(afterP0Fold, p1.id, { type: ActionType.Call })
    const afterFlop = handleAction(afterP1Call, p2.id, { type: ActionType.Check })
    expect(afterFlop.phase).toBe(GamePhase.Flop)

    const flopP1 = bySeat(afterFlop, p1.seatIndex)
    const flopP2 = bySeat(afterFlop, p2.seatIndex)
    const flopWithSmallStack: GameState = {
      ...afterFlop,
      players: afterFlop.players.map((p) => {
        if (!p) return p
        if (p.id === flopP1.id) return { ...p, chips: 50, isAllIn: false }
        return p
      }),
    }

    expect(flopWithSmallStack.activePlayerIndex).toBe(p1.seatIndex)

    const afterAllIn = handleAction(flopWithSmallStack, flopP1.id, { type: ActionType.Bet, amount: 50 })
    expect(afterAllIn.phase).toBe(GamePhase.Flop)
    expect(afterAllIn.activePlayerIndex).toBe(flopP2.seatIndex)

    const result = handleAction(afterAllIn, flopP2.id, { type: ActionType.Call })

    expect(result.phase).toBe(GamePhase.Turn)
    expect(result.activePlayerIndex).toBe(-1)
    expect(result.communityCards).toHaveLength(4)
  })

  it('isHandComplete() false during preflop; true after showdown', () => {
    const started = startHand(makeGame({ playerCount: 2 }))
    expect(isHandComplete(started)).toBe(false)
    expect(isHandComplete({ ...started, phase: GamePhase.Showdown })).toBe(true)
  })

  it('getPlayerView() hides other hole cards unless explicitly shown; does not expose token', () => {
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
    const showdownViewer = showdownView.players.find(p => p?.id === viewer.id)
    const showdownOther = showdownView.players.find(p => p?.id === other.id)
    expect(showdownViewer?.holeCards).not.toBeNull()
    expect(showdownOther?.holeCards).toBeNull()
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

  describe('run it twice', () => {
    it('handleAction() returns discriminated result kinds and sets runout eligibility when all players are all-in with cards to come', () => {
      const started = startHand(makeGame({ playerCount: 2, config: { runItTwice: true } }))
      const activeSeat = started.activePlayerIndex
      const otherSeat = activeSeat === 0 ? 1 : 0
      const actingPlayer = bySeat(started, activeSeat)
      const otherPlayer = bySeat(started, otherSeat)

      const setup: GameState = {
        ...started,
        currentBet: 2,
        players: started.players.map((p) => {
          if (p.id === actingPlayer.id) {
            return { ...p, chips: 49, bet: 1, totalBetThisHand: 1, isAllIn: false }
          }
          if (p.id === otherPlayer.id) {
            return { ...p, chips: 48, bet: 2, totalBetThisHand: 2, isAllIn: false }
          }
          return p
        }),
      }

      const afterAllIn = handleActionWithResult(setup, actingPlayer.id, { type: ActionType.Raise, amount: 50 })
      expect(afterAllIn.kind).toBe('waitingForAction')
      expect(afterAllIn.game.phase).toBe(GamePhase.Preflop)

      const afterCall = handleActionWithResult(afterAllIn.game, otherPlayer.id, { type: ActionType.Call })
      expect(afterCall.kind).toBe('waitingForAction')
      expect(afterCall.game.runItTwiceDecisionPending).toBe(true)
      expect(afterCall.game.runItTwiceEligible).toBe(false)
      expect(afterCall.game.currentRunIndex).toBeNull()
      expect(afterCall.game.runoutStartPhase).toBeNull()
      expect(afterCall.game.runoutPhase).toBeNull()
      expect(Object.keys(afterCall.game.runItTwiceVotes)).toHaveLength(2)
      expect(afterCall.game.activePlayerIndex).toBe(-1)

      const showdownByFold = handleActionWithResult(started, actingPlayer.id, { type: ActionType.Fold })
      expect(showdownByFold.kind).toBe('showdown')
      expect(showdownByFold.game.phase).toBe(GamePhase.Showdown)
    })

    it.each([
      { startPhase: GamePhase.Preflop, expectedRunoutCalls: 8, expectedFirstBoardLength: 5, expectedSecondBoardLength: 5 },
      { startPhase: GamePhase.Flop, expectedRunoutCalls: 6, expectedFirstBoardLength: 5, expectedSecondBoardLength: 5 },
      { startPhase: GamePhase.Turn, expectedRunoutCalls: 4, expectedFirstBoardLength: 5, expectedSecondBoardLength: 5 },
    ])(
      'advanceRunout() handles $startPhase dual-board flow and reaches showdown',
      ({ startPhase, expectedRunoutCalls, expectedFirstBoardLength, expectedSecondBoardLength }) => {
        const started = startHand(makeGame({ playerCount: 2, config: { runItTwice: true } }))
        const p0 = bySeat(started, 0)
        const p1 = bySeat(started, 1)

        const visibleCommunity = startPhase === GamePhase.Preflop
          ? []
          : (startPhase === GamePhase.Flop ? started.deck.slice(0, 3) : started.deck.slice(0, 4))
        const remainingDeck = startPhase === GamePhase.Preflop
          ? started.deck
          : started.deck.slice(visibleCommunity.length)

        let runoutGame: GameState = {
          ...started,
          phase: GamePhase.River,
          communityCards: visibleCommunity,
          deck: remainingDeck,
          runItTwiceEligible: true,
          currentRunIndex: 0,
          runoutPhase: startPhase,
          runoutStartPhase: startPhase,
          firstBoard: null,
          secondBoard: null,
          activePlayerIndex: -1,
          currentBet: 0,
          playersToAct: [],
          players: started.players.map((p) => {
            if (p.id === p0.id) {
              return { ...p, chips: 0, totalBetThisHand: 50, bet: 0, isAllIn: true, isFolded: false }
            }
            if (p.id === p1.id) {
              return { ...p, chips: 0, totalBetThisHand: 50, bet: 0, isAllIn: true, isFolded: false }
            }
            return p
          }),
        }

        for (let i = 0; i < expectedRunoutCalls; i += 1) {
          runoutGame = advanceRunout(runoutGame)
        }

        expect(runoutGame.phase).toBe(GamePhase.Showdown)
        expect(runoutGame.firstBoard).not.toBeNull()
        expect(runoutGame.secondBoard).not.toBeNull()
        expect(runoutGame.firstBoard).toHaveLength(expectedFirstBoardLength)
        expect(runoutGame.secondBoard).toHaveLength(expectedSecondBoardLength)
        expect(runoutGame.currentRunIndex).toBeNull()
        expect(runoutGame.runoutPhase).toBeNull()
      }
    )

    it('getRunItTwiceResults() splits odd chips to run 0 and combines payouts across both boards', () => {
      const lobby = makeGame({ playerCount: 2, config: { runItTwice: true } })
      const p0 = bySeat(lobby, 0)
      const p1 = bySeat(lobby, 1)

      const game: GameState = {
        ...lobby,
        phase: GamePhase.River,
        runItTwiceEligible: true,
        runoutStartPhase: GamePhase.Preflop,
        firstBoard: [
          { rank: Rank.Ace, suit: Suit.Hearts },
          { rank: Rank.King, suit: Suit.Diamonds },
          { rank: Rank.Two, suit: Suit.Clubs },
          { rank: Rank.Three, suit: Suit.Hearts },
          { rank: Rank.Four, suit: Suit.Spades },
        ],
        secondBoard: [
          { rank: Rank.Queen, suit: Suit.Hearts },
          { rank: Rank.Jack, suit: Suit.Diamonds },
          { rank: Rank.Two, suit: Suit.Clubs },
          { rank: Rank.Three, suit: Suit.Hearts },
          { rank: Rank.Four, suit: Suit.Spades },
        ],
        players: lobby.players.map((p) => {
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
              isFolded: false,
              isAllIn: true,
            }
          }
          if (p.id === p1.id) {
            return {
              ...p,
              chips: 0,
              holeCards: [
                { rank: Rank.Queen, suit: Suit.Clubs },
                { rank: Rank.Jack, suit: Suit.Clubs },
              ],
              totalBetThisHand: 2,
              bet: 0,
              isFolded: false,
              isAllIn: true,
            }
          }
          return p
        }),
      }

      const showdown = getRunItTwiceResults(game)

      expect(showdown.phase).toBe(GamePhase.Showdown)
      expect(bySeat(showdown, 0).chips).toBe(3)
      expect(bySeat(showdown, 1).chips).toBe(2)
      expect(bySeat(showdown, 0).chips + bySeat(showdown, 1).chips).toBe(5)
    })
  })
  it('BUG REPRO: advances to flop (not showdown) when P0 goes all-in preflop and P1 calls with bigger stack', () => {
    const lobby = makeGame({ playerCount: 2 })
    const started = startHand(lobby)
    const p0 = bySeat(started, 0)
    const p1 = bySeat(started, 1)

    const unequalGame: GameState = {
      ...started,
      currentBet: 2,
      players: started.players.map(p => {
        if (p.id === p0.id) return { ...p, chips: 49, bet: 1, totalBetThisHand: 1, isAllIn: false }
        if (p.id === p1.id) return { ...p, chips: 198, bet: 2, totalBetThisHand: 2, isAllIn: false }
        return p
      }),
    }

    const afterAllIn = handleAction(unequalGame, p0.id, { type: ActionType.Raise, amount: 50 })
    expect(afterAllIn.phase).toBe(GamePhase.Preflop)
    expect(afterAllIn.activePlayerIndex).toBe(p1.seatIndex)

    const afterCall = handleAction(afterAllIn, p1.id, { type: ActionType.Call })
    expect(afterCall.phase).toBe(GamePhase.Flop)
    expect(afterCall.activePlayerIndex).toBe(-1)
    expect(afterCall.communityCards).toHaveLength(3)
  })
})
