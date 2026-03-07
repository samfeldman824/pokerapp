import { nanoid } from 'nanoid'

import { getNextActivePlayer, postBlinds, validateAction, applyAction, isRoundComplete, advancePhase } from './betting'
import { DEFAULT_CONFIG } from './constants'
import { createDeck, dealCards, shuffleDeck } from './deck'
import { evaluateHandWithRaw } from './handEvaluator'
import { awardPots, calculatePots, splitPotEvenly } from './potCalculator'
import { Card, ClientGameState, ClientPlayerState, GameConfig, GamePhase, GameState, PlayerAction, PlayerState, SidePot } from './types'

function sortBySeat(players: PlayerState[]): PlayerState[] {
  return [...players].sort((left, right) => left.seatIndex - right.seatIndex)
}

function getSeatedPlayers(players: PlayerState[]): PlayerState[] {
  return sortBySeat(players.filter((player): player is PlayerState => Boolean(player)))
}

function getPlayersEligibleToStartHand(players: PlayerState[]): PlayerState[] {
  return getSeatedPlayers(players).filter(player => player.chips > 0)
}

function isPlayerInCurrentHand(player: PlayerState): boolean {
  return player.holeCards !== null || player.totalBetThisHand > 0 || player.bet > 0 || player.isAllIn
}

function getCurrentHandPlayers(players: PlayerState[]): PlayerState[] {
  return getSeatedPlayers(players).filter(isPlayerInCurrentHand)
}

function toSeatIndexedPlayers(players: PlayerState[]): PlayerState[] {
  const seatIndexed: PlayerState[] = []

  for (const player of players) {
    seatIndexed[player.seatIndex] = player
  }

  return seatIndexed
}

function mergePlayers(allPlayers: PlayerState[], updatedPlayers: PlayerState[]): PlayerState[] {
  const updatedById = new Map(updatedPlayers.map(player => [player.id, player]))

  return sortBySeat(
    allPlayers.map(player => updatedById.get(player.id) ?? player)
  )
}

function toInternalGame(game: GameState): GameState {
  const internalPlayers = game.phase === GamePhase.Waiting
    ? getPlayersEligibleToStartHand(game.players)
    : getCurrentHandPlayers(game.players)

  return {
    ...game,
    players: toSeatIndexedPlayers(internalPlayers),
  }
}

function fromInternalGame(sourceGame: GameState, internalGame: GameState): GameState {
  return {
    ...internalGame,
    players: mergePlayers(sourceGame.players, getSeatedPlayers(internalGame.players)),
  }
}

function getPlayerById(players: PlayerState[], playerId: string): PlayerState | undefined {
  return players.find(player => player.id === playerId)
}

function getRemainingPlayers(game: GameState): PlayerState[] {
  return getCurrentHandPlayers(game.players).filter(player => !player.isFolded)
}

function collectCurrentRoundBets(players: PlayerState[]): number {
  return players.reduce((total, player) => total + player.bet, 0)
}

function awardUncontestedPot(game: GameState, winner: PlayerState): GameState {
  const totalPot = game.pot + collectCurrentRoundBets(getCurrentHandPlayers(game.players))

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
    players: game.players.map(player => {
      if (!isPlayerInCurrentHand(player)) {
        return player
      }

      if (player.id === winner.id) {
        return {
          ...player,
          chips: player.chips + totalPot,
          bet: 0,
        }
      }

      return {
        ...player,
        bet: 0,
      }
    }),
  }
}

function distributePotWinnings(players: PlayerState[], pots: SidePot[], winnerIdsByPot: string[][], dealerIndex: number): PlayerState[] {
  const playersById = new Map(players.map(player => [player.id, player]))
  const chipAdjustments = new Map<string, number>()
  const numSeats = Math.max(...players.map(p => p.seatIndex)) + 1

  pots.forEach((pot, potIndex) => {
    // Sort by seat position starting from the seat immediately left of dealer.
    // The player left of dealer receives the odd chip on a split pot.
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
    handNumber: 0,
    lastRaiseAmount: config.bigBlind ?? DEFAULT_CONFIG.bigBlind,
    playersToAct: [],
    timerStart: null,
    actionTimerStart: null,
    isPaused: false,
    hostPlayerId: '',
  }
}

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

export function startHand(game: GameState): GameState {
  const activePlayers = getPlayersEligibleToStartHand(game.players)

  if (activePlayers.length < 2) {
    throw new Error('Minimum 2 active players required to start a hand')
  }

  const dealerIndex = advanceDealer(game)
  let deck = shuffleDeck(createDeck())

  const resetPlayers = getSeatedPlayers(game.players).map(player => ({
    ...player,
    holeCards: null,
    bet: 0,
    totalBetThisHand: 0,
    isFolded: false,
    isAllIn: false,
  }))

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
    lastRaiseAmount: game.config.bigBlind,
    playersToAct: [],
    timerStart: null,
    actionTimerStart: null,
    isPaused: false,
  }

  const blindedGame = fromInternalGame(baseGame, postBlinds(toInternalGame(baseGame)))

  return {
    ...blindedGame,
    phase: GamePhase.Preflop,
    activePlayerIndex: getNextActivePlayer(toInternalGame(blindedGame)),
    timerStart: null,
    actionTimerStart: null,
  }
}

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

  if (isRoundComplete(appliedInternalGame)) {
    const remainingPlayers = getRemainingPlayers(appliedGame)

    if (remainingPlayers.length === 1) {
      return awardUncontestedPot(appliedGame, remainingPlayers[0])
    }

    if (appliedGame.phase === GamePhase.River) {
      return getShowdownResults(appliedGame)
    }

    const advancedInternalGame = advancePhase(appliedInternalGame)
    const advancedGame = fromInternalGame(appliedGame, advancedInternalGame)

    return {
      ...advancedGame,
      activePlayerIndex: getNextActivePlayer(toInternalGame(advancedGame)),
      timerStart: null,
      actionTimerStart: null,
    }
  }

  return {
    ...appliedGame,
    activePlayerIndex: getNextActivePlayer(appliedInternalGame),
    timerStart: null,
    actionTimerStart: null,
  }
}

export function isHandComplete(game: GameState): boolean {
  return game.phase === GamePhase.Showdown || getRemainingPlayers(game).length <= 1
}

export function getPlayerView(game: GameState, playerId: string): ClientGameState {
  const { deck: _deck, players, ...rest } = game

  return {
    ...rest,
    players: players.map((player): ClientPlayerState => {
      const { token: _token, holeCards, ...playerWithoutToken } = player
      return {
        ...playerWithoutToken,
        holeCards: game.phase === GamePhase.Showdown || player.id === playerId
          ? holeCards
          : null,
      }
    }),
  }
}
