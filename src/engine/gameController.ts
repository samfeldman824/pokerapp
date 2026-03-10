/**
 * Top-level game controller — the single entry point for all game mutations.
 *
 * Responsibilities:
 * - Creating and initialising a new game (`createGame`)
 * - Starting a hand (`startHand`) — deals cards, posts blinds, sets first actor
 * - Processing player actions (`handleAction`) — validates, applies, advances phase
 * - Computing showdown results (`getShowdownResults`) — evaluates hands, awards pots
 * - Producing client-safe state snapshots (`getPlayerView`) — hides opponent cards
 *
 * Internal representation vs. external state
 * -------------------------------------------
 * `betting.ts` requires a *seat-indexed* `GameState` where `players` is a sparse
 * array (`players[seatIndex] = PlayerState`). The canonical `GameState` stored
 * everywhere else has `players` as a compact sorted array of all seated players.
 *
 * `toInternalGame` converts to the sparse format before calling betting helpers;
 * `fromInternalGame` merges the results back into the canonical form.
 */

import { nanoid } from 'nanoid'

import { getNextActivePlayer, postBlinds, validateAction, applyAction, isRoundComplete, advancePhase } from './betting'
import { DEFAULT_CONFIG } from './constants'
import { createDeck, dealCards, shuffleDeck } from './deck'
import { evaluateHandWithRaw } from './handEvaluator'
import { awardPots, calculatePots, splitPotEvenly } from './potCalculator'
import { Card, ClientGameState, ClientPlayerState, GameConfig, GamePhase, GameState, PlayerAction, PlayerState, SidePot } from './types'

// ---------------------------------------------------------------------------
// Internal array helpers
// ---------------------------------------------------------------------------

/** Sorts a player array by seat index (ascending). */
function sortBySeat(players: PlayerState[]): PlayerState[] {
  return [...players].sort((left, right) => left.seatIndex - right.seatIndex)
}

/** Returns all non-null players sorted by seat index. */
function getSeatedPlayers(players: PlayerState[]): PlayerState[] {
  return sortBySeat(players.filter((player): player is PlayerState => Boolean(player)))
}

/** Players eligible to start a new hand: seated, chips > 0. */
function getPlayersEligibleToStartHand(players: PlayerState[]): PlayerState[] {
  return getSeatedPlayers(players).filter(player => player.chips > 0)
}

/**
 * Returns true when a player is considered "in the current hand".
 * A player is in the hand if they were dealt cards OR made any bet, even if
 * they subsequently folded or went all-in.
 */
function isPlayerInCurrentHand(player: PlayerState): boolean {
  return player.holeCards !== null || player.totalBetThisHand > 0 || player.bet > 0 || player.isAllIn
}

/** All players who are (or were) in the current hand, sorted by seat. */
function getCurrentHandPlayers(players: PlayerState[]): PlayerState[] {
  return getSeatedPlayers(players).filter(isPlayerInCurrentHand)
}

/**
 * Converts a compact player list into a sparse seat-indexed array.
 * Slot `i` is `players[i]` if a player occupies seat `i`, else `undefined`.
 * Required by `betting.ts` which walks seats by index.
 */
function toSeatIndexedPlayers(players: PlayerState[]): PlayerState[] {
  const seatIndexed: PlayerState[] = []

  for (const player of players) {
    seatIndexed[player.seatIndex] = player
  }

  return seatIndexed
}

/**
 * Merges updates from `updatedPlayers` back into `allPlayers`, preserving
 * players not touched by the update (e.g., spectators, busted players).
 * Returns a compact sorted array.
 */
function mergePlayers(allPlayers: PlayerState[], updatedPlayers: PlayerState[]): PlayerState[] {
  const updatedById = new Map(updatedPlayers.map(player => [player.id, player]))

  return sortBySeat(
    allPlayers.map(player => updatedById.get(player.id) ?? player)
  )
}

// ---------------------------------------------------------------------------
// Internal ↔ external game format conversion
// ---------------------------------------------------------------------------

/**
 * Converts a canonical GameState to the sparse seat-indexed format expected by
 * betting helpers.
 *
 * In Waiting phase: includes all players with chips (eligible to start).
 * In any other phase: includes only players currently in the hand.
 */
function toInternalGame(game: GameState): GameState {
  const internalPlayers = game.phase === GamePhase.Waiting
    ? getPlayersEligibleToStartHand(game.players)
    : getCurrentHandPlayers(game.players)

  return {
    ...game,
    players: toSeatIndexedPlayers(internalPlayers),
  }
}

/**
 * Merges an updated internal (sparse) GameState back into the canonical form,
 * re-attaching players who weren't part of the internal view (e.g., busted players).
 */
function fromInternalGame(sourceGame: GameState, internalGame: GameState): GameState {
  return {
    ...internalGame,
    players: mergePlayers(sourceGame.players, getSeatedPlayers(internalGame.players)),
  }
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function getPlayerById(players: PlayerState[], playerId: string): PlayerState | undefined {
  return players.find(player => player.id === playerId)
}

/** Players still alive in the hand (not folded). */
function getRemainingPlayers(game: GameState): PlayerState[] {
  return getCurrentHandPlayers(game.players).filter(player => !player.isFolded)
}

// ---------------------------------------------------------------------------
// Pot distribution
// ---------------------------------------------------------------------------

/**
 * Awards all pots to the sole remaining player (everyone else folded).
 *
 * Side pots are respected even when only one player remains — a player who
 * went all-in for less than the full pot still can't win chips they weren't
 * eligible for. We recalculate pots from `totalBetThisHand` to get the
 * correct eligibility boundaries.
 */
function awardUncontestedPot(game: GameState, winner: PlayerState): GameState {
  // Use totalBetThisHand as the "bet" amount so calculatePots sees the full
  // contribution across all streets, not just the current-street bet.
  const handPlayers = getCurrentHandPlayers(game.players)
  const potPlayers = handPlayers.map(player => ({
    ...player,
    bet: player.totalBetThisHand,
  }))
  const pots = calculatePots(potPlayers)

  const potAwards = pots.map((pot, potIndex) => ({
    potIndex,
    amount: pot.amount,
    winnerIds: [winner.id],
    handDescription: '',
  }))

  const updatedHandPlayers = distributePotWinnings(
    handPlayers.map(p => ({ ...p, bet: 0 })),
    pots,
    potAwards.map(award => award.winnerIds),
    game.dealerIndex
  )

  return {
    ...game,
    phase: GamePhase.Showdown,
    pot: 0,
    sidePots: pots,
    activePlayerIndex: -1,
    currentBet: 0,
    playersToAct: [],
    timerStart: null,
    actionTimerStart: null,
    players: mergePlayers(game.players, updatedHandPlayers),
  }
}

/**
 * Distributes pot winnings to winners, handling split pots and odd chips.
 *
 * Odd-chip rule: when a pot can't be split evenly, the extra chip(s) go to
 * the winner(s) closest to the left of the dealer (standard casino rule).
 * Winners are sorted by their distance from the dealer seat before distributing
 * the remainder one chip at a time.
 */
function distributePotWinnings(players: PlayerState[], pots: SidePot[], winnerIdsByPot: string[][], dealerIndex: number): PlayerState[] {
  const playersById = new Map(players.map(player => [player.id, player]))
  const chipAdjustments = new Map<string, number>()
  const numSeats = Math.max(...players.map(p => p.seatIndex)) + 1

  pots.forEach((pot, potIndex) => {
    // Sort winners by seat position starting from the seat immediately left of
    // the dealer. The player left of dealer receives the odd chip on a split pot.
    const winnerIds = [...winnerIdsByPot[potIndex]].sort((left, right) => {
      const leftSeat = playersById.get(left)?.seatIndex ?? Number.MAX_SAFE_INTEGER
      const rightSeat = playersById.get(right)?.seatIndex ?? Number.MAX_SAFE_INTEGER
      const leftPos = (leftSeat - dealerIndex - 1 + numSeats) % numSeats
      const rightPos = (rightSeat - dealerIndex - 1 + numSeats) % numSeats
      return leftPos - rightPos
    })

    const { perPlayer, remainder } = splitPotEvenly(pot.amount, winnerIds.length)

    winnerIds.forEach((winnerId, winnerIndex) => {
      const extraChip = winnerIndex < remainder ? 1 : 0
      chipAdjustments.set(winnerId, (chipAdjustments.get(winnerId) ?? 0) + perPlayer + extraChip)
    })
  })

  return players.map(player => ({
    ...player,
    chips: player.chips + (chipAdjustments.get(player.id) ?? 0),
    bet: 0,
  }))
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates a new game in the Waiting phase with no players or hands yet.
 * The host player is set after the first player joins (see socketHandlers.ts).
 */
export function createGame(config: GameConfig): GameState {
  return {
    id: nanoid(),
    config,
    phase: GamePhase.Waiting,
    players: [],
    communityCards: [],
    pot: 0,
    sidePots: [],
    dealerIndex: -1,
    activePlayerIndex: -1,
    currentBet: 0,
    minRaise: config.bigBlind ?? DEFAULT_CONFIG.bigBlind,
    deck: [],
    shownCards: {},
    handNumber: 0,
    lastRaiseAmount: config.bigBlind ?? DEFAULT_CONFIG.bigBlind,
    playersToAct: [],
    timerStart: null,
    actionTimerStart: null,
    isPaused: false,
    hostPlayerId: '',
  }
}

export function resetGame(game: GameState): GameState {
  const resetPlayers = getSeatedPlayers(game.players).map(player => ({
    ...player,
    chips: game.config.startingStack,
    holeCards: null,
    bet: 0,
    totalBetThisHand: 0,
    isFolded: false,
    isAllIn: false,
    lastAction: null,
  }))

  return {
    ...game,
    phase: GamePhase.Waiting,
    players: resetPlayers,
    communityCards: [],
    pot: 0,
    sidePots: [],
    dealerIndex: -1,
    activePlayerIndex: -1,
    currentBet: 0,
    minRaise: game.config.bigBlind,
    deck: [],
    shownCards: {},
    handNumber: 0,
    lastRaiseAmount: game.config.bigBlind,
    playersToAct: [],
    timerStart: null,
    actionTimerStart: null,
    isPaused: false,
  }
}

/**
 * Advances the dealer button to the next occupied seat.
 * On the first hand (`dealerIndex === -1`) the first seated player becomes dealer.
 * Wraps around the table if the current dealer was the last seat.
 */
export function advanceDealer(game: GameState): number {
  const occupiedSeats = getSeatedPlayers(game.players).map(player => player.seatIndex)

  if (occupiedSeats.length === 0) {
    return -1
  }

  if (game.dealerIndex < 0) {
    return occupiedSeats[0]
  }

  return occupiedSeats.find(seatIndex => seatIndex > game.dealerIndex) ?? occupiedSeats[0]
}

/**
 * Starts a new hand: advances the dealer, resets per-hand player state, deals
 * hole cards to all players with chips, posts blinds, and sets the first actor.
 *
 * @throws if fewer than 2 players have chips
 */
export function startHand(game: GameState): GameState {
  const activePlayers = getPlayersEligibleToStartHand(game.players)

  if (activePlayers.length < 2) {
    throw new Error('Minimum 2 active players required to start a hand')
  }

  const dealerIndex = advanceDealer(game)
  let deck = shuffleDeck(createDeck())

  // Reset per-hand fields for all seated players
  const resetPlayers = getSeatedPlayers(game.players).map(player => ({
    ...player,
    holeCards: null,
    bet: 0,
    totalBetThisHand: 0,
    isFolded: false,
    isAllIn: false,
    lastAction: null,
  }))

  // Deal 2 hole cards to each player who has chips; skip busted players
  const dealtPlayers = resetPlayers.map(player => {
    if (player.chips <= 0) {
      return player
    }

    const { dealt, remaining } = dealCards(deck, 2)
    deck = remaining

    return {
      ...player,
      holeCards: [dealt[0], dealt[1]] as [Card, Card],
    }
  })

  const baseGame: GameState = {
    ...game,
    handNumber: game.handNumber + 1,
    phase: GamePhase.Preflop,
    players: dealtPlayers,
    communityCards: [],
    pot: 0,
    sidePots: [],
    dealerIndex,
    activePlayerIndex: -1,
    currentBet: 0,
    minRaise: game.config.bigBlind,
    deck,
    shownCards: {},
    lastRaiseAmount: game.config.bigBlind,
    playersToAct: [],
    timerStart: null,
    actionTimerStart: null,
    isPaused: false,
  }

  // Post blinds via the internal (seat-indexed) format, then convert back
  const blindedGame = fromInternalGame(baseGame, postBlinds(toInternalGame(baseGame)))

  return {
    ...blindedGame,
    phase: GamePhase.Preflop,
    activePlayerIndex: getNextActivePlayer(toInternalGame(blindedGame)),
    timerStart: null,
    actionTimerStart: null,
  }
}

/**
 * Evaluates hands at showdown, awards pots, and transitions to `GamePhase.Showdown`.
 *
 * Uses `totalBetThisHand` (accumulated across all streets) to derive correct
 * pot eligibility for each player, then delegates to `awardPots` for the
 * actual winner determination.
 */
export function getShowdownResults(game: GameState): GameState {
  const handPlayers = getCurrentHandPlayers(game.players)
  const potPlayers = handPlayers.map(player => ({
    ...player,
    bet: player.totalBetThisHand,
  }))
  const pots = calculatePots(potPlayers)

  if (pots.length === 0) {
    return {
      ...game,
      phase: GamePhase.Showdown,
      pot: 0,
      sidePots: [],
      activePlayerIndex: -1,
      currentBet: 0,
      playersToAct: [],
      timerStart: null,
      actionTimerStart: null,
      players: game.players.map(player => ({
        ...player,
        bet: 0,
      })),
    }
  }

  // Evaluate every non-folded player's best 5-card hand
  const handEvaluations = new Map(
    handPlayers
      .filter((player): player is PlayerState & { holeCards: [Card, Card] } => !player.isFolded && player.holeCards !== null)
      .map(player => {
        const { evaluation, rawHand } = evaluateHandWithRaw(player.holeCards, game.communityCards)
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

  const potAwards = awardPots(pots, handEvaluations)
  const updatedHandPlayers = distributePotWinnings(handPlayers, pots, potAwards.map(award => award.winnerIds), game.dealerIndex)

  return {
    ...game,
    phase: GamePhase.Showdown,
    pot: 0,
    sidePots: pots,
    activePlayerIndex: -1,
    currentBet: 0,
    playersToAct: [],
    timerStart: null,
    actionTimerStart: null,
    players: mergePlayers(game.players, updatedHandPlayers),
  }
}

/**
 * Applies a player's action and advances game state.
 *
 * Flow:
 * 1. Validate it's the player's turn and the action is legal.
 * 2. Apply the action (fold/check/call/raise) via `betting.applyAction`.
 * 3. If the betting round is now complete:
 *    a. If only one player remains → award uncontested pot (early win).
 *    b. If we're on the River → go to showdown.
 *    c. Otherwise → advance to the next street (`advancePhase`).
 * 4. If the round is still live → return the game pointing at the next actor.
 *
 * @throws if the player isn't found, it's not their turn, or the action is invalid
 */
export function handleAction(game: GameState, playerId: string, action: PlayerAction): GameState {
  const actingPlayer = getPlayerById(game.players, playerId)

  if (!actingPlayer) {
    throw new Error('Player not found')
  }

  if (game.activePlayerIndex !== actingPlayer.seatIndex) {
    throw new Error('Not this player\'s turn')
  }

  const internalGame = toInternalGame(game)
  const validation = validateAction(internalGame, playerId, action)

  if (!validation.valid) {
    throw new Error(validation.reason ?? 'Invalid action')
  }

  const appliedInternalGame = applyAction(internalGame, action)
  const appliedGame = fromInternalGame(game, appliedInternalGame)

  const remainingPlayers = getRemainingPlayers(appliedGame)
  if (remainingPlayers.length === 1) {
    return awardUncontestedPot(appliedGame, remainingPlayers[0])
  }

  if (isRoundComplete(appliedInternalGame)) {
    if (appliedGame.phase === GamePhase.River) {
      return getShowdownResults(appliedGame)
    }

    let currentInternalGame = appliedInternalGame
    let currentGame = appliedGame

    while (currentGame.phase !== GamePhase.River) {
      const advancedInternalGame = advancePhase(currentInternalGame)
      const advancedGame = fromInternalGame(currentGame, advancedInternalGame)
      const nextActive = getNextActivePlayer(toInternalGame(advancedGame))

      if (nextActive !== -1) {
        return {
          ...advancedGame,
          activePlayerIndex: nextActive,
          timerStart: null,
          actionTimerStart: null,
        }
      }

      currentInternalGame = advancedInternalGame
      currentGame = advancedGame
    }

    return getShowdownResults(currentGame)
  }

  return {
    ...appliedGame,
    activePlayerIndex: getNextActivePlayer(appliedInternalGame),
    timerStart: null,
    actionTimerStart: null,
  }
}

/**
 * Returns true when a hand has reached its final state and is ready to be
 * recorded and cleaned up.
 */
export function isHandComplete(game: GameState): boolean {
  return game.phase === GamePhase.Showdown || getRemainingPlayers(game).length <= 1
}

/**
 * Produces a client-safe snapshot of the game for a specific player.
 *
 * Two server-only fields are stripped before sending to clients:
 * - `deck` — always removed (no client should see undealt cards)
 * - `token` — always removed from every player (reconnection secret)
 * - `holeCards` — revealed only to the owning player (or to everyone at showdown)
 */
export function getPlayerView(game: GameState, playerId: string): ClientGameState {
  const { deck: _deck, players, ...rest } = game

  const seatIndexedPlayers: (ClientPlayerState | null)[] = Array.from(
    { length: game.config.maxPlayers },
    () => null,
  )

  for (const player of players) {
    const { token: _token, holeCards, ...playerWithoutToken } = player
    seatIndexedPlayers[player.seatIndex] = {
      ...playerWithoutToken,
      holeCards: game.phase === GamePhase.Showdown || player.id === playerId || game.shownCards[player.id]
        ? holeCards
        : null,
    }
  }

  return {
    ...rest,
    players: seatIndexedPlayers,
  }
}
