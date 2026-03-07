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
  config: jsonb('config').notNull(),
  status: text('status').notNull().default('active'),
  hostPlayerId: text('host_player_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
})

export const players = pgTable('players', {
  id: text('id').primaryKey(),
  gameId: text('game_id').notNull().references(() => games.id),
  displayName: text('display_name').notNull(),
  seatIndex: integer('seat_index').notNull(),
  token: text('token').notNull(),
  chipsBroughtIn: integer('chips_brought_in').notNull().default(0),
  chipsCarriedOut: integer('chips_carried_out'),
  joinedAt: timestamp('joined_at').notNull().defaultNow(),
  leftAt: timestamp('left_at'),
})

export const hands = pgTable('hands', {
  id: text('id').primaryKey(),
  gameId: text('game_id').notNull().references(() => games.id),
  handNumber: integer('hand_number').notNull(),
  dealerSeatIndex: integer('dealer_seat_index').notNull(),
  communityCards: jsonb('community_cards').notNull().default([]),
  potTotal: integer('pot_total').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
})

export const handActions = pgTable('hand_actions', {
  id: serial('id').primaryKey(),
  handId: text('hand_id').notNull().references(() => hands.id),
  playerId: text('player_id').notNull().references(() => players.id),
  phase: text('phase').notNull(),
  actionType: text('action_type').notNull(),
  amount: integer('amount'),
  ordering: integer('ordering').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const handResults = pgTable('hand_results', {
  id: serial('id').primaryKey(),
  handId: text('hand_id').notNull().references(() => hands.id),
  playerId: text('player_id').notNull().references(() => players.id),
  holeCards: jsonb('hole_cards'),
  handRank: integer('hand_rank'),
  handDescription: text('hand_description'),
  winnings: integer('winnings').notNull().default(0),
})
