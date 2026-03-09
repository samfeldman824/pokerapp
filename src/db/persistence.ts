/**
 * Database persistence layer — Drizzle ORM queries for game, player, and hand data.
 *
 * All functions are fire-and-forget from the game engine's perspective: the engine
 * works with pure in-memory `GameState` objects and delegates persistence to this
 * module. `saveGame` uses upsert semantics so callers don't need to distinguish
 * between insert and update.
 *
 * `gameState` column: the full `GameState` snapshot is stored as JSON (minus the
 * deck, which is excluded to save space and because it can be regenerated).
 * On load, `deck` is restored as an empty array; the game engine regenerates it
 * at the start of each hand via `startHand`.
 */

import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { GameConfig, GameState, HandResult, PlayerState } from '../engine/types'
import { GamePhase } from '../engine/types'
import { db } from './index'
import { games, handActions, handResults, hands, players } from './schema'

/**
 * Upserts a game record. If the game already exists, updates config, status,
 * host, and the full game state snapshot. The deck is excluded from the snapshot
 * to avoid persisting a large array that can be regenerated on next `startHand`.
 */
export async function saveGame(game: GameState): Promise<void> {
  const createdAt = new Date()
  const status = game.isPaused ? 'paused' : 'active'
  const { deck: _deck, ...gameSnapshot } = game

  await db
    .insert(games)
    .values({
      id: game.id,
      config: game.config,
      status,
      hostPlayerId: game.hostPlayerId,
      gameState: gameSnapshot,
      createdAt,
    })
    .onConflictDoUpdate({
      target: games.id,
      set: {
        config: game.config,
        status,
        hostPlayerId: game.hostPlayerId,
        gameState: gameSnapshot,
      },
    })
}

/**
 * Loads a game from the database by ID.
 *
 * Priority:
 * 1. If a `gameState` JSON snapshot exists, deserialise it and return with
 *    an empty deck (the most common path after the first save).
 * 2. Otherwise, reconstruct a minimal Waiting-phase game from the `players`
 *    table (legacy path for rows created before the snapshot column was added).
 *
 * Returns `null` if no row is found.
 */
export async function loadPersistedGame(gameId: string): Promise<GameState | null> {
  const [gameRow] = await db
    .select({
      id: games.id,
      config: games.config,
      hostPlayerId: games.hostPlayerId,
      gameState: games.gameState,
    })
    .from(games)
    .where(eq(games.id, gameId))
    .limit(1)

  if (!gameRow) {
    return null
  }

  if (gameRow.gameState) {
    const snapshot = gameRow.gameState as Omit<GameState, 'deck'>
    return {
      ...snapshot,
      shownCards: snapshot.shownCards ?? {},
      deck: [],
    }
  }

  // Legacy fallback: reconstruct from players table (no game snapshot saved yet)
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
    lastAction: null,
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
    shownCards: {},
    handNumber: 0,
    lastRaiseAmount: config.bigBlind,
    playersToAct: [],
    timerStart: null,
    actionTimerStart: null,
    isPaused: false,
    hostPlayerId: gameRow.hostPlayerId ?? '',
  }
}

/**
 * Upserts a player record. `chipsBroughtIn` records the starting stack at join
 * time; `chipsCarriedOut` is updated separately when the session ends.
 */
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

/**
 * Inserts a new hand record at the start of each hand.
 * Returns the generated hand ID, which is used as a foreign key for actions
 * and results throughout the hand.
 */
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

/**
 * Appends one player action to the hand history.
 * `ordering` is a monotonically increasing counter so actions can be replayed
 * in the correct sequence regardless of DB insertion order.
 */
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

/**
 * Persists final results for all players in a hand and marks the hand as
 * complete by setting `completedAt`. Runs in a transaction so the results
 * insert and the timestamp update are atomic.
 */
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

/**
 * Returns a buy-in / cash-out summary for every player in a session.
 * `netResult` is null for players who are still active (haven't cashed out yet).
 */
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

/** Updates a player's final chip count when they leave the game. */
export async function updatePlayerChipsCarriedOut(
  playerId: string,
  chips: number,
): Promise<void> {
  await db
    .update(players)
    .set({ chipsCarriedOut: chips })
    .where(eq(players.id, playerId))
}
