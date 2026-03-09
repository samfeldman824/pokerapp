import { describe, expect, it } from 'vitest'

import { applyAction, getNextActivePlayer, isRoundComplete, postBlinds, validateAction } from './betting'
import { makeGame } from './testUtils'
import { ActionType, GamePhase, GameState, PlayerState } from './types'

function withPreflop(game: GameState): GameState {
  return {
    ...game,
    phase: GamePhase.Preflop,
    dealerIndex: 0,
    currentBet: 0,
    minRaise: game.config.bigBlind,
    lastRaiseAmount: game.config.bigBlind,
    playersToAct: [],
    activePlayerIndex: -1,
    pot: 0,
    communityCards: [],
    deck: [],
    sidePots: [],
    handNumber: 1,
    timerStart: null,
    actionTimerStart: null,
    isPaused: false,
    hostPlayerId: game.hostPlayerId,
  }
}

function atSeat(game: GameState, seatIndex: number): PlayerState {
  const player = game.players[seatIndex]
  if (!player) {
    throw new Error(`No player at seat ${seatIndex}`)
  }
  return player
}

describe('betting', () => {
  it('postBlinds() posts SB/BB correctly for heads-up and 3+ players', () => {
    const headsUp = withPreflop(makeGame({ playerCount: 2 }))
    const huAfter = postBlinds(headsUp)

    expect(atSeat(huAfter, 0).bet).toBe(huAfter.config.smallBlind)
    expect(atSeat(huAfter, 1).bet).toBe(huAfter.config.bigBlind)
    expect(huAfter.currentBet).toBe(huAfter.config.bigBlind)
    expect(huAfter.activePlayerIndex).toBe(0)

    const three = withPreflop(makeGame({ playerCount: 3 }))
    const threeAfter = postBlinds(three)

    expect(atSeat(threeAfter, 1).bet).toBe(threeAfter.config.smallBlind)
    expect(atSeat(threeAfter, 2).bet).toBe(threeAfter.config.bigBlind)
    expect(threeAfter.activePlayerIndex).toBe(0)
  })

  it('validateAction() validates fold/check/call/raise rules', () => {
    const game = postBlinds(withPreflop(makeGame({ playerCount: 2 })))
    const active = atSeat(game, game.activePlayerIndex)
    const currentBet = game.currentBet ?? 0

    expect(validateAction(game, active.id, { type: ActionType.Fold })).toEqual({ valid: true })

    expect(validateAction(game, active.id, { type: ActionType.Check }).valid).toBe(false)
    expect(validateAction(game, active.id, { type: ActionType.Call }).valid).toBe(true)

    const minRaise = game.minRaise ?? game.config.bigBlind
    expect(validateAction(game, active.id, { type: ActionType.Raise, amount: currentBet + minRaise }).valid).toBe(true)
    expect(validateAction(game, active.id, { type: ActionType.Raise, amount: currentBet + minRaise - 1 }).valid).toBe(false)
  })

  it('applyAction() updates folded state, chips/bets, currentBet and minRaise', () => {
    const base = postBlinds(withPreflop(makeGame({ playerCount: 2 })))
    const sbSeat = base.activePlayerIndex

    const folded = applyAction(base, { type: ActionType.Fold })
    expect(atSeat(folded, sbSeat).isFolded).toBe(true)

    const called = applyAction(base, { type: ActionType.Call })
    const sbCalled = atSeat(called, sbSeat)
    expect(sbCalled.bet).toBe(base.currentBet ?? 0)
    expect(sbCalled.totalBetThisHand).toBe(base.config.smallBlind + (base.config.bigBlind - base.config.smallBlind))
    expect(sbCalled.chips).toBe(base.config.startingStack - base.config.bigBlind)

    const raiseAmount = (base.currentBet ?? 0) + base.config.bigBlind
    const raised = applyAction(base, { type: ActionType.Raise, amount: raiseAmount })
    expect(raised.currentBet).toBe(raiseAmount)
    expect(raised.minRaise).toBe(base.config.bigBlind)
  })

  it('isRoundComplete() true when all active players have matched bet; false when player still to act', () => {
    const afterBlinds = postBlinds(withPreflop(makeGame({ playerCount: 2 })))

    const afterCall = applyAction(afterBlinds, { type: ActionType.Call })
    expect(isRoundComplete(afterCall)).toBe(false)

    const afterCheck = applyAction(afterCall, { type: ActionType.Check })
    expect(isRoundComplete(afterCheck)).toBe(true)
  })

  it('getNextActivePlayer() skips folded and all-in players', () => {
    const base = postBlinds(withPreflop(makeGame({ playerCount: 3 })))
    const players = [...base.players]
    players[1] = { ...atSeat(base, 1), isFolded: true }
    players[2] = { ...atSeat(base, 2), isAllIn: true, chips: 0 }

    const next = getNextActivePlayer({
      ...base,
      players,
      playersToAct: [1, 2, 0],
    })

    expect(next).toBe(0)
  })

  it('applyAction() Call with all-in partial contribution caps at player chips and sets isAllIn', () => {
    const base = withPreflop(makeGame({ playerCount: 2 }))
    const sbChips = 50

    const shortStackGame: GameState = {
      ...base,
      currentBet: 100,
      activePlayerIndex: 0,
      players: base.players.map((p, i) =>
        i === 0
          ? { ...p, chips: sbChips, bet: 0 }
          : p
      ),
    }

    const afterCall = applyAction(shortStackGame, { type: ActionType.Call })
    const callingPlayer = atSeat(afterCall, 0)

    expect(callingPlayer.chips).toBe(0)
    expect(callingPlayer.bet).toBe(sbChips)
    expect(callingPlayer.isAllIn).toBe(true)
    expect(callingPlayer.totalBetThisHand).toBe(sbChips)
  })

  it('applyAction() sets lastAction correctly for all ActionType values', () => {
    const base = postBlinds(withPreflop(makeGame({ playerCount: 2 })))
    const sbSeat = base.activePlayerIndex
    const currentBet = base.currentBet ?? 0

    // Test Fold
    const folded = applyAction(base, { type: ActionType.Fold })
    const foldedPlayer = atSeat(folded, sbSeat)
    expect(foldedPlayer.lastAction).toMatchObject({ type: ActionType.Fold })
    expect(foldedPlayer.lastAction?.timestamp).toBeTypeOf('number')
    expect(foldedPlayer.lastAction?.amount).toBeUndefined()

    // Test Call
    const called = applyAction(base, { type: ActionType.Call })
    const calledPlayer = atSeat(called, sbSeat)
    expect(calledPlayer.lastAction).toMatchObject({ type: ActionType.Call, amount: currentBet })
    expect(calledPlayer.lastAction?.timestamp).toBeTypeOf('number')

    // Test Check
    const checkableBase = {
      ...base,
      currentBet: 0,
      players: base.players.map(p => p ? { ...p, bet: 0 } : p),
    }
    const checked = applyAction(checkableBase, { type: ActionType.Check })
    const checkedPlayer = atSeat(checked, sbSeat)
    expect(checkedPlayer.lastAction).toMatchObject({ type: ActionType.Check })
    expect(checkedPlayer.lastAction?.timestamp).toBeTypeOf('number')
    expect(checkedPlayer.lastAction?.amount).toBeUndefined()

    // Test Raise
    const raiseAmount = currentBet + base.config.bigBlind
    const raised = applyAction(base, { type: ActionType.Raise, amount: raiseAmount })
    const raisedPlayer = atSeat(raised, sbSeat)
    expect(raisedPlayer.lastAction).toMatchObject({ type: ActionType.Raise, amount: raiseAmount })
    expect(raisedPlayer.lastAction?.timestamp).toBeTypeOf('number')

    // Test Bet (on postflop street with no current bet)
    const betBase = {
      ...withPreflop(makeGame({ playerCount: 2 })),
      phase: GamePhase.Flop,
      currentBet: 0,
      activePlayerIndex: 0,
      players: base.players.map(p => p ? { ...p, bet: 0 } : p),
    }
    const betAmount = betBase.config.bigBlind
    const bet = applyAction(betBase, { type: ActionType.Bet, amount: betAmount })
    const betPlayer = atSeat(bet, 0)
    expect(betPlayer.lastAction).toMatchObject({ type: ActionType.Bet, amount: betAmount })
    expect(betPlayer.lastAction?.timestamp).toBeTypeOf('number')
  })
})
