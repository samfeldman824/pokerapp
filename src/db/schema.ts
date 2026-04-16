/**
 * Drizzle ORM schema — defines all database tables.
 *
 * Tables and their purpose:
 * - `games`        — One row per game session. The full `GameState` JSON snapshot is stored
 *                    in `gameState` so a server restart can restore in-memory state from the DB.
 * - `players`      — One row per player per game. Tracks chip accounting for the session ledger.
 * - `hands`        — One row per hand dealt. Links to actions and results.
 * - `handActions`  — Ordered log of every fold/check/call/raise for hand history replay.
 * - `handResults`  — Final outcomes per player per hand (winnings, hole cards, hand rank).
 */

import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  serial,
} from 'drizzle-orm/pg-core'

export const games = pgTable('games', {
  id: text('id').primaryKey(),
  /** Full `GameConfig` object stored as JSON. */
  config: jsonb('config').notNull(),
  /** 'active' | 'paused' | 'completed' */
  status: text('status').notNull().default('active'),
  hostPlayerId: text('host_player_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
  /**
   * Full `GameState` snapshot (minus `deck`, which is excluded to save space).
   * Populated on every `saveGame` call. Used by `loadPersistedGame` to restore
   * in-memory state after a server restart without rebuilding from scratch.
   */
  gameState: jsonb('game_state'),
})

export const players = pgTable('players', {
  id: text('id').primaryKey(),
  gameId: text('game_id').notNull().references(() => games.id),
  displayName: text('display_name').notNull(),
  seatIndex: integer('seat_index').notNull(),
  /** Opaque reconnect token — matches `PlayerState.token`. Never exposed to other clients. */
  token: text('token').notNull(),
  /** Chips at join time. Used as the "bought in" baseline for the session ledger. */
  chipsBroughtIn: integer('chips_brought_in').notNull().default(0),
  /**
   * Chips when the player left the game. `null` means the player is still active.
   * The ledger endpoint substitutes the live chip count when this is null.
   */
  chipsCarriedOut: integer('chips_carried_out'),
  joinedAt: timestamp('joined_at').notNull().defaultNow(),
  leftAt: timestamp('left_at'),
})

export const hands = pgTable('hands', {
  id: text('id').primaryKey(),
  gameId: text('game_id').notNull().references(() => games.id),
  handNumber: integer('hand_number').notNull(),
  dealerSeatIndex: integer('dealer_seat_index').notNull(),
  /** Community cards revealed during the hand (0–5 cards as JSON). */
  communityCards: jsonb('community_cards').notNull().default([]),
  /** Final board list for completed hands (one entry for normal hands, two for dual-board hands). */
  boards: jsonb('boards').notNull().default([]),
  /** Total chips in all pots at the end of the hand. */
  potTotal: integer('pot_total').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  /** Set when the hand completes (showdown or uncontested win). */
  completedAt: timestamp('completed_at'),
})

export const handActions = pgTable('hand_actions', {
  id: serial('id').primaryKey(),
  handId: text('hand_id').notNull().references(() => hands.id),
  playerId: text('player_id').notNull().references(() => players.id),
  /** Game phase when the action occurred ('preflop' | 'flop' | 'turn' | 'river'). */
  phase: text('phase').notNull(),
  /** 'fold' | 'check' | 'call' | 'raise' */
  actionType: text('action_type').notNull(),
  /** Total raise-to amount for raises; null for fold/check/call. */
  amount: integer('amount'),
  /**
   * Monotonically increasing sequence number per hand.
   * Used to replay actions in order regardless of DB insertion timing.
   */
  ordering: integer('ordering').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const handResults = pgTable('hand_results', {
  id: serial('id').primaryKey(),
  handId: text('hand_id').notNull().references(() => hands.id),
  playerId: text('player_id').notNull().references(() => players.id),
  /** Two-card JSON array; null if the player folded before showdown. */
  holeCards: jsonb('hole_cards'),
  /** Board-specific evaluation and winnings breakdown. */
  boardResults: jsonb('board_results').notNull().default([]),
  /** Numeric `HandRank` enum value; null if the player folded. */
  handRank: integer('hand_rank'),
  /** Human-readable description (e.g., "Ace-high Flush"); null if folded. */
  handDescription: text('hand_description'),
  /** Net chips won from all pots this hand (0 for losers/folders). */
  winnings: integer('winnings').notNull().default(0),
})
