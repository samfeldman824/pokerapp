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
  Raise = 'raise',
}

// Discriminated union for player actions
export type PlayerAction =
  | { type: ActionType.Fold }
  | { type: ActionType.Check }
  | { type: ActionType.Call }
  | { type: ActionType.Raise; amount: number }

export interface SidePot {
  amount: number
  eligiblePlayerIds: string[]
}

export interface PlayerState {
  id: string
  displayName: string
  chips: number
  holeCards: [Card, Card] | null  // null = not dealt yet or hidden
  bet: number                      // current bet in this round
  totalBetThisHand: number         // total bet across all rounds this hand
  isFolded: boolean
  isAllIn: boolean
  isConnected: boolean
  seatIndex: number                // 0-8
  token: string                    // reconnection token (server-side only)
}

export interface GameConfig {
  smallBlind: number
  bigBlind: number
  startingStack: number
  timePerAction: number            // seconds, 0 = no limit
  maxPlayers: number               // 2-9
}

export interface GameState {
  id: string
  config: GameConfig
  phase: GamePhase
  players: PlayerState[]           // indexed by seat (sparse array ok)
  communityCards: Card[]           // 0-5 cards
  pot: number                      // total pot (all bets collected)
  sidePots: SidePot[]
  dealerIndex: number              // seat index of dealer
  activePlayerIndex: number        // seat index of player to act (-1 if none)
  deck: Card[]                     // remaining deck (server-side only)
  handNumber: number               // increments each hand
  lastRaiseAmount: number          // for minimum re-raise calculation
  actionTimerStart: number | null  // timestamp when current player's timer started
  isPaused: boolean
  hostPlayerId: string             // player ID of the host
}

// Client-safe version (hides other players' hole cards)
export interface ClientGameState extends Omit<GameState, 'deck'> {
  // deck is omitted entirely
  // holeCards for other players will be null (hidden)
}

export interface HandEvaluation {
  rank: HandRank
  description: string
  cards: Card[]                    // best 5 cards
}

export interface ComparisonResult {
  winners: Array<{ playerId: string; evaluation: HandEvaluation }>
  losers: Array<{ playerId: string; evaluation: HandEvaluation }>
}

export interface PotAward {
  potIndex: number                 // 0 = main pot, 1+ = side pots
  amount: number
  winnerIds: string[]
  handDescription: string
}

export interface HandResult {
  playerId: string
  holeCards: [Card, Card] | null
  evaluation: HandEvaluation | null  // null if player folded
  winnings: number
  potAwards: PotAward[]
}
