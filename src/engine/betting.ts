import { DEFAULT_CONFIG } from './constants'
import { dealCards } from './deck'
import { ActionType, GamePhase, GameState, PlayerAction, PlayerState } from './types'

type SeatedPlayer = PlayerState | undefined

function getConfiguredSmallBlind(game: GameState): number {
  return game.config.smallBlind ?? DEFAULT_CONFIG.smallBlind
}

function getConfiguredBigBlind(game: GameState): number {
  return game.config.bigBlind ?? DEFAULT_CONFIG.bigBlind
}

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

function getMinRaise(game: GameState): number {
  return game.minRaise ?? game.lastRaiseAmount ?? getConfiguredBigBlind(game)
}

function getSeatedPlayers(game: GameState): PlayerState[] {
  return game.players.filter((player): player is PlayerState => Boolean(player))
}

function getPlayerAtSeat(game: GameState, seatIndex: number): SeatedPlayer {
  return game.players[seatIndex]
}

function isEligibleToAct(player: SeatedPlayer): player is PlayerState {
  return player !== undefined && !player.isFolded && !player.isAllIn
}

function canStillAct(player: SeatedPlayer): boolean {
  return isEligibleToAct(player) && player.chips > 0
}

function getActiveSeatCount(game: GameState): number {
  return game.players.reduce((count, player) => count + (canStillAct(player) ? 1 : 0), 0)
}

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

function getBlindSeats(game: GameState): { smallBlind: number; bigBlind: number } {
  const seatedPlayers = getSeatedPlayers(game)

  if (seatedPlayers.length < 2) {
    return { smallBlind: -1, bigBlind: -1 }
  }

  if (seatedPlayers.length === 2) {
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

function normalizePlayersToAct(game: GameState): number[] {
  if (Array.isArray(game.playersToAct)) {
    return game.playersToAct.filter((seatIndex) => canStillAct(getPlayerAtSeat(game, seatIndex)))
  }

  return getInitialRoundOrder(game).filter((seatIndex) => canStillAct(getPlayerAtSeat(game, seatIndex)))
}

function getOrderedResponders(game: GameState, actingSeat: number): number[] {
  return buildSeatOrder(game, (actingSeat + 1) % game.config.maxPlayers).filter(
    (seatIndex) => seatIndex !== actingSeat && canStillAct(getPlayerAtSeat(game, seatIndex))
  )
}

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

function replacePlayer(players: PlayerState[], seatIndex: number, updatedPlayer: PlayerState): PlayerState[] {
  return players.map((player, index) => (index === seatIndex ? updatedPlayer : player))
}

function getPlayerById(game: GameState, playerId: string): PlayerState | undefined {
  return getSeatedPlayers(game).find((player) => player.id === playerId)
}

function getNextPlayerFromPending(game: GameState): number {
  const pending = normalizePlayersToAct(game)
  return pending[0] ?? -1
}

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

export function getNextActivePlayer(game: GameState): number {
  return getNextPlayerFromPending(game)
}

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
    case ActionType.Raise: {
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
      if (raiseSize < minRaise && !isAllIn) {
        return { valid: false, reason: `Raise must be at least ${minRaise}` }
      }

      return { valid: true }
    }
  }
}

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
  let playersToAct = pendingBeforeAction.filter((seatIndex) => seatIndex !== actingSeat)

  switch (action.type) {
    case ActionType.Fold:
      updatedPlayer = {
        ...actingPlayer,
        isFolded: true,
      }
      break
    case ActionType.Check:
      break
    case ActionType.Call: {
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

export function isRoundComplete(game: GameState): boolean {
  if (getActiveSeatCount(game) <= 1) {
    return true
  }

  return normalizePlayersToAct(game).length === 0
}

export function advancePhase(game: GameState): GameState {
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
