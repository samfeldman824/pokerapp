/**
 * Core betting logic for a Texas Hold'em hand.
 *
 * This module operates on a "seat-indexed" GameState where `game.players` is a
 * sparse array keyed by seat index (seats 0–maxPlayers-1 may be undefined).
 * Callers in gameController.ts convert to/from this format via
 * `toInternalGame` / `fromInternalGame` before delegating here.
 *
 * Round state is tracked through `game.playersToAct`: an ordered array of seat
 * indices that still need to act this street. A round is complete when the
 * list drains to empty (or only one player can still act).
 */

import { DEFAULT_CONFIG } from './constants'
import { dealCards } from './deck'
import { ActionType, GamePhase, GameState, PlayerAction, PlayerState } from './types'

/** A seat may be empty (undefined) in the sparse players array. */
type SeatedPlayer = PlayerState | undefined

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function getConfiguredSmallBlind(game: GameState): number {
  return game.config.smallBlind ?? DEFAULT_CONFIG.smallBlind
}

function getConfiguredBigBlind(game: GameState): number {
  return game.config.bigBlind ?? DEFAULT_CONFIG.bigBlind
}

/**
 * Returns the current highest bet on the table.
 * Reads `game.currentBet` when set; otherwise scans all players.
 */
function getCurrentBet(game: GameState): number {
  if (typeof game.currentBet === 'number') {
    return game.currentBet
  }

  return game.players.reduce((maxBet, player) => {
    if (!player) {
      return maxBet
    }

    return Math.max(maxBet, player.bet)
  }, 0)
}

/**
 * Returns the minimum valid raise SIZE (i.e., how much more than the current
 * bet the total raise must be). Defaults to the big blind if nothing set yet.
 */
function getMinRaise(game: GameState): number {
  return game.minRaise ?? game.lastRaiseAmount ?? getConfiguredBigBlind(game)
}

// ---------------------------------------------------------------------------
// Seat / player helpers
// ---------------------------------------------------------------------------

/** Filters out empty seats, returning only seated PlayerState objects. */
function getSeatedPlayers(game: GameState): PlayerState[] {
  return game.players.filter((player): player is PlayerState => Boolean(player))
}

function getPlayerAtSeat(game: GameState, seatIndex: number): SeatedPlayer {
  return game.players[seatIndex]
}

/**
 * A player is eligible to act if they haven't folded and aren't all-in.
 * (All-in players are still "in the hand" but cannot make further decisions.)
 */
function isEligibleToAct(player: SeatedPlayer): player is PlayerState {
  return player !== undefined && !player.isFolded && !player.isAllIn
}

/** A player can still act only if they're eligible AND have chips remaining. */
function canStillAct(player: SeatedPlayer): boolean {
  return isEligibleToAct(player) && player.chips > 0
}

/** Counts how many seated players can still make a betting decision. */
function getActiveSeatCount(game: GameState): number {
  return game.players.reduce((count, player) => count + (canStillAct(player) ? 1 : 0), 0)
}

/**
 * Finds the next occupied seat (wrapping around) starting strictly after
 * `fromSeat`. Returns -1 if no seat is found (shouldn't happen in a live game).
 */
function getNextOccupiedSeat(game: GameState, fromSeat: number): number {
  const seatCount = game.config.maxPlayers

  for (let offset = 1; offset <= seatCount; offset += 1) {
    const seatIndex = (fromSeat + offset) % seatCount
    if (getPlayerAtSeat(game, seatIndex)) {
      return seatIndex
    }
  }

  return -1
}

// ---------------------------------------------------------------------------
// Blind positioning
// ---------------------------------------------------------------------------

/**
 * Determines which seats post the small and big blinds.
 *
 * Heads-up rule: with exactly 2 players the dealer posts the small blind and
 * acts first preflop, while the other player posts the big blind.
 * With 3+ players the normal order applies: SB is one left of dealer, BB two left.
 */
function getBlindSeats(game: GameState): { smallBlind: number; bigBlind: number } {
  const seatedPlayers = getSeatedPlayers(game)

  if (seatedPlayers.length < 2) {
    return { smallBlind: -1, bigBlind: -1 }
  }

  if (seatedPlayers.length === 2) {
    // Heads-up: dealer = small blind, other player = big blind
    const bigBlind = getNextOccupiedSeat(game, game.dealerIndex)
    return {
      smallBlind: game.dealerIndex,
      bigBlind,
    }
  }

  const smallBlind = getNextOccupiedSeat(game, game.dealerIndex)
  const bigBlind = smallBlind === -1 ? -1 : getNextOccupiedSeat(game, smallBlind)

  return { smallBlind, bigBlind }
}

// ---------------------------------------------------------------------------
// Action order helpers
// ---------------------------------------------------------------------------

/**
 * Returns an ordered list of all seat indices starting at `startingSeat`,
 * wrapping around the table. Includes empty seats — callers filter as needed.
 */
function buildSeatOrder(game: GameState, startingSeat: number): number[] {
  const seatCount = game.config.maxPlayers
  const order: number[] = []

  if (seatCount === 0 || startingSeat === -1) {
    return order
  }

  for (let offset = 0; offset < seatCount; offset += 1) {
    order.push((startingSeat + offset) % seatCount)
  }

  return order
}

/**
 * Returns the initial action order for the current street.
 *
 * Preflop: action starts one seat left of the big blind (UTG).
 * All other streets: action starts one seat left of the dealer.
 */
function getInitialRoundOrder(game: GameState): number[] {
  if (getSeatedPlayers(game).length < 2) {
    return []
  }

  if (game.phase === GamePhase.Preflop) {
    const { bigBlind } = getBlindSeats(game)
    if (bigBlind === -1) {
      return []
    }

    return buildSeatOrder(game, (bigBlind + 1) % game.config.maxPlayers)
  }

  return buildSeatOrder(game, (game.dealerIndex + 1) % game.config.maxPlayers)
}

/**
 * Returns the current `playersToAct` queue, normalised:
 * - If `game.playersToAct` is already set, filters out seats that can no longer act.
 * - Otherwise builds a fresh queue from the initial round order.
 */
function normalizePlayersToAct(game: GameState): number[] {
  if (Array.isArray(game.playersToAct)) {
    return game.playersToAct.filter((seatIndex) => canStillAct(getPlayerAtSeat(game, seatIndex)))
  }

  return getInitialRoundOrder(game).filter((seatIndex) => canStillAct(getPlayerAtSeat(game, seatIndex)))
}

/**
 * After a raise, all other active players must respond.
 * Returns the seats that need to act, in order starting left of the raiser,
 * excluding the raiser themselves.
 */
function getOrderedResponders(game: GameState, actingSeat: number): number[] {
  return buildSeatOrder(game, (actingSeat + 1) % game.config.maxPlayers).filter(
    (seatIndex) => seatIndex !== actingSeat && canStillAct(getPlayerAtSeat(game, seatIndex))
  )
}

// ---------------------------------------------------------------------------
// Chip movement helpers
// ---------------------------------------------------------------------------

/**
 * Posts a forced bet (blind/ante) for a player, capped at their stack.
 * Sets `isAllIn` if the player's entire stack is consumed.
 */
function postForcedBet(player: PlayerState, amount: number): PlayerState {
  const contribution = Math.min(player.chips, amount)

  return {
    ...player,
    chips: player.chips - contribution,
    bet: player.bet + contribution,
    totalBetThisHand: player.totalBetThisHand + contribution,
    isAllIn: player.chips === contribution,
  }
}

/** Returns a new players array with the player at `seatIndex` replaced. */
function replacePlayer(players: PlayerState[], seatIndex: number, updatedPlayer: PlayerState): PlayerState[] {
  return players.map((player, index) => (index === seatIndex ? updatedPlayer : player))
}

function getPlayerById(game: GameState, playerId: string): PlayerState | undefined {
  return getSeatedPlayers(game).find((player) => player.id === playerId)
}

/** Returns the first seat index still pending action, or -1 if the queue is empty. */
function getNextPlayerFromPending(game: GameState): number {
  const pending = normalizePlayersToAct(game)
  return pending[0] ?? -1
}

// ---------------------------------------------------------------------------
// Exported betting operations
// ---------------------------------------------------------------------------

/**
 * Posts the small and big blinds at the start of a hand and initialises the
 * `playersToAct` queue for the preflop betting round.
 *
 * The returned game has `activePlayerIndex` set to the first player to act
 * (UTG in a multi-way pot; BB in heads-up).
 */
export function postBlinds(game: GameState): GameState {
  const { smallBlind, bigBlind } = getBlindSeats(game)

  if (smallBlind === -1 || bigBlind === -1) {
    return {
      ...game,
      activePlayerIndex: -1,
      currentBet: 0,
      minRaise: getConfiguredBigBlind(game),
      lastRaiseAmount: getConfiguredBigBlind(game),
      playersToAct: [],
    }
  }

  let players = [...game.players]
  const smallBlindPlayer = getPlayerAtSeat(game, smallBlind)
  const bigBlindPlayer = getPlayerAtSeat(game, bigBlind)

  if (!smallBlindPlayer || !bigBlindPlayer) {
    return game
  }

  const postedSmallBlind = postForcedBet(smallBlindPlayer, getConfiguredSmallBlind(game))
  players = replacePlayer(players, smallBlind, postedSmallBlind)

  const postedBigBlind = postForcedBet(bigBlindPlayer, getConfiguredBigBlind(game))
  players = replacePlayer(players, bigBlind, postedBigBlind)

  // currentBet is the larger of the two blind amounts (handles short stacks)
  const currentBet = Math.max(postedSmallBlind.bet, postedBigBlind.bet)
  const nextGame: GameState = {
    ...game,
    players,
    currentBet,
    minRaise: getConfiguredBigBlind(game),
    lastRaiseAmount: getConfiguredBigBlind(game),
  }

  const playersToAct = getInitialRoundOrder(nextGame).filter((seatIndex) => canStillAct(getPlayerAtSeat(nextGame, seatIndex)))

  return {
    ...nextGame,
    playersToAct,
    activePlayerIndex: playersToAct[0] ?? -1,
  }
}

/**
 * Returns the seat index of the next player to act, or -1 if the round is over.
 * Reads from the `playersToAct` queue.
 */
export function getNextActivePlayer(game: GameState): number {
  return getNextPlayerFromPending(game)
}

/**
 * Validates a player action against the current game state.
 *
 * Checks: it's the player's turn, they haven't folded/gone all-in, and the
 * action is legal (e.g., can't check facing a bet, raise must meet minimum size).
 *
 * @returns `{ valid: true }` on success, or `{ valid: false, reason }` on failure.
 */
export function validateAction(
  game: GameState,
  playerId: string,
  action: PlayerAction
): { valid: boolean; reason?: string } {
  const player = getPlayerById(game, playerId)

  if (!player) {
    return { valid: false, reason: 'Player not found' }
  }

  if (player.seatIndex !== game.activePlayerIndex) {
    return { valid: false, reason: 'Not this player\'s turn' }
  }

  if (player.isFolded) {
    return { valid: false, reason: 'Player has already folded' }
  }

  if (player.isAllIn || player.chips <= 0) {
    return { valid: false, reason: 'Player cannot act while all-in' }
  }

  const currentBet = getCurrentBet(game)
  const minRaise = getMinRaise(game)
  const amountToCall = Math.max(0, currentBet - player.bet)

  switch (action.type) {
    case ActionType.Fold:
      return { valid: true }
    case ActionType.Check:
      return player.bet === currentBet
        ? { valid: true }
        : { valid: false, reason: 'Cannot check facing a bet' }
    case ActionType.Call:
      return amountToCall > 0
        ? { valid: true }
        : { valid: false, reason: 'Nothing to call' }
    case ActionType.Bet: {
      if (currentBet !== 0) {
        return { valid: false, reason: 'Cannot bet when there is already a bet — use Raise' }
      }

      if (!Number.isFinite(action.amount) || action.amount <= 0) {
        return { valid: false, reason: 'Bet amount must be positive' }
      }

      const contribution = action.amount - player.bet
      if (contribution > player.chips) {
        return { valid: false, reason: 'Player does not have enough chips' }
      }

      const isAllIn = contribution === player.chips
      if (action.amount < minRaise && !isAllIn) {
        return { valid: false, reason: `Bet must be at least ${minRaise}` }
      }

      return { valid: true }
    }
    case ActionType.Raise: {
      if (currentBet === 0) {
        return { valid: false, reason: 'No bet to raise — use Bet' }
      }

      if (!Number.isFinite(action.amount) || action.amount <= currentBet) {
        return { valid: false, reason: 'Raise must exceed the current bet' }
      }

      if (action.amount <= player.bet) {
        return { valid: false, reason: 'Raise must increase this player\'s bet' }
      }

      const contribution = action.amount - player.bet
      if (contribution > player.chips) {
        return { valid: false, reason: 'Player does not have enough chips' }
      }

      const raiseSize = action.amount - currentBet
      const isAllIn = contribution === player.chips
      // All-in raises below the minimum are allowed (can't force a player to bet more than they have)
      if (raiseSize < minRaise && !isAllIn) {
        return { valid: false, reason: `Raise must be at least ${minRaise}` }
      }

      return { valid: true }
    }
  }
}

/**
 * Applies a validated player action to the game state and advances the
 * `playersToAct` queue.
 *
 * Key side effects of a raise:
 * - `currentBet` is updated to the new highest bet.
 * - `minRaise` / `lastRaiseAmount` are updated (only when the raise meets the
 *   minimum — a sub-minimum all-in raise doesn't reopen the action).
 * - `playersToAct` is rebuilt so all other active players must respond.
 *
 * Returns the updated game with `activePlayerIndex` pointing to the next seat,
 * or -1 if no further action is required this round.
 */
export function applyAction(game: GameState, action: PlayerAction): GameState {
  const actingSeat = game.activePlayerIndex
  const actingPlayer = getPlayerAtSeat(game, actingSeat)

  if (!actingPlayer) {
    return game
  }

  const validation = validateAction(game, actingPlayer.id, action)
  if (!validation.valid) {
    throw new Error(validation.reason ?? 'Invalid action')
  }

  const previousCurrentBet = getCurrentBet(game)
  const previousMinRaise = getMinRaise(game)
  const pendingBeforeAction = normalizePlayersToAct(game)
  let updatedPlayer = actingPlayer
  let currentBet = previousCurrentBet
  let minRaise = previousMinRaise
  let lastRaiseAmount = game.lastRaiseAmount ?? previousMinRaise
  // Remove the acting player from the pending queue
  let playersToAct = pendingBeforeAction.filter((seatIndex) => seatIndex !== actingSeat)

  switch (action.type) {
    case ActionType.Fold:
      updatedPlayer = {
        ...actingPlayer,
        isFolded: true,
      }
      break
    case ActionType.Check:
      // No chip movement; player simply passes
      break
    case ActionType.Call: {
      // Call is capped at the player's remaining chips (all-in call)
      const contribution = Math.min(actingPlayer.chips, Math.max(0, previousCurrentBet - actingPlayer.bet))
      updatedPlayer = {
        ...actingPlayer,
        chips: actingPlayer.chips - contribution,
        bet: actingPlayer.bet + contribution,
        totalBetThisHand: actingPlayer.totalBetThisHand + contribution,
        isAllIn: actingPlayer.chips === contribution,
      }
      break
    }
    case ActionType.Bet:
    case ActionType.Raise: {
      const contribution = action.amount - actingPlayer.bet
      updatedPlayer = {
        ...actingPlayer,
        chips: actingPlayer.chips - contribution,
        bet: action.amount,
        totalBetThisHand: actingPlayer.totalBetThisHand + contribution,
        isAllIn: actingPlayer.chips === contribution,
      }

      const raiseSize = updatedPlayer.bet - previousCurrentBet
      currentBet = updatedPlayer.bet

      if (raiseSize >= previousMinRaise) {
        // Full bet/raise: update the minimum re-raise size and reopen action to all other players
        minRaise = raiseSize
        lastRaiseAmount = raiseSize
        playersToAct = getOrderedResponders(
          {
            ...game,
            players: replacePlayer([...game.players], actingSeat, updatedPlayer),
          },
          actingSeat
        )
      }
      // Sub-minimum all-in bet/raise: action is NOT reopened (playersToAct unchanged)

      break
    }
  }

  const players = replacePlayer([...game.players], actingSeat, updatedPlayer)
  const nextGame: GameState = {
    ...game,
    players,
    currentBet,
    minRaise,
    lastRaiseAmount,
    playersToAct,
  }

  // If only one player can still act (or the queue is empty), close action immediately
  const actionablePlayers = getActiveSeatCount(nextGame)
  if (actionablePlayers <= 1 || playersToAct.length === 0) {
    return {
      ...nextGame,
      activePlayerIndex: -1,
      playersToAct: [],
    }
  }

  return {
    ...nextGame,
    activePlayerIndex: getNextPlayerFromPending(nextGame),
  }
}

/**
 * Returns true when the current betting round is over.
 *
 * A round ends when:
 * - Only one player can still act (everyone else folded or is all-in), OR
 * - The `playersToAct` queue is empty (everyone has acted at the current bet level)
 */
export function isRoundComplete(game: GameState): boolean {
  if (getActiveSeatCount(game) <= 1) {
    return true
  }

  return normalizePlayersToAct(game).length === 0
}

/**
 * Collects all bets into the pot and deals community cards for the next street.
 *
 * Street progression: Preflop → Flop (3 cards) → Turn (1 card) → River (1 card) → Showdown
 *
 * Resets per-street state: `bet` on each player, `currentBet`, `minRaise`,
 * `playersToAct`, and rebuilds the action queue for the new street.
 */
export function advancePhase(game: GameState): GameState {
  // Collect all outstanding bets into the pot
  const collectedBets = game.players.reduce((total, player) => total + (player?.bet ?? 0), 0)
  const players = game.players.map((player) => {
    if (!player) {
      return player
    }

    return {
      ...player,
      bet: 0,
    }
  })

  let phase = game.phase
  let communityCards = [...game.communityCards]
  let deck = [...game.deck]

  if (game.phase === GamePhase.Preflop) {
    const dealt = dealCards(deck, 3)
    phase = GamePhase.Flop
    communityCards = [...communityCards, ...dealt.dealt]
    deck = dealt.remaining
  } else if (game.phase === GamePhase.Flop) {
    const dealt = dealCards(deck, 1)
    phase = GamePhase.Turn
    communityCards = [...communityCards, ...dealt.dealt]
    deck = dealt.remaining
  } else if (game.phase === GamePhase.Turn) {
    const dealt = dealCards(deck, 1)
    phase = GamePhase.River
    communityCards = [...communityCards, ...dealt.dealt]
    deck = dealt.remaining
  } else if (game.phase === GamePhase.River) {
    phase = GamePhase.Showdown
  }

  const nextGame: GameState = {
    ...game,
    phase,
    pot: game.pot + collectedBets,
    players,
    communityCards,
    deck,
    currentBet: 0,
    minRaise: getConfiguredBigBlind(game),
    lastRaiseAmount: getConfiguredBigBlind(game),
    playersToAct: [],
  }

  if (phase === GamePhase.Showdown) {
    return {
      ...nextGame,
      activePlayerIndex: -1,
    }
  }

  const playersToAct = getInitialRoundOrder(nextGame).filter((seatIndex) => canStillAct(getPlayerAtSeat(nextGame, seatIndex)))

  return {
    ...nextGame,
    playersToAct,
    activePlayerIndex: playersToAct[0] ?? -1,
  }
}
