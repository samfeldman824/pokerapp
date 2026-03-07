import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { GameConfig, GameState, HandResult, PlayerState } from '../engine/types'
import { GamePhase } from '../engine/types'
import { db } from './index'
import { games, handActions, handResults, hands, players } from './schema'

export async function saveGame(game: GameState): Promise<void> {
  const createdAt = new Date()

  await db
    .insert(games)
    .values({
      id: game.id,
      config: game.config,
      status: 'active',
      hostPlayerId: game.hostPlayerId,
      createdAt,
    })
    .onConflictDoUpdate({
      target: games.id,
      set: {
        config: game.config,
        status: 'active',
        hostPlayerId: game.hostPlayerId,
      },
    })
}

export async function loadPersistedGame(gameId: string): Promise<GameState | null> {
  const [gameRow] = await db
    .select({
      id: games.id,
      config: games.config,
      hostPlayerId: games.hostPlayerId,
    })
    .from(games)
    .where(eq(games.id, gameId))
    .limit(1)

  if (!gameRow) {
    return null
  }

  const playerRows = await db
    .select({
      id: players.id,
      displayName: players.displayName,
      seatIndex: players.seatIndex,
      token: players.token,
      chipsBroughtIn: players.chipsBroughtIn,
      leftAt: players.leftAt,
    })
    .from(players)
    .where(eq(players.gameId, gameId))

  const config = gameRow.config as GameConfig
  const persistedPlayers: PlayerState[] = playerRows.map((player) => ({
    id: player.id,
    displayName: player.displayName,
    chips: player.chipsBroughtIn,
    holeCards: null,
    bet: 0,
    totalBetThisHand: 0,
    isFolded: false,
    isAllIn: false,
    isConnected: false,
    disconnectTime: null,
    seatIndex: player.seatIndex,
    token: player.token,
  }))

  return {
    id: gameRow.id,
    config,
    phase: GamePhase.Waiting,
    players: persistedPlayers,
    communityCards: [],
    pot: 0,
    sidePots: [],
    dealerIndex: -1,
    activePlayerIndex: -1,
    currentBet: 0,
    minRaise: config.bigBlind,
    deck: [],
    handNumber: 0,
    lastRaiseAmount: config.bigBlind,
    playersToAct: [],
    timerStart: null,
    actionTimerStart: null,
    isPaused: false,
    hostPlayerId: gameRow.hostPlayerId ?? '',
  }
}

export async function savePlayer(
  player: PlayerState,
  gameId: string,
): Promise<void> {
  await db
    .insert(players)
    .values({
      id: player.id,
      gameId,
      displayName: player.displayName,
      seatIndex: player.seatIndex,
      token: player.token,
      chipsBroughtIn: player.chips,
      chipsCarriedOut: null,
    })
    .onConflictDoUpdate({
      target: players.id,
      set: {
        gameId,
        displayName: player.displayName,
        seatIndex: player.seatIndex,
        token: player.token,
        chipsBroughtIn: player.chips,
      },
    })
}

export async function saveHand(game: GameState): Promise<string> {
  const handId = nanoid()
  const createdAt = new Date()

  await db.insert(hands).values({
    id: handId,
    gameId: game.id,
    handNumber: game.handNumber,
    dealerSeatIndex: game.dealerIndex,
    communityCards: game.communityCards,
    potTotal: game.pot,
    createdAt,
  })

  return handId
}

export async function saveHandAction(
  handId: string,
  playerId: string,
  phase: string,
  actionType: string,
  amount: number | null,
  ordering: number,
): Promise<void> {
  await db.insert(handActions).values({
    handId,
    playerId,
    phase,
    actionType,
    amount: amount ?? null,
    ordering,
  })
}

export async function saveHandResults(
  handId: string,
  results: HandResult[],
): Promise<void> {
  const completedAt = new Date()

  await db.transaction(async (tx) => {
    if (results.length > 0) {
      await tx.insert(handResults).values(
        results.map((result) => ({
          handId,
          playerId: result.playerId,
          holeCards: result.holeCards,
          handRank: result.evaluation?.rank ?? null,
          handDescription: result.evaluation?.description ?? null,
          winnings: result.winnings,
        })),
      )
    }

    await tx
      .update(hands)
      .set({ completedAt })
      .where(eq(hands.id, handId))
  })
}

export async function getSessionLedger(
  gameId: string,
): Promise<
  Array<{
    playerId: string
    displayName: string
    chipsBroughtIn: number
    chipsCarriedOut: number | null
    netResult: number | null
  }>
> {
  const rows = await db
    .select({
      playerId: players.id,
      displayName: players.displayName,
      chipsBroughtIn: players.chipsBroughtIn,
      chipsCarriedOut: players.chipsCarriedOut,
    })
    .from(players)
    .where(eq(players.gameId, gameId))

  return rows.map((row) => ({
    ...row,
    netResult:
      row.chipsCarriedOut === null
        ? null
        : row.chipsCarriedOut - row.chipsBroughtIn,
  }))
}

export async function updatePlayerChipsCarriedOut(
  playerId: string,
  chips: number,
): Promise<void> {
  await db
    .update(players)
    .set({ chipsCarriedOut: chips })
    .where(eq(players.id, playerId))
}
