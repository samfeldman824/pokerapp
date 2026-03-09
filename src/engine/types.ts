/**
 * Core type definitions for the poker engine.
 *
 * Two representations of game state exist:
 * - `GameState`        — Full server-side state (includes deck, player tokens, all hole cards)
 * - `ClientGameState` — Scrubbed version safe to send over the wire (no deck, no tokens,
 *                        opponents' hole cards hidden until showdown)
 *
 * Two representations of the player list exist:
 * - Compact (canonical): `players` is a dense sorted array of all seated players.
 *   This is what `GameState` holds everywhere outside of `betting.ts`.
 * - Sparse (internal):   `players` is indexed by seat number (players[seatIndex] = PlayerState).
 *   `betting.ts` requires this so it can walk seats in order without searching.
 *   `gameController.ts` converts between the two formats via `toInternalGame`/`fromInternalGame`.
 */

// Suits and Ranks
export enum Suit {
  Clubs = 'clubs',
  Diamonds = 'diamonds',
  Hearts = 'hearts',
  Spades = 'spades',
}

export enum Rank {
  Two = '2',
  Three = '3',
  Four = '4',
  Five = '5',
  Six = '6',
  Seven = '7',
  Eight = '8',
  Nine = '9',
  Ten = 'T',
  Jack = 'J',
  Queen = 'Q',
  King = 'K',
  Ace = 'A',
}

export interface Card {
  suit: Suit
  rank: Rank
}

// Hand rankings (higher number = better hand)
export enum HandRank {
  HighCard = 1,
  OnePair = 2,
  TwoPair = 3,
  ThreeOfAKind = 4,
  Straight = 5,
  Flush = 6,
  FullHouse = 7,
  FourOfAKind = 8,
  StraightFlush = 9,
  RoyalFlush = 10,
}

// Game phases
export enum GamePhase {
  Waiting = 'waiting',
  Preflop = 'preflop',
  Flop = 'flop',
  Turn = 'turn',
  River = 'river',
  Showdown = 'showdown',
}

// Player actions
export enum ActionType {
  Fold = 'fold',
  Check = 'check',
  Call = 'call',
  Bet = 'bet',
  Raise = 'raise',
}

// Discriminated union for player actions
export type PlayerAction =
  | { type: ActionType.Fold }
  | { type: ActionType.Check }
  | { type: ActionType.Call }
  | { type: ActionType.Bet; amount: number }
  | { type: ActionType.Raise; amount: number }

/**
 * A slice of the pot that only certain players are eligible to win.
 * Created when one or more players go all-in for different amounts.
 */
export interface SidePot {
  amount: number
  eligiblePlayerIds: string[]
}

export interface PlayerState {
  id: string
  displayName: string
  chips: number
  holeCards: [Card, Card] | null  // null = not dealt yet or hidden
  bet: number                      // current bet in this round (reset to 0 at each street)
  totalBetThisHand: number         // accumulated bet across all streets — used for pot eligibility calculations
  isFolded: boolean
  isAllIn: boolean
  isConnected: boolean
  disconnectTime: number | null    // timestamp (ms) when the player disconnected; null if connected
  seatIndex: number                // 0-indexed seat position at the table (0–8)
  token: string                    // opaque reconnection secret — SERVER-SIDE ONLY, never sent to clients
  lastAction: { type: ActionType; amount?: number; timestamp: number } | null  // last action taken by this player (cleared at hand start)
}

export interface GameConfig {
  smallBlind: number
  bigBlind: number
  startingStack: number
  timePerAction: number            // seconds per action; 0 = no limit
  maxPlayers: number               // 2–9
}

export interface GameState {
  id: string
  config: GameConfig
  phase: GamePhase
  players: PlayerState[]           // compact sorted array (canonical form); sparse when passed into betting.ts
  communityCards: Card[]           // 0–5 cards revealed so far
  pot: number                      // chips collected from previous streets (current street bets live on PlayerState.bet)
  sidePots: SidePot[]
  dealerIndex: number              // seat index of the current dealer (-1 before the first hand)
  activePlayerIndex: number        // seat index of the player to act; -1 when no action is required
  currentBet?: number              // highest bet on the table this street
  minRaise?: number                // minimum raise SIZE (not total bet) for the current street
  deck: Card[]                     // remaining undealt cards — SERVER-SIDE ONLY, stripped before client broadcast
  shownCards: Record<string, boolean>
  handNumber: number               // increments each hand; used for hand history
  lastRaiseAmount: number          // tracks the most recent raise increment for minimum re-raise calculation
  /**
   * Ordered queue of seat indices still to act this street.
   * Managed by `betting.ts` — drained as players act; rebuilt on each raise.
   * `activePlayerIndex` is always the first element of this queue.
   */
  playersToAct?: number[]
  timerStart: number | null        // legacy field — use `actionTimerStart` instead
  /**
   * Timestamp (ms) when the current player's action clock started.
   * Set by `startActionTimer` in timeout.ts; read by `isTimedOut` and sent to
   * clients so they can render a countdown without a separate real-time channel.
   */
  actionTimerStart: number | null
  isPaused: boolean
  hostPlayerId: string             // player ID of the host (can start/pause/resume; reassigned on disconnect)
}

/**
 * Client-facing player snapshot.
 *
 * Omits `token` entirely (never sent over the wire — it's the reconnect secret).
 * `holeCards` uses a wider array type (`Card[]`) because the client may receive
 * null (opponent's cards hidden) or a revealed array at showdown.
 */
export type ClientPlayerState = Omit<PlayerState, 'holeCards' | 'token'> & {
  holeCards: Card[] | null
}

/**
 * Client-safe version of `GameState`.
 *
 * Two fields are stripped before broadcasting:
 * - `deck` — always removed; clients must never see undealt cards
 * - Each player's `token` — see `ClientPlayerState` above
 *
 * Player hole cards are hidden for opponents (shown only to the owner and at showdown).
 * The player array uses `null` slots to preserve seat indices in the sparse internal format
 * that some client rendering logic depends on.
 */
export type ClientGameState = Omit<GameState, 'players' | 'deck'> & {
  players: (ClientPlayerState | null)[]
  deck?: never
}

export interface HandEvaluation {
  rank: HandRank
  description: string
  cards: Card[]                    // best 5 cards from hole + community cards
}

export interface ComparisonResult {
  winners: Array<{ playerId: string; evaluation: HandEvaluation }>
  losers: Array<{ playerId: string; evaluation: HandEvaluation }>
}

export interface PotAward {
  potIndex: number                 // 0 = main pot, 1+ = side pots
  amount: number
  winnerIds: string[]
  handDescription: string          // e.g., "Ace-high Flush"
}

export interface HandResult {
  playerId: string
  holeCards: [Card, Card] | null   // null if the player folded before showdown
  evaluation: HandEvaluation | null  // null if player folded
  winnings: number
  chipDelta: number                  // net chip change this hand (negative = lost chips)
  potAwards: PotAward[]
}
