# Poker Web App MVP — No-Limit Hold'em (PokerNow Clone)

## TL;DR

> **Quick Summary**: Build a real-time multiplayer No-Limit Hold'em poker web app with link-based access (no login), customizable game settings, and persistent hand history. Think PokerNow but MVP — core gameplay only.
> 
> **Deliverables**:
> - Complete NL Hold'em game engine (deck, betting, hand evaluation, side pots)
> - Real-time multiplayer via Socket.IO with reconnection support
> - Next.js frontend with poker table UI, player actions, and game creation flow
> - PostgreSQL persistence for hand history and session ledger
> - Comprehensive test suite (Vitest unit + Playwright E2E)
> 
> **Estimated Effort**: Large
> **Parallel Execution**: YES — 6 waves
> **Critical Path**: Scaffolding → Types → Game Engine → Socket.IO Server → Frontend → E2E Tests

---

## Context

### Original Request
Build a poker web app just like PokerNow.com — an online poker platform where friends can create and join games via shareable links with zero signup required.

### Interview Summary
**Key Discussions**:
- **Game variant**: NL Hold'em only for MVP. PLO and other variants deferred.
- **Access model**: Link sharing, no login. Players pick a display name and play.
- **Host config**: Configurable blind levels (small/big blind), starting stack, time per action.
- **Persistence**: Hand history saved to PostgreSQL. Session ledger available.
- **Money**: Play money only, no real monetary value.
- **Tests**: After implementation, using Vitest for unit tests.

**Research Findings**:
- PokerNow uses link-based access with customizable blinds/stacks/time/pause
- Socket.IO + Next.js requires a custom `server.ts` entry point (can't use serverless API routes for WebSockets)
- `pokersolver` is a battle-tested library for hand evaluation — do NOT reimplement
- Game engine must be a pure TypeScript module, zero coupling to Socket.IO or HTTP
- Side pot calculation is the single hardest algorithm in the poker engine

### Metis Review
**Identified Gaps** (addressed):
- **Custom server.ts required**: Socket.IO can't run in Next.js API routes — plan uses custom HTTP server wrapping both Next.js and Socket.IO
- **Heads-up special rules**: 2-player games have different blind/action rules — dedicated handling required
- **Player reconnection**: Token-based (localStorage) reconnection planned — page refresh preserves seat
- **Side pot complexity**: Dedicated module with extensive test cases, not embedded in game controller
- **Game lifecycle beyond single hand**: Auto-deal, player bust/rebuy, join mid-game all specified

---

## Work Objectives

### Core Objective
Build a fully functional, real-time multiplayer No-Limit Hold'em poker web app that players can access via shareable links — no download, no signup, no friction.

### Concrete Deliverables
- `server.ts` — Custom server entry point (HTTP + Socket.IO + Next.js)
- `src/engine/` — Pure TypeScript poker game engine (deck, betting, pots, hand eval, game controller)
- `src/server/` — Socket.IO event handlers + REST API endpoints
- `src/db/` — Drizzle ORM schema + persistence layer
- `src/app/` — Next.js pages (landing, join game, poker table)
- `src/components/` — React components (table, cards, actions, player seats)
- `docker-compose.yml` — PostgreSQL for local development
- Test suites — Vitest unit tests + Playwright E2E

### Definition of Done
- [x] Two players can create a game, join via link, and play a complete hand of NL Hold'em
- [x] Side pots work correctly with 3+ player all-in scenarios
- [x] Player can refresh browser and rejoin their seat with correct stack
- [x] Host can configure blinds, starting stack, and time per action
- [x] Hand history is persisted in PostgreSQL
- [x] All Vitest tests pass: `bun test`
- [x] Playwright E2E passes: full game flow from creation to hand completion

### Must Have
- Server-authoritative game logic (client sends actions, server validates and broadcasts)
- Correct NL Hold'em rules: preflop, flop, turn, river, showdown
- Heads-up (2-player) special rules for blinds and action order
- Side pot calculation for multi-way all-in scenarios
- Split pot for tied hands (odd chip to player left of dealer)
- Player reconnection via token (survives page refresh)
- Auto-fold on disconnect timeout (30s default)
- Rebuy allowed when player busts (at starting stack amount)
- Join mid-game support (cash game format)
- Docker-compose for PostgreSQL local dev

### Must NOT Have (Guardrails)
- No tournament mode / blind level escalation / blind clock timer
- No video/voice chat
- No text chat (MVP)
- No spectator mode
- No hand history replay viewer (write-only persistence)
- No animations beyond CSS transitions (no canvas/WebGL)
- No sound effects or audio
- No persistent player accounts or login system
- No client-side game logic validation — server is sole authority
- No straddle, ante, bomb pot, run-it-twice, rabbit hunting, 7-2 bounty, double board
- No clubs, communities, or multi-table tournaments
- No rake or currency system
- No custom card designs or themes

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: NO (greenfield project)
- **Automated tests**: Tests-after-implementation
- **Framework**: Vitest for unit/integration, Playwright for E2E
- **Setup**: Included as task in Wave 5

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Game Engine**: Use Bash (bun/node REPL) — Import modules, call functions, assert outputs
- **Socket.IO Server**: Use Bash (node scripts) — Connect multiple clients, send actions, verify state
- **Frontend/UI**: Use Playwright — Navigate, interact, assert DOM, screenshot
- **API**: Use Bash (curl) — Send requests, assert status + response fields

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — all independent, start immediately):
├── Task 1: Project scaffolding + custom server + docker-compose [quick]
├── Task 2: Shared TypeScript types + constants [quick]
├── Task 3: Database schema with Drizzle ORM [quick]
├── Task 4: Card deck module (create, shuffle, deal) [quick]
├── Task 5: Hand evaluation module (pokersolver wrapper) [quick]
└── Task 6: Player session manager (tokens, join/leave) [quick]

Wave 2 (Game Engine — depends on Wave 1 types/deck/eval):
├── Task 7: Betting round state machine (depends: 2, 4) [deep]
├── Task 8: Pot calculator + side pots (depends: 2) [deep]
├── Task 9: Game controller — full hand lifecycle (depends: 4, 5, 7, 8) [deep]
└── Task 10: Player timeout + auto-fold + rebuy (depends: 6, 7) [unspecified-high]

Wave 3 (Server Layer — depends on game engine):
├── Task 11: Socket.IO server layer + event handlers (depends: 9, 10) [deep]
├── Task 12: REST API endpoints (depends: 3, 9) [quick]
└── Task 13: Database persistence layer (depends: 3, 9) [unspecified-high]

Wave 4 (Frontend — depends on types + server):
├── Task 14: Landing page + game creation form (depends: 12) [visual-engineering]
├── Task 15: Game join page + display name entry (depends: 12) [visual-engineering]
├── Task 16: Poker table layout + player seats (depends: 2) [visual-engineering]
├── Task 17: Card components (hole cards + community) (depends: 2) [visual-engineering]
├── Task 18: Player action bar + raise slider + timer (depends: 2) [visual-engineering]
└── Task 19: Socket.IO client + React state management (depends: 11) [unspecified-high]

Wave 5 (Integration + Tests — depends on frontend + server):
├── Task 20: Full game flow wiring + integration (depends: 14-19) [deep]
├── Task 21: Reconnection + edge case handling (depends: 19, 20) [unspecified-high]
├── Task 22: Vitest setup + game engine unit tests (depends: 7, 8, 9) [unspecified-high]
├── Task 23: Socket.IO integration tests (depends: 11, 20) [unspecified-high]
└── Task 24: Playwright E2E tests (depends: 20) [unspecified-high]

Wave FINAL (Verification — after ALL tasks):
├── Task F1: Plan compliance audit [oracle]
├── Task F2: Code quality review [unspecified-high]
├── Task F3: Real manual QA [unspecified-high]
└── Task F4: Scope fidelity check [deep]

Critical Path: T1 → T2 → T7 → T9 → T11 → T19 → T20 → T24 → F1-F4
Parallel Speedup: ~65% faster than sequential
Max Concurrent: 6 (Waves 1 & 4)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | — | 2-6 | 1 |
| 2 | 1 | 7, 8, 9, 16-18 | 1 |
| 3 | 1 | 12, 13 | 1 |
| 4 | 1 | 7, 9 | 1 |
| 5 | 1 | 9 | 1 |
| 6 | 1 | 10 | 1 |
| 7 | 2, 4 | 9, 10 | 2 |
| 8 | 2 | 9 | 2 |
| 9 | 4, 5, 7, 8 | 11, 12, 13, 22 | 2 |
| 10 | 6, 7 | 11 | 2 |
| 11 | 9, 10 | 19, 23 | 3 |
| 12 | 3, 9 | 14, 15 | 3 |
| 13 | 3, 9 | 20 | 3 |
| 14 | 12 | 20 | 4 |
| 15 | 12 | 20 | 4 |
| 16 | 2 | 20 | 4 |
| 17 | 2 | 20 | 4 |
| 18 | 2 | 20 | 4 |
| 19 | 11 | 20, 21 | 4 |
| 20 | 14-19 | 21, 23, 24 | 5 |
| 21 | 19, 20 | 24 | 5 |
| 22 | 7, 8, 9 | F1-F4 | 5 |
| 23 | 11, 20 | F1-F4 | 5 |
| 24 | 20 | F1-F4 | 5 |

### Agent Dispatch Summary

- **Wave 1**: **6 tasks** — T1-T6 → `quick`
- **Wave 2**: **4 tasks** — T7 → `deep`, T8 → `deep`, T9 → `deep`, T10 → `unspecified-high`
- **Wave 3**: **3 tasks** — T11 → `deep`, T12 → `quick`, T13 → `unspecified-high`
- **Wave 4**: **6 tasks** — T14-T18 → `visual-engineering`, T19 → `unspecified-high`
- **Wave 5**: **5 tasks** — T20 → `deep`, T21-T24 → `unspecified-high`
- **FINAL**: **4 tasks** — F1 → `oracle`, F2-F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. Project Scaffolding + Custom Server + Docker Compose

  **What to do**:
  - Initialize Next.js 14+ project with App Router, TypeScript strict mode, Tailwind CSS
  - Install dependencies: `socket.io`, `socket.io-client`, `drizzle-orm`, `pg`, `pokersolver`, `nanoid`
  - Install dev dependencies: `vitest`, `@playwright/test`, `drizzle-kit`, `@types/pg`
  - Create `server.ts` — custom HTTP server that:
    - Creates Node.js HTTP server
    - Attaches Socket.IO server to it
    - Attaches Next.js request handler for all non-socket requests
    - Listens on PORT env var (default 3000)
  - Create `docker-compose.yml` with PostgreSQL 16 service (port 5432, user/pass/db configured)
  - Create `.env.example` with `DATABASE_URL=postgresql://poker:poker@localhost:5432/pokerapp`
  - Add dev script to `package.json`: `"dev": "tsx watch server.ts"` (NOT `next dev`)
  - Create directory structure: `src/engine/`, `src/server/`, `src/db/`, `src/components/`, `src/lib/`
  - Verify: `docker compose up -d` starts PostgreSQL, `bun run dev` starts server on port 3000 with both Socket.IO and Next.js working

  **Must NOT do**:
  - Do NOT use Next.js API routes for WebSocket handling
  - Do NOT add authentication or session middleware
  - Do NOT install UI component libraries (shadcn, MUI, etc.)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
    - No skills needed — standard project setup

  **Parallelization**:
  - **Can Run In Parallel**: YES (first task, no dependencies)
  - **Parallel Group**: Wave 1 (standalone — other Wave 1 tasks depend on this)
  - **Blocks**: Tasks 2-6 (all need project to exist)
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - None (greenfield project)

  **External References**:
  - Next.js custom server docs: https://nextjs.org/docs/pages/building-your-application/configuring/custom-server
  - Socket.IO with Next.js: the custom server pattern is required because Next.js API routes are serverless/request-response and cannot hold WebSocket connections
  - Drizzle ORM setup: https://orm.drizzle.team/docs/get-started-postgresql

  **WHY Each Reference Matters**:
  - Custom server docs show the exact pattern for wrapping Next.js handler with HTTP server — critical for Socket.IO attachment
  - Drizzle setup docs specify the `drizzle.config.ts` format and migration commands

  **Acceptance Criteria**:
  - [ ] `docker compose up -d` starts PostgreSQL container successfully
  - [ ] `bun run dev` starts server, console shows "Server listening on port 3000"
  - [ ] `curl http://localhost:3000` returns Next.js HTML page (200 status)
  - [ ] Socket.IO endpoint is accessible (connection handshake works)
  - [ ] TypeScript compiles cleanly: `npx tsc --noEmit` → 0 errors
  - [ ] Directory structure exists: src/engine/, src/server/, src/db/, src/components/, src/lib/

  **QA Scenarios**:

  ```
  Scenario: Server starts with both Next.js and Socket.IO
    Tool: Bash
    Preconditions: docker compose up -d (PostgreSQL running), node_modules installed
    Steps:
      1. Run `bun run dev &` — start server in background
      2. Wait 5 seconds for startup
      3. Run `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000` — assert HTTP 200
      4. Run `curl -s "http://localhost:3000/socket.io/?EIO=4&transport=polling"` — assert response contains "sid" (Socket.IO handshake)
      5. Run `npx tsc --noEmit` — assert exit code 0
    Expected Result: HTTP 200 from Next.js, Socket.IO handshake succeeds, TypeScript clean
    Failure Indicators: Connection refused, 404/500 errors, TypeScript errors
    Evidence: .sisyphus/evidence/task-1-server-startup.txt

  Scenario: Docker Compose PostgreSQL is accessible
    Tool: Bash
    Preconditions: docker compose up -d executed
    Steps:
      1. Run `docker compose ps` — assert postgres service is "running"
      2. Run `docker compose exec -T postgres pg_isready` — assert "accepting connections"
      3. Run `PGPASSWORD=poker psql -h localhost -U poker -d pokerapp -c "SELECT 1"` — assert returns 1
    Expected Result: PostgreSQL container running and accepting connections
    Failure Indicators: Container not running, connection refused, auth failure
    Evidence: .sisyphus/evidence/task-1-postgres-ready.txt
  ```

  **Commit**: YES
  - Message: `feat(scaffold): initialize Next.js project with custom server, Socket.IO, and Docker Compose`
  - Files: `package.json, server.ts, docker-compose.yml, tsconfig.json, tailwind.config.ts, .env.example, drizzle.config.ts, src/`
  - Pre-commit: `npx tsc --noEmit`

- [x] 2. Shared TypeScript Types + Constants

  **What to do**:
  - Create `src/engine/types.ts` with all game types:
    - `Suit` enum: clubs, diamonds, hearts, spades
    - `Rank` enum: 2-10, J, Q, K, A (numeric values for comparison)
    - `Card` type: { suit: Suit, rank: Rank }
    - `HandRank` enum: high-card through royal-flush (10 rankings)
    - `PlayerState`: { id, displayName, chips, holeCards, bet, isFolded, isAllIn, isConnected, seatIndex }
    - `GamePhase` enum: waiting, preflop, flop, turn, river, showdown
    - `ActionType` enum: fold, check, call, raise
    - `PlayerAction`: { playerId, type: ActionType, amount?: number }
    - `GameConfig`: { smallBlind, bigBlind, startingStack, timePerAction, maxPlayers }
    - `GameState`: { id, config, phase, players[], communityCards[], pot, sidePots[], dealerIndex, activePlayerIndex, deck (server only), handNumber }
    - `SidePot`: { amount, eligiblePlayerIds[] }
    - `HandResult`: { playerId, handRank, handDescription, winnings }
  - Create `src/engine/constants.ts`:
    - DEFAULT_CONFIG: sensible defaults (1/2 blinds, 1000 stack, 30s time, 9 max)
    - MIN/MAX values for config validation
  - All types must be shared between server and client (no server-only imports)
  - Use discriminated unions where appropriate for type safety

  **Must NOT do**:
  - Do NOT include Socket.IO event types here (those go in server layer)
  - Do NOT include database model types here (those go with Drizzle schema)
  - Do NOT use `any` type anywhere

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 3-6)
  - **Blocks**: Tasks 7, 8, 9, 16, 17, 18
  - **Blocked By**: Task 1 (project must exist)

  **References**:

  **External References**:
  - Standard poker hand rankings: Royal Flush > Straight Flush > Four of a Kind > Full House > Flush > Straight > Three of a Kind > Two Pair > One Pair > High Card
  - NL Hold'em rules: 2 hole cards per player, 5 community cards, best 5-card hand from 7 cards

  **WHY Each Reference Matters**:
  - Hand rankings define the HandRank enum values and ordering
  - NL Hold'em rules inform the GamePhase enum and GameState structure

  **Acceptance Criteria**:
  - [ ] `npx tsc --noEmit` passes with zero errors
  - [ ] All types are exported and importable: `import { Card, GameState, PlayerAction } from '@/engine/types'`
  - [ ] No `any` types used anywhere in the file
  - [ ] GameConfig has validation-friendly min/max constants

  **QA Scenarios**:

  ```
  Scenario: Types compile and are importable
    Tool: Bash
    Preconditions: Project scaffolding complete (Task 1)
    Steps:
      1. Run `npx tsc --noEmit` — assert exit code 0
      2. Create a temp test file that imports all types and uses them, compile it
      3. Verify discriminated unions work: create a PlayerAction with type 'raise' and assert 'amount' is required
    Expected Result: All types compile, imports resolve, type constraints work
    Failure Indicators: TypeScript errors, unresolved imports
    Evidence: .sisyphus/evidence/task-2-types-compile.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `feat(types): define shared TypeScript types for poker game state, actions, and config`
  - Files: `src/engine/types.ts, src/engine/constants.ts`
  - Pre-commit: `npx tsc --noEmit`

- [x] 3. Database Schema with Drizzle ORM

  **What to do**:
  - Create `src/db/schema.ts` with Drizzle table definitions:
    - `games` table: id (nanoid), config (jsonb), status (active/completed), createdAt, completedAt
    - `players` table: id, gameId (FK), displayName, seatIndex, token (nanoid — for reconnection), chipsBroughtIn, chipsCarriedOut, joinedAt, leftAt
    - `hands` table: id, gameId (FK), handNumber, dealerSeatIndex, communityCards (jsonb), potTotal, createdAt
    - `handActions` table: id, handId (FK), playerId (FK), phase (preflop/flop/turn/river), actionType, amount, createdAt, ordering (sequence number)
    - `handResults` table: id, handId (FK), playerId (FK), holeCards (jsonb), handRank, handDescription, winnings
  - Create `src/db/index.ts` — Drizzle client initialization with `DATABASE_URL` env var
  - Create initial migration with `drizzle-kit generate`
  - Run migration with `drizzle-kit push` (dev mode)
  - All tables should have proper foreign keys, indexes on gameId, handId

  **Must NOT do**:
  - Do NOT use Prisma (binary bloat, overkill for this project)
  - Do NOT create user/account tables (no login system)
  - Do NOT add row-level security or complex access patterns

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 4-6)
  - **Blocks**: Tasks 12, 13
  - **Blocked By**: Task 1 (project + Docker PostgreSQL must exist)

  **References**:

  **External References**:
  - Drizzle ORM PostgreSQL docs: https://orm.drizzle.team/docs/get-started-postgresql
  - Drizzle schema definition: https://orm.drizzle.team/docs/sql-schema-declaration

  **WHY Each Reference Matters**:
  - Drizzle schema syntax differs from Prisma — need correct `pgTable()` and column type usage
  - Migration commands (`drizzle-kit generate`, `drizzle-kit push`) have specific config requirements

  **Acceptance Criteria**:
  - [ ] `drizzle-kit push` applies schema to running PostgreSQL without errors
  - [ ] All tables exist: `psql -c "\dt"` shows games, players, hands, hand_actions, hand_results
  - [ ] Foreign key constraints work: inserting a hand_action with invalid handId fails
  - [ ] `npx tsc --noEmit` passes

  **QA Scenarios**:

  ```
  Scenario: Schema applies cleanly to PostgreSQL
    Tool: Bash
    Preconditions: PostgreSQL running via docker compose, DATABASE_URL set
    Steps:
      1. Run `bunx drizzle-kit push` — assert no errors
      2. Run `PGPASSWORD=poker psql -h localhost -U poker -d pokerapp -c "\dt"` — assert 5 tables listed
      3. Run a simple insert + select via a small TypeScript script using the Drizzle client
    Expected Result: Schema applied, all tables created, Drizzle client can read/write
    Failure Indicators: Migration errors, missing tables, connection errors
    Evidence: .sisyphus/evidence/task-3-schema-applied.txt

  Scenario: Foreign keys enforce referential integrity
    Tool: Bash
    Preconditions: Schema applied
    Steps:
      1. Try to insert a hand_action with a non-existent handId
      2. Assert the insert fails with a foreign key violation
    Expected Result: Insert rejected with foreign key constraint error
    Evidence: .sisyphus/evidence/task-3-fk-constraint.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `feat(db): PostgreSQL schema with Drizzle ORM for games, hands, and actions`
  - Files: `src/db/schema.ts, src/db/index.ts, drizzle.config.ts, drizzle/`
  - Pre-commit: `npx tsc --noEmit`

- [x] 4. Card Deck Module (Create, Shuffle, Deal)

  **What to do**:
  - Create `src/engine/deck.ts` with pure functions:
    - `createDeck(): Card[]` — Returns all 52 cards in standard order
    - `shuffleDeck(deck: Card[]): Card[]` — Fisher-Yates shuffle, returns new array (immutable)
    - `dealCards(deck: Card[], count: number): { dealt: Card[], remaining: Card[] }` — Takes N cards from top
  - Use `Card`, `Suit`, `Rank` types from `src/engine/types.ts`
  - Shuffle must use cryptographically acceptable randomness (`Math.random()` is fine for play money)
  - All functions must be pure — no side effects, no mutation of input arrays
  - Export all functions for testing

  **Must NOT do**:
  - Do NOT use any external library for deck/shuffle
  - Do NOT store deck state in a class or singleton — pure functions only

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 5, 6)
  - **Blocks**: Tasks 7, 9
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src/engine/types.ts` (Task 2) — Card, Suit, Rank types to use

  **External References**:
  - Fisher-Yates shuffle algorithm: iterate from end, swap each element with a random earlier element

  **Acceptance Criteria**:
  - [ ] `createDeck()` returns exactly 52 unique cards
  - [ ] `shuffleDeck()` returns 52 cards in different order, doesn't mutate input
  - [ ] `dealCards(deck, 2)` returns 2 dealt cards and 50 remaining
  - [ ] `npx tsc --noEmit` passes

  **QA Scenarios**:

  ```
  Scenario: Deck creation and dealing
    Tool: Bash (bun eval)
    Preconditions: Task 1 and 2 complete
    Steps:
      1. Run bun script: import { createDeck, shuffleDeck, dealCards } from './src/engine/deck'
      2. const deck = createDeck(); assert deck.length === 52
      3. const unique = new Set(deck.map(c => `${c.rank}-${c.suit}`)); assert unique.size === 52
      4. const shuffled = shuffleDeck(deck); assert shuffled.length === 52; assert deck !== shuffled (not same reference)
      5. const { dealt, remaining } = dealCards(shuffled, 5); assert dealt.length === 5; assert remaining.length === 47
    Expected Result: 52 unique cards, shuffle returns new array, deal splits correctly
    Failure Indicators: Wrong card count, mutation detected, duplicate cards
    Evidence: .sisyphus/evidence/task-4-deck-operations.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `feat(engine): card deck module with create, shuffle, and deal`
  - Files: `src/engine/deck.ts`
  - Pre-commit: `npx tsc --noEmit`

- [x] 5. Hand Evaluation Module (pokersolver Wrapper)

  **What to do**:
  - Create `src/engine/handEvaluator.ts`:
    - `evaluateHand(holeCards: Card[], communityCards: Card[]): HandEvaluation` — Evaluates best 5-card hand from 7 cards
    - `compareHands(hands: HandEvaluation[]): ComparisonResult` — Ranks multiple hands, identifies winner(s) and ties
    - `HandEvaluation` type: { rank: HandRank, description: string, cards: Card[] (best 5), raw: any (pokersolver internal) }
    - `ComparisonResult` type: { winners: HandEvaluation[], losers: HandEvaluation[] }
  - Wrapper around `pokersolver` library — convert our Card types to pokersolver format and back
  - Handle edge case: split pot (two identical hand strengths)
  - pokersolver card format: "As" = Ace of spades, "Th" = Ten of hearts — map our types to this format

  **Must NOT do**:
  - Do NOT implement hand evaluation from scratch — use pokersolver
  - Do NOT expose pokersolver types outside this module (encapsulate)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4, 6)
  - **Blocks**: Task 9
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src/engine/types.ts` (Task 2) — Card, HandRank, Suit, Rank types

  **External References**:
  - pokersolver npm: https://www.npmjs.com/package/pokersolver — `Hand.solve(["As", "Kh", "Qd", "Jc", "Ts"])` returns hand with `.rank` and `.descr`
  - pokersolver `Hand.winners([hand1, hand2])` returns array of winning hands

  **WHY Each Reference Matters**:
  - pokersolver API defines the exact method signatures and card string format needed for the wrapper

  **Acceptance Criteria**:
  - [ ] Correctly identifies all 10 hand rankings (high card through royal flush)
  - [ ] Correctly compares two hands and identifies the winner
  - [ ] Correctly identifies ties (split pot scenarios)
  - [ ] Handles 7-card evaluation (best 5 of 7)

  **QA Scenarios**:

  ```
  Scenario: All hand rankings identified correctly
    Tool: Bash (bun eval)
    Preconditions: Tasks 1, 2 complete, pokersolver installed
    Steps:
      1. Import evaluateHand from module
      2. Test royal flush: hole=[As, Ks], community=[Qs, Js, Ts, 2h, 3d] → assert rank === HandRank.RoyalFlush
      3. Test full house: hole=[Ah, Ad], community=[Ac, Kh, Kd, 2s, 3c] → assert rank === HandRank.FullHouse
      4. Test high card: hole=[2h, 7d], community=[4s, 9c, Jh, Ks, 3d] → assert rank === HandRank.HighCard
      5. Test best 5 of 7: hole=[Ah, Kh], community=[Qh, Jh, Th, 2s, 3d] → assert royal flush (ignores 2s, 3d)
    Expected Result: All hand rankings correctly identified from 7-card input
    Failure Indicators: Wrong ranking, crash on edge cases
    Evidence: .sisyphus/evidence/task-5-hand-rankings.txt

  Scenario: Hand comparison with ties
    Tool: Bash (bun eval)
    Steps:
      1. Import compareHands
      2. Test clear winner: pair of aces vs pair of kings → aces wins
      3. Test exact tie: both players have same flush via community cards → both are winners (split pot)
    Expected Result: Winners correctly identified, ties detected
    Evidence: .sisyphus/evidence/task-5-hand-comparison.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `feat(engine): hand evaluation module wrapping pokersolver`
  - Files: `src/engine/handEvaluator.ts`
  - Pre-commit: `npx tsc --noEmit`

- [x] 6. Player Session Manager (Tokens, Join/Leave)

  **What to do**:
  - Create `src/engine/playerManager.ts`:
    - `createPlayerToken(): string` — Generate unique reconnection token via nanoid (12+ chars)
    - `addPlayer(game: GameState, displayName: string, seatIndex: number): { game: GameState, token: string }` — Add player to game at specified seat, assign token
    - `removePlayer(game: GameState, playerId: string): GameState` — Remove player from game
    - `findPlayerByToken(game: GameState, token: string): PlayerState | null` — Find player by reconnection token
    - `getAvailableSeats(game: GameState): number[]` — Return list of open seat indices
    - `canPlayerJoin(game: GameState): boolean` — Check if game has room
    - `rebuyPlayer(game: GameState, playerId: string): GameState` — Reset player chips to starting stack
  - Use nanoid for token generation
  - All functions pure — take state, return new state
  - Player IDs are nanoid-generated on creation

  **Must NOT do**:
  - Do NOT store player state in memory outside of GameState — all state flows through GameState object
  - Do NOT implement authentication — token is just for reconnection identity

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2-5)
  - **Blocks**: Task 10
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src/engine/types.ts` (Task 2) — GameState, PlayerState, GameConfig types

  **External References**:
  - nanoid: `import { nanoid } from 'nanoid'` — `nanoid(12)` generates URL-safe unique ID

  **Acceptance Criteria**:
  - [ ] `addPlayer` adds player at correct seat with token
  - [ ] `findPlayerByToken` returns correct player
  - [ ] `getAvailableSeats` returns seats not occupied
  - [ ] `removePlayer` removes player and frees their seat
  - [ ] `rebuyPlayer` resets player chips to startingStack from config

  **QA Scenarios**:

  ```
  Scenario: Player join, find by token, and leave
    Tool: Bash (bun eval)
    Steps:
      1. Create initial game state with empty players
      2. addPlayer(game, "Alice", 0) → assert player added at seat 0, token returned
      3. addPlayer(game, "Bob", 3) → assert player added at seat 3
      4. getAvailableSeats(game) → assert seats 0 and 3 are NOT in list
      5. findPlayerByToken(game, aliceToken) → assert returns Alice's player state
      6. removePlayer(game, aliceId) → assert Alice removed, seat 0 available again
    Expected Result: Full player lifecycle works correctly
    Failure Indicators: Wrong seat assignment, token not found, seat not freed
    Evidence: .sisyphus/evidence/task-6-player-management.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `feat(engine): player session manager with tokens, join, leave, and rebuy`
  - Files: `src/engine/playerManager.ts`
  - Pre-commit: `npx tsc --noEmit`

- [ ] 7. Betting Round State Machine

  **What to do**:
  - Create `src/engine/betting.ts`:
    - `postBlinds(game: GameState): GameState` — Post small and big blinds, deduct from players' chips. Handle heads-up special case: dealer posts SB, other player posts BB.
    - `getNextActivePlayer(game: GameState): number` — Find next player who can act (not folded, not all-in). Preflop: start left of BB (UTG). Postflop: start left of dealer.
    - `validateAction(game: GameState, playerId: string, action: PlayerAction): { valid: boolean, reason?: string }` — Validate player can take this action:
      - fold: always valid if it's their turn
      - check: valid only if no outstanding bet
      - call: valid if there's a bet to call
      - raise: valid if raise amount ≥ minimum raise (last raise size or big blind), and player has enough chips
    - `applyAction(game: GameState, action: PlayerAction): GameState` — Apply validated action to game state: update player bets, chips, fold status
    - `isRoundComplete(game: GameState): boolean` — All active players have acted and bets are equalized (or everyone is all-in)
    - `advancePhase(game: GameState): GameState` — Move from preflop→flop→turn→river→showdown. Reset bets. Deal community cards.
    - Handle minimum raise tracking: if Player A raises by 100, Player B's minimum re-raise is also 100 more
    - Handle all-in for less than call amount (player posts what they have, no further action options)
  - Heads-up (2-player) special rules:
    - Dealer posts small blind, non-dealer posts big blind
    - Preflop: dealer (SB) acts first
    - Postflop: non-dealer acts first

  **Must NOT do**:
  - Do NOT handle pot calculation here — that's Task 8
  - Do NOT handle showdown/hand evaluation here — that's Task 9
  - Do NOT implement time bank or auto-action queues

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Complex state machine with many edge cases (heads-up, all-in, min-raise tracking)
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 8)
  - **Parallel Group**: Wave 2 (with Tasks 8, 9, 10)
  - **Blocks**: Tasks 9, 10
  - **Blocked By**: Tasks 2, 4

  **References**:

  **Pattern References**:
  - `src/engine/types.ts` (Task 2) — GameState, PlayerAction, GamePhase, ActionType
  - `src/engine/deck.ts` (Task 4) — dealCards for dealing community cards during phase advance

  **External References**:
  - NL Hold'em betting rules: preflop action starts UTG (left of BB), postflop starts left of dealer
  - Heads-up rules: dealer = SB, acts first preflop, second postflop
  - Minimum raise rule: re-raise must be at least the size of the previous raise

  **Acceptance Criteria**:
  - [ ] Blinds posted correctly for 2-9 players
  - [ ] Heads-up blind posting: dealer = SB, other = BB
  - [ ] Action validation rejects invalid actions (check when bet exists, raise below minimum)
  - [ ] Round completes when all bets equalized
  - [ ] Phase advances correctly: preflop → flop (3 cards) → turn (1 card) → river (1 card) → showdown
  - [ ] All-in player cannot be asked for further action

  **QA Scenarios**:

  ```
  Scenario: Full betting round with 3 players
    Tool: Bash (bun eval)
    Steps:
      1. Create game with 3 players (seats 0, 1, 2), dealer at seat 0
      2. postBlinds → assert seat 1 posted SB (1), seat 2 posted BB (2)
      3. getNextActivePlayer → assert seat 0 (UTG)
      4. applyAction(seat 0, raise to 6) → assert seat 0 chips reduced, bet = 6
      5. applyAction(seat 1, call) → assert seat 1 chips reduced, bet = 6
      6. applyAction(seat 2, call) → assert seat 2 chips reduced, bet = 6
      7. isRoundComplete → assert true
      8. advancePhase → assert phase = flop, 3 community cards dealt, all bets reset to 0
    Expected Result: Complete betting round with correct state transitions
    Failure Indicators: Wrong player order, incorrect bet amounts, phase not advancing
    Evidence: .sisyphus/evidence/task-7-betting-round.txt

  Scenario: Heads-up special rules
    Tool: Bash (bun eval)
    Steps:
      1. Create game with 2 players, dealer at seat 0
      2. postBlinds → assert seat 0 (dealer) posted SB, seat 1 posted BB
      3. getNextActivePlayer → assert seat 0 (dealer acts first preflop in heads-up)
      4. Advance to flop
      5. getNextActivePlayer → assert seat 1 (non-dealer acts first postflop)
    Expected Result: Heads-up blind posting and action order correct
    Evidence: .sisyphus/evidence/task-7-heads-up.txt

  Scenario: All-in for less than call amount
    Tool: Bash (bun eval)
    Steps:
      1. Create game with player A having 500 chips, player B having 50 chips
      2. Player A raises to 100
      3. Player B goes all-in for 50 (less than the 100 call)
      4. Assert Player B's bet = 50, isAllIn = true
      5. Assert round complete (no more actions possible)
    Expected Result: Short all-in handled correctly
    Evidence: .sisyphus/evidence/task-7-short-allin.txt
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `feat(engine): betting round state machine with heads-up rules and all-in handling`
  - Files: `src/engine/betting.ts`
  - Pre-commit: `npx tsc --noEmit`

- [ ] 8. Pot Calculator + Side Pots

  **What to do**:
  - Create `src/engine/potCalculator.ts`:
    - `calculatePots(players: PlayerState[]): { mainPot: SidePot, sidePots: SidePot[] }` — Calculate main pot and side pots from player bets
      - Algorithm: sort all-in amounts ascending, create pot layers for each all-in amount
      - Each pot tracks: amount and list of eligible player IDs
    - `awardPots(pots: SidePot[], handResults: Map<string, HandEvaluation>): PotAward[]` — Award each pot to winner(s) among eligible players
      - `PotAward`: { potIndex, amount, winnerIds[], handDescription }
    - `splitPotEvenly(amount: number, winnerCount: number): { perPlayer: number, remainder: number }` — Split pot for ties, odd chip handling
    - Handle all edge cases:
      - Single all-in: 2 pots (main up to all-in amount, side for remainder)
      - Multiple all-ins at different amounts: N+1 pots
      - All players all-in: just distribute pots to winners
      - Tie with odd chip: odd chip goes to player closest to left of dealer
      - Winner folded from side pot: next best hand in that pot wins

  **Must NOT do**:
  - Do NOT integrate with betting module directly — this is a pure calculation module
  - Do NOT handle rake or house cut

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Side pot algorithm with multiple all-ins is the hardest logic in a poker engine
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 7)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 9
  - **Blocked By**: Task 2

  **References**:

  **Pattern References**:
  - `src/engine/types.ts` (Task 2) — SidePot, PlayerState, HandEvaluation types

  **External References**:
  - Side pot algorithm: sort players by bet amount, create layers. For each layer, multiply (number of eligible players × layer amount), subtract from each player's contribution.

  **Acceptance Criteria**:
  - [ ] Simple pot: 3 players each bet 100 → main pot 300, no side pots
  - [ ] Single all-in: player A all-in 50, player B bets 100, player C bets 100 → main pot 150 (3×50), side pot 100 (B+C only)
  - [ ] Double all-in: A all-in 30, B all-in 60, C bets 100 → main pot 90, side pot 60, side pot 40
  - [ ] Tie split: 2 winners splitting 101 chips → 50 each, 1 remainder
  - [ ] Winner of side pot is different from winner of main pot

  **QA Scenarios**:

  ```
  Scenario: Three-way all-in at different amounts
    Tool: Bash (bun eval)
    Steps:
      1. Create 3 players: A bet 30 (all-in), B bet 60 (all-in), C bet 100
      2. calculatePots → assert main pot = 90 (3×30), eligible: [A, B, C]
      3. Assert side pot 1 = 60 (2×30 from B and C's remaining), eligible: [B, C]
      4. Assert side pot 2 = 40 (C's remaining 40), eligible: [C only]
      5. Set hand rankings: A has best hand (flush), B has second (two pair), C has worst (high card)
      6. awardPots → assert A wins main pot (90), B wins side pot 1 (60), C wins side pot 2 (40, only eligible)
    Expected Result: Each pot awarded to best eligible hand
    Failure Indicators: Wrong pot amounts, wrong eligibility, wrong winner
    Evidence: .sisyphus/evidence/task-8-three-way-allin.txt

  Scenario: Split pot with odd chip
    Tool: Bash (bun eval)
    Steps:
      1. Create pot of 101 chips with 2 winners
      2. splitPotEvenly(101, 2) → assert perPlayer = 50, remainder = 1
    Expected Result: Even split with remainder tracked
    Evidence: .sisyphus/evidence/task-8-split-pot.txt
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `feat(engine): pot calculator with side pots, multi-way all-in, and split pot handling`
  - Files: `src/engine/potCalculator.ts`
  - Pre-commit: `npx tsc --noEmit`

- [ ] 9. Game Controller — Full Hand Lifecycle

  **What to do**:
  - Create `src/engine/gameController.ts` — orchestrates a complete hand of poker:
    - `createGame(config: GameConfig): GameState` — Initialize new game with config, empty players, waiting phase
    - `startHand(game: GameState): GameState` — Begin a new hand:
      1. Advance dealer button (skip empty seats)
      2. Create and shuffle deck
      3. Post blinds
      4. Deal 2 hole cards to each active player
      5. Set phase to preflop
      6. Set active player index to first-to-act
    - `handleAction(game: GameState, playerId: string, action: PlayerAction): GameState` — Process a player action:
      1. Validate it's this player's turn
      2. Validate action via betting module
      3. Apply action
      4. Check if round complete → advance phase
      5. Check if only one player remains (everyone else folded) → award pot immediately
      6. If showdown → evaluate hands, calculate pots, award winnings
    - `getShowdownResults(game: GameState): HandResult[]` — Evaluate all remaining players' hands, determine winners for each pot
    - `advanceDealer(game: GameState): number` — Move dealer button to next occupied seat
    - `isHandComplete(game: GameState): boolean` — True if showdown resolved or only one player remains
    - `getPlayerView(game: GameState, playerId: string): ClientGameState` — Return game state visible to specific player (hide other players' hole cards unless showdown)
  - Orchestrate using: deck.ts (Task 4), handEvaluator.ts (Task 5), betting.ts (Task 7), potCalculator.ts (Task 8)
  - `ClientGameState` — same as GameState but with other players' hole cards hidden (null unless showdown)

  **Must NOT do**:
  - Do NOT handle Socket.IO communication — this is pure game logic
  - Do NOT persist to database — that happens in the server layer
  - Do NOT implement timeout/auto-fold here — that's Task 10

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Core orchestration module integrating 4 sub-modules with complex control flow
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Tasks 7 + 8 completing)
  - **Parallel Group**: Wave 2 (starts after 7 and 8)
  - **Blocks**: Tasks 11, 12, 13
  - **Blocked By**: Tasks 4, 5, 7, 8

  **References**:

  **Pattern References**:
  - `src/engine/deck.ts` (Task 4) — createDeck, shuffleDeck, dealCards
  - `src/engine/handEvaluator.ts` (Task 5) — evaluateHand, compareHands
  - `src/engine/betting.ts` (Task 7) — postBlinds, validateAction, applyAction, isRoundComplete, advancePhase
  - `src/engine/potCalculator.ts` (Task 8) — calculatePots, awardPots
  - `src/engine/types.ts` (Task 2) — all types

  **WHY Each Reference Matters**:
  - Game controller is the orchestrator — it calls all sub-modules in correct sequence to run a hand

  **Acceptance Criteria**:
  - [ ] `createGame` returns valid initial game state in waiting phase
  - [ ] `startHand` deals 2 cards per player, posts blinds, sets active player
  - [ ] `handleAction` processes full hand: preflop → flop → turn → river → showdown
  - [ ] Everyone folds to one player → that player wins pot immediately (no showdown)
  - [ ] Showdown correctly awards pots to winner(s)
  - [ ] `getPlayerView` hides other players' hole cards during play, shows at showdown
  - [ ] Dealer button advances correctly after each hand

  **QA Scenarios**:

  ```
  Scenario: Complete hand — 3 players, no all-in, goes to showdown
    Tool: Bash (bun eval)
    Steps:
      1. createGame with 1/2 blinds, 1000 starting stack
      2. Add 3 players to seats 0, 1, 2
      3. startHand → assert 2 cards dealt to each, blinds posted, preflop phase
      4. Play preflop: UTG calls, SB calls, BB checks → assert round complete
      5. Assert phase = flop, 3 community cards shown
      6. Play flop: all check → advance to turn (1 more card)
      7. Play turn: all check → advance to river (1 more card)
      8. Play river: all check → showdown
      9. Assert winners determined, chips awarded, hand complete
    Expected Result: Full hand plays from start to showdown with correct state at each step
    Failure Indicators: Wrong phase transitions, incorrect card dealing, wrong pot award
    Evidence: .sisyphus/evidence/task-9-complete-hand.txt

  Scenario: Everyone folds to one player
    Tool: Bash (bun eval)
    Steps:
      1. Start hand with 3 players
      2. UTG raises to 10, SB folds, BB folds
      3. Assert hand complete, UTG wins pot (SB + BB = 3 chips)
      4. Assert no showdown (no cards revealed)
    Expected Result: Last remaining player wins without showdown
    Evidence: .sisyphus/evidence/task-9-fold-win.txt

  Scenario: Player view hides opponent cards
    Tool: Bash (bun eval)
    Steps:
      1. Start hand with 2 players
      2. getPlayerView for player A → assert player A sees own hole cards, player B's hole cards are null
      3. Play to showdown
      4. getPlayerView for player A → assert player B's hole cards now visible
    Expected Result: Hole cards hidden during play, revealed at showdown
    Evidence: .sisyphus/evidence/task-9-player-view.txt
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `feat(engine): game controller orchestrating full NL Hold'em hand lifecycle`
  - Files: `src/engine/gameController.ts`
  - Pre-commit: `npx tsc --noEmit`

- [ ] 10. Player Timeout + Auto-Fold + Rebuy Logic

  **What to do**:
  - Create `src/engine/timeout.ts`:
    - `startActionTimer(game: GameState): { game: GameState, timerStart: number }` — Record when active player's timer started
    - `isTimedOut(game: GameState, now: number): boolean` — Check if active player exceeded timePerAction
    - `autoFoldPlayer(game: GameState): GameState` — Force-fold the active player (uses betting.applyAction with fold)
  - Add to player manager (`src/engine/playerManager.ts` from Task 6):
    - `markPlayerDisconnected(game: GameState, playerId: string): GameState` — Mark player as disconnected, start disconnect timer
    - `markPlayerReconnected(game: GameState, playerId: string): GameState` — Mark player as connected again
    - `shouldAutoFoldDisconnected(game: GameState, playerId: string, now: number, disconnectTimeout: number): boolean` — 30s default disconnect timeout
  - Rebuy logic enhancement:
    - `rebuyPlayer(game: GameState, playerId: string): GameState` — Only allowed when player has 0 chips AND hand is not in progress for that player (they're sitting out)
    - Rebuys at startingStack amount from config

  **Must NOT do**:
  - Do NOT implement time bank (extra time credits)
  - Do NOT implement sit-out/sit-in toggle (auto-fold is sufficient for MVP)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 9, partially — depends on Task 7)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 11
  - **Blocked By**: Tasks 6, 7

  **References**:

  **Pattern References**:
  - `src/engine/playerManager.ts` (Task 6) — extend with disconnect/reconnect methods
  - `src/engine/betting.ts` (Task 7) — applyAction for auto-fold

  **Acceptance Criteria**:
  - [ ] Timer starts when it becomes a player's turn
  - [ ] `isTimedOut` returns true after timePerAction seconds
  - [ ] `autoFoldPlayer` applies fold action correctly
  - [ ] Disconnected player auto-folded after 30s
  - [ ] Reconnected player can continue playing
  - [ ] Rebuy only works when player has 0 chips

  **QA Scenarios**:

  ```
  Scenario: Player times out and is auto-folded
    Tool: Bash (bun eval)
    Steps:
      1. Create game with 30s timePerAction, start hand
      2. startActionTimer at time T
      3. isTimedOut at T + 29s → assert false
      4. isTimedOut at T + 31s → assert true
      5. autoFoldPlayer → assert active player is now folded
    Expected Result: Timer correctly tracks timeout, auto-fold applies fold action
    Evidence: .sisyphus/evidence/task-10-timeout.txt

  Scenario: Player disconnects and reconnects
    Tool: Bash (bun eval)
    Steps:
      1. markPlayerDisconnected(game, playerId) → assert player.isConnected = false
      2. shouldAutoFoldDisconnected at +29s → false
      3. markPlayerReconnected(game, playerId) → assert player.isConnected = true
      4. shouldAutoFoldDisconnected → false (reconnected)
    Expected Result: Disconnect/reconnect state tracked correctly
    Evidence: .sisyphus/evidence/task-10-disconnect-reconnect.txt
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `feat(engine): player timeout, auto-fold on disconnect, and rebuy logic`
  - Files: `src/engine/timeout.ts, src/engine/playerManager.ts`
  - Pre-commit: `npx tsc --noEmit`

- [ ] 11. Socket.IO Server Layer + Event Handlers

  **What to do**:
  - Create `src/server/socketHandlers.ts` — main Socket.IO event handling:
    - **Connection Events**:
      - `join-game` — Player joins game room: validate game exists, assign seat, generate token, send back token + game state. Broadcast "player-joined" to room.
      - `reconnect-game` — Player reconnects: validate token, restore seat, send current game state. Broadcast "player-reconnected".
      - `disconnect` — Mark player disconnected, start auto-fold timer. Broadcast "player-disconnected".
    - **Game Control Events (host only)**:
      - `start-game` — Host starts the first hand. Validate minimum 2 players.
      - `pause-game` / `resume-game` — Host pauses/resumes (stops dealing new hands).
    - **Player Action Events**:
      - `player-action` — Player submits action (fold/check/call/raise). Validate via game controller, apply, broadcast new state. If hand complete, broadcast results and auto-start next hand after delay.
    - **Outbound Events (server → clients)**:
      - `game-state` — Full game state update (per-player view — hide opponents' cards)
      - `hand-result` — Showdown results with winners
      - `player-joined` / `player-left` — Player roster changes
      - `error` — Validation errors (not your turn, invalid action, etc.)
  - Create `src/server/gameStore.ts` — in-memory store for active games:
    - `Map<string, GameState>` — active game states keyed by game ID
    - `createGameInStore(config: GameConfig): string` — Create game, return game ID
    - `getGame(gameId: string): GameState | null`
    - `updateGame(gameId: string, game: GameState): void`
    - `deleteGame(gameId: string): void`
  - Wire Socket.IO server in `server.ts` to use these handlers
  - Serialize all actions: use a per-game lock/queue to prevent race conditions when two players act simultaneously
  - Send game state to each player individually (via their socket) with per-player view (hidden cards)

  **Must NOT do**:
  - Do NOT use Redis or external message broker — single process, in-memory
  - Do NOT implement chat events
  - Do NOT implement spectator mode events
  - Do NOT handle database persistence here — that's Task 13

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Real-time multiplayer with race condition handling, per-player state views, and complex event flows
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Tasks 9, 10)
  - **Parallel Group**: Wave 3
  - **Blocks**: Tasks 19, 23
  - **Blocked By**: Tasks 9, 10

  **References**:

  **Pattern References**:
  - `src/engine/gameController.ts` (Task 9) — createGame, startHand, handleAction, getPlayerView
  - `src/engine/playerManager.ts` (Task 6) — addPlayer, removePlayer, findPlayerByToken
  - `src/engine/timeout.ts` (Task 10) — timer management, auto-fold
  - `server.ts` (Task 1) — Socket.IO server instance to attach handlers to

  **External References**:
  - Socket.IO rooms: `socket.join(gameId)` — groups players by game
  - Socket.IO emit to room: `io.to(gameId).emit(event, data)` — broadcast to all in game
  - Socket.IO emit to individual: `socket.emit(event, data)` — send per-player view

  **WHY Each Reference Matters**:
  - Game controller is the core logic layer this handler delegates to
  - Socket.IO rooms API determines how multi-game isolation works

  **Acceptance Criteria**:
  - [ ] Player can join game via `join-game` event and receive game state
  - [ ] Player actions are validated and broadcast to all players in room
  - [ ] Each player receives their own view (own cards visible, others hidden)
  - [ ] Disconnected player is tracked and auto-folded after timeout
  - [ ] Reconnecting player (with token) regains their seat and current state
  - [ ] Race condition: two rapid actions serialized correctly (second waits for first)
  - [ ] Host can start game when ≥2 players joined

  **QA Scenarios**:

  ```
  Scenario: Two players join and play a hand via Socket.IO
    Tool: Bash (node script with socket.io-client)
    Preconditions: Server running on port 3000, game created via REST API
    Steps:
      1. Create game via REST API → get gameId
      2. Connect client1 (socket.io-client), emit join-game {gameId, displayName: "Alice", seatIndex: 0}
      3. Assert client1 receives game-state with Alice at seat 0
      4. Connect client2, emit join-game {gameId, displayName: "Bob", seatIndex: 1}
      5. Assert both clients receive game-state with 2 players
      6. Client1 (host) emits start-game
      7. Assert both clients receive game-state with phase: preflop, cards dealt
      8. Play through actions: fold/call/raise → assert state updates received by both
    Expected Result: Full multiplayer flow via Socket.IO events
    Failure Indicators: Missing events, wrong player view, state desync
    Evidence: .sisyphus/evidence/task-11-socket-gameplay.txt

  Scenario: Player disconnects and reconnects
    Tool: Bash (node script with socket.io-client)
    Steps:
      1. Player joins game and is in a hand
      2. Player socket disconnects (client.disconnect())
      3. Assert other players receive player-disconnected event
      4. New socket connects with reconnect-game {gameId, token}
      5. Assert reconnecting player receives current game state with their seat and chips
    Expected Result: Seamless reconnection preserving game state
    Evidence: .sisyphus/evidence/task-11-reconnection.txt
  ```

  **Commit**: YES (groups with Wave 3)
  - Message: `feat(server): Socket.IO event handlers with game rooms, per-player views, and reconnection`
  - Files: `src/server/socketHandlers.ts, src/server/gameStore.ts, server.ts`
  - Pre-commit: `npx tsc --noEmit`

- [ ] 12. REST API Endpoints

  **What to do**:
  - Create `src/app/api/games/route.ts` — Next.js App Router API route:
    - `POST /api/games` — Create new game:
      - Body: `{ smallBlind, bigBlind, startingStack, timePerAction, maxPlayers? }`
      - Validate config (reasonable ranges: blinds > 0, stack > blinds, time 10-300s)
      - Create game in store via gameStore.createGameInStore()
      - Return: `{ gameId, joinUrl }` (joinUrl = `/game/${gameId}`)
    - `GET /api/games/[id]` — Get game info (for join page):
      - Return: `{ id, config, playerCount, maxPlayers, status, players: [{ displayName, seatIndex }] }`
      - Do NOT return hole cards or game state — just metadata
  - Create `src/app/api/games/[id]/route.ts` for the dynamic route
  - Input validation: return 400 with clear error messages for invalid config
  - Return 404 for non-existent game IDs

  **Must NOT do**:
  - Do NOT create endpoints for game actions (those go through Socket.IO)
  - Do NOT create endpoints for hand history retrieval (write-only for MVP)
  - Do NOT add authentication middleware

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 11, 13)
  - **Parallel Group**: Wave 3
  - **Blocks**: Tasks 14, 15
  - **Blocked By**: Tasks 3, 9

  **References**:

  **Pattern References**:
  - `src/server/gameStore.ts` (Task 11) — createGameInStore, getGame
  - `src/engine/types.ts` (Task 2) — GameConfig for validation
  - `src/engine/constants.ts` (Task 2) — DEFAULT_CONFIG, min/max validation values

  **External References**:
  - Next.js App Router Route Handlers: `export async function POST(request: Request)` syntax

  **Acceptance Criteria**:
  - [ ] `POST /api/games` with valid config returns 200 with gameId
  - [ ] `POST /api/games` with invalid config (negative blinds) returns 400 with error
  - [ ] `GET /api/games/:id` returns game metadata for existing game
  - [ ] `GET /api/games/:nonexistent` returns 404

  **QA Scenarios**:

  ```
  Scenario: Create and retrieve game via API
    Tool: Bash (curl)
    Preconditions: Server running
    Steps:
      1. curl -s -X POST http://localhost:3000/api/games -H "Content-Type: application/json" -d '{"smallBlind":1,"bigBlind":2,"startingStack":1000,"timePerAction":30}' → assert 200, response has gameId
      2. Extract gameId from response
      3. curl -s http://localhost:3000/api/games/${gameId} → assert 200, response has config matching input
      4. curl -s http://localhost:3000/api/games/nonexistent → assert 404
    Expected Result: Game created and retrievable, 404 for missing games
    Failure Indicators: Wrong status codes, missing fields in response
    Evidence: .sisyphus/evidence/task-12-api-endpoints.txt

  Scenario: Validation rejects bad config
    Tool: Bash (curl)
    Steps:
      1. curl -s -X POST http://localhost:3000/api/games -H "Content-Type: application/json" -d '{"smallBlind":-1,"bigBlind":2}' → assert 400
      2. curl -s -X POST http://localhost:3000/api/games -H "Content-Type: application/json" -d '{}' → assert 400
    Expected Result: Invalid configs rejected with 400 and error message
    Evidence: .sisyphus/evidence/task-12-api-validation.txt
  ```

  **Commit**: YES (groups with Wave 3)
  - Message: `feat(api): REST endpoints for game creation and info retrieval`
  - Files: `src/app/api/games/route.ts, src/app/api/games/[id]/route.ts`
  - Pre-commit: `npx tsc --noEmit`

- [ ] 13. Database Persistence Layer

  **What to do**:
  - Create `src/db/persistence.ts`:
    - `saveGame(db: DrizzleClient, game: GameState): Promise<void>` — Upsert game record (create on first call, update status/completedAt)
    - `savePlayer(db: DrizzleClient, gameId: string, player: PlayerState, token: string): Promise<void>` — Upsert player record with buy-in tracking
    - `saveHand(db: DrizzleClient, gameId: string, hand: HandRecord): Promise<void>` — Save completed hand with community cards, all actions, and results
    - `saveHandActions(db: DrizzleClient, handId: string, actions: ActionRecord[]): Promise<void>` — Batch insert all actions for a hand
    - `saveHandResults(db: DrizzleClient, handId: string, results: HandResult[]): Promise<void>` — Save showdown results
    - `getSessionLedger(db: DrizzleClient, gameId: string): Promise<LedgerEntry[]>` — Calculate net profit/loss per player (total buy-ins vs final stack)
    - `LedgerEntry`: { displayName, buyIn, cashOut, netResult }
  - Wire persistence into Socket.IO handlers (Task 11): after each hand completes, persist in background (don't block game flow)
  - Use Drizzle's transaction support for atomic hand saves (hand + actions + results in one transaction)

  **Must NOT do**:
  - Do NOT build hand history retrieval/replay endpoints
  - Do NOT persist in-progress hand state (only completed hands)
  - Do NOT block game flow on database writes — fire and forget with error logging

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 11, 12)
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 20
  - **Blocked By**: Tasks 3, 9

  **References**:

  **Pattern References**:
  - `src/db/schema.ts` (Task 3) — table definitions, column types
  - `src/db/index.ts` (Task 3) — Drizzle client instance
  - `src/engine/types.ts` (Task 2) — GameState, HandResult, PlayerAction types

  **External References**:
  - Drizzle transactions: `await db.transaction(async (tx) => { ... })` for atomic writes

  **Acceptance Criteria**:
  - [ ] Completed hand is saved with all actions and results in one transaction
  - [ ] Session ledger query returns correct net results per player
  - [ ] Database write failure doesn't crash the game (error logged, game continues)
  - [ ] Player buy-in tracked correctly across rebuys

  **QA Scenarios**:

  ```
  Scenario: Hand persistence and ledger query
    Tool: Bash (bun eval)
    Preconditions: PostgreSQL running, schema applied
    Steps:
      1. Create a game state with 3 players, simulate a completed hand
      2. Call saveHand with hand data, actions, and results
      3. Query database directly: SELECT * FROM hands → assert 1 row
      4. SELECT * FROM hand_actions → assert correct number of action rows
      5. Call getSessionLedger → assert returns 3 entries with correct buy-in/cashout/net
    Expected Result: All hand data persisted, ledger calculates correctly
    Failure Indicators: Missing rows, wrong amounts, transaction failure
    Evidence: .sisyphus/evidence/task-13-persistence.txt

  Scenario: Persistence failure doesn't crash game
    Tool: Bash (bun eval)
    Steps:
      1. Temporarily make database unreachable
      2. Trigger hand save → assert no throw (error logged)
      3. Verify game state is still valid and game can continue
    Expected Result: Game continues despite persistence failure
    Evidence: .sisyphus/evidence/task-13-failure-resilience.txt
  ```

  **Commit**: YES (groups with Wave 3)
  - Message: `feat(db): persistence layer for completed hands, actions, and session ledger`
  - Files: `src/db/persistence.ts`
  - Pre-commit: `npx tsc --noEmit`

- [ ] 14. Landing Page + Game Creation Form

  **What to do**:
  - Create `src/app/page.tsx` — Landing page:
    - Hero section: "Play Poker with Friends" heading, brief description
    - "Create New Game" button → navigates to game creation form or modal
  - Create `src/app/create/page.tsx` — Game creation page:
    - Form fields with labels and validation:
      - Small Blind (number input, min 1)
      - Big Blind (number input, min 2× small blind)
      - Starting Stack (number input, min 10× big blind)
      - Time per Action (dropdown: 15s, 30s, 45s, 60s, No limit)
    - "Create Game" button → POST /api/games → redirect to `/game/${gameId}` with host flag
    - Show loading state while creating
    - Show error state if creation fails
  - Style with Tailwind CSS: dark theme (poker table green/dark green), clean layout
  - Responsive: works on mobile (stacked form) and desktop (centered card)

  **Must NOT do**:
  - Do NOT add login/signup forms
  - Do NOT add game listing/lobby (direct link access only)
  - Do NOT use UI component libraries — Tailwind utility classes only
  - Do NOT over-design — functional and clean, not flashy

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Frontend page with form, styling, and responsive layout
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 15-18)
  - **Parallel Group**: Wave 4
  - **Blocks**: Task 20
  - **Blocked By**: Task 12 (needs API endpoint to create games)

  **References**:

  **Pattern References**:
  - `src/app/api/games/route.ts` (Task 12) — POST endpoint this form submits to
  - `src/engine/constants.ts` (Task 2) — DEFAULT_CONFIG, min/max values for form validation

  **Acceptance Criteria**:
  - [ ] Landing page renders with "Create New Game" navigation
  - [ ] Create form has all 4 configuration fields with validation
  - [ ] Submitting valid form creates game and redirects to `/game/${gameId}`
  - [ ] Invalid inputs show error messages (e.g., "Big blind must be at least 2× small blind")
  - [ ] Page is responsive (mobile + desktop)

  **QA Scenarios**:

  ```
  Scenario: Create a game from landing page
    Tool: Playwright
    Steps:
      1. Navigate to http://localhost:3000
      2. Assert heading "Play Poker with Friends" is visible
      3. Click "Create New Game" link/button
      4. Assert create form page loads with 4 input fields
      5. Fill: smallBlind=1, bigBlind=2, startingStack=1000, timePerAction=30s
      6. Click "Create Game" button
      7. Assert redirected to /game/{id} URL pattern
    Expected Result: Game created successfully, redirected to game page
    Failure Indicators: Form doesn't submit, no redirect, wrong URL
    Evidence: .sisyphus/evidence/task-14-create-game.png

  Scenario: Form validation rejects invalid input
    Tool: Playwright
    Steps:
      1. Navigate to /create
      2. Enter smallBlind=5, bigBlind=2 (big < small)
      3. Click "Create Game"
      4. Assert error message visible (e.g., "Big blind must be at least 2× small blind")
      5. Assert NOT redirected (still on /create)
    Expected Result: Validation error shown, form not submitted
    Evidence: .sisyphus/evidence/task-14-form-validation.png
  ```

  **Commit**: YES (groups with Wave 4)
  - Message: `feat(ui): landing page and game creation form with validation`
  - Files: `src/app/page.tsx, src/app/create/page.tsx`
  - Pre-commit: `npx tsc --noEmit`

- [ ] 15. Game Join Page + Display Name Entry

  **What to do**:
  - Create `src/app/game/[id]/page.tsx` — Game page (entry point):
    - If player has no token in localStorage for this game → show join form:
      - Display name text input (required, max 20 chars)
      - Seat selection: show available seats (visual grid or list), unavailable seats greyed out
      - "Join Game" button
    - If player has token in localStorage → attempt reconnection automatically
    - After joining → transition to poker table view (Task 16 components)
    - Show game config info (blinds, stack) so players know what they're joining
    - Show current player list (who's already at the table)
  - Store player token in `localStorage` keyed by gameId: `poker_token_${gameId}`
  - Fetch game info via `GET /api/games/${id}` on page load
  - Handle invalid/expired game ID: show "Game not found" message

  **Must NOT do**:
  - Do NOT implement the poker table gameplay UI here — just the join flow
  - Do NOT add password protection for games
  - Do NOT implement spectator join option

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Frontend page with conditional rendering, seat selection UI
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 14, 16-18)
  - **Parallel Group**: Wave 4
  - **Blocks**: Task 20
  - **Blocked By**: Task 12 (needs GET API for game info)

  **References**:

  **Pattern References**:
  - `src/app/api/games/[id]/route.ts` (Task 12) — GET endpoint for game info
  - `src/engine/types.ts` (Task 2) — GameConfig, PlayerState for displaying game info

  **Acceptance Criteria**:
  - [ ] Page loads game info from API (blinds, stack, current players)
  - [ ] Join form shows display name input and seat selection
  - [ ] Occupied seats are disabled/greyed out
  - [ ] After joining, token stored in localStorage
  - [ ] Returning with token auto-reconnects
  - [ ] Invalid game ID shows "Game not found"

  **QA Scenarios**:

  ```
  Scenario: Join a game via shared link
    Tool: Playwright
    Steps:
      1. Create game via API → get gameId
      2. Navigate to http://localhost:3000/game/${gameId}
      3. Assert game info displayed (blinds: 1/2, stack: 1000)
      4. Assert join form visible with name input and seat buttons
      5. Enter displayName "Alice", select seat 0
      6. Click "Join Game"
      7. Assert join form disappears, poker table view appears
      8. Check localStorage for poker_token_${gameId} → assert exists
    Expected Result: Smooth join flow, token persisted
    Failure Indicators: API error, form doesn't submit, no token stored
    Evidence: .sisyphus/evidence/task-15-join-game.png

  Scenario: Invalid game ID shows error
    Tool: Playwright
    Steps:
      1. Navigate to http://localhost:3000/game/nonexistent123
      2. Assert "Game not found" message visible
      3. Assert no join form shown
    Expected Result: Clear error for non-existent game
    Evidence: .sisyphus/evidence/task-15-game-not-found.png
  ```

  **Commit**: YES (groups with Wave 4)
  - Message: `feat(ui): game join page with display name entry and seat selection`
  - Files: `src/app/game/[id]/page.tsx`
  - Pre-commit: `npx tsc --noEmit`

- [ ] 16. Poker Table Layout + Player Seats

  **What to do**:
  - Create `src/components/PokerTable.tsx` — Main table component:
    - Oval/rounded-rect table area (CSS, not canvas) with dark green felt-like background
    - 9 player seat positions arranged around the table (fixed positions via CSS absolute/flex)
    - Center area showing: community cards, pot total, dealer button indicator
  - Create `src/components/PlayerSeat.tsx` — Individual seat component:
    - Props: player (name, chips, bet, status), isCurrentPlayer, isActive, isFolded, isDealer
    - Display: avatar placeholder (initials circle), display name, chip count, current bet (if any)
    - Visual states: active (highlighted border), folded (dimmed), disconnected (greyed), all-in (badge)
    - Show hole cards area (face-down cards for opponents, face-up for self)
    - Dealer button (D) indicator on the dealer's seat
  - Create `src/components/CommunityCards.tsx` — Center card display:
    - Shows 0-5 community cards depending on phase
    - Cards appear as phase advances (3 on flop, 1 on turn, 1 on river)
  - Create `src/components/PotDisplay.tsx` — Shows current pot amount(s):
    - Main pot amount
    - Side pots listed separately if any

  **Must NOT do**:
  - Do NOT use HTML canvas or WebGL — CSS/HTML only
  - Do NOT add card flip animations (cards just appear)
  - Do NOT implement drag-and-drop for anything
  - Do NOT design for card back customization

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Complex layout with 9 positioned seats, visual states, poker table design
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 14, 15, 17, 18)
  - **Parallel Group**: Wave 4
  - **Blocks**: Task 20
  - **Blocked By**: Task 2 (needs types for props)

  **References**:

  **Pattern References**:
  - `src/engine/types.ts` (Task 2) — PlayerState, GamePhase, SidePot for component props

  **External References**:
  - PokerNow table layout: oval table with seats at positions around the perimeter — top (3 seats), sides (2 each), bottom (2 seats)

  **Acceptance Criteria**:
  - [ ] Table renders with oval/rounded center area
  - [ ] 9 seat positions visible around the table
  - [ ] Player seat shows: name, chips, bet, status indicators
  - [ ] Active player seat has highlighted border
  - [ ] Folded player seat is dimmed
  - [ ] Community cards area shows correct number of cards per phase
  - [ ] Pot display shows main pot + side pots

  **QA Scenarios**:

  ```
  Scenario: Table renders with players and community cards
    Tool: Playwright
    Steps:
      1. Navigate to active game with 3 players
      2. Assert poker table area visible (dark green background)
      3. Assert 3 player seats show names, chip counts
      4. Assert empty seats show as available
      5. Assert community cards area visible in center
      6. Assert pot display shows current pot amount
      7. Take screenshot for visual verification
    Expected Result: Table layout with all components positioned correctly
    Failure Indicators: Overlapping elements, missing seats, wrong positioning
    Evidence: .sisyphus/evidence/task-16-table-layout.png
  ```

  **Commit**: YES (groups with Wave 4)
  - Message: `feat(ui): poker table layout with player seats, community cards, and pot display`
  - Files: `src/components/PokerTable.tsx, src/components/PlayerSeat.tsx, src/components/CommunityCards.tsx, src/components/PotDisplay.tsx`
  - Pre-commit: `npx tsc --noEmit`

- [ ] 17. Card Components (Hole Cards + Community)

  **What to do**:
  - Create `src/components/Card.tsx` — Single playing card component:
    - Props: card (suit + rank) or faceDown (boolean)
    - Face-up: white background, rank + suit symbol in corner, large suit in center
    - Face-down: patterned back (CSS gradient or simple design, not an image)
    - Color coding: hearts/diamonds = red, clubs/spades = black
    - Sizing: responsive, fits within player seat area and community cards area
    - Suit symbols: ♠ ♥ ♦ ♣ (Unicode characters, not images)
    - Rank display: 2-10 as numbers, J/Q/K/A as letters
  - Create `src/components/HoleCards.tsx` — Pair of hole cards:
    - Props: cards (2 Card objects or null for hidden), isOwn (boolean)
    - Own cards: face-up, slightly overlapping
    - Opponent cards: face-down, slightly overlapping
    - No cards dealt yet: empty/placeholder state

  **Must NOT do**:
  - Do NOT use external card image assets (Unicode + CSS only)
  - Do NOT add card flip animations
  - Do NOT implement custom card backs or themes
  - Do NOT use SVG card libraries

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Visual component design with suit symbols, color coding, and layout
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 14-16, 18)
  - **Parallel Group**: Wave 4
  - **Blocks**: Task 20
  - **Blocked By**: Task 2 (needs Card, Suit, Rank types)

  **References**:

  **Pattern References**:
  - `src/engine/types.ts` (Task 2) — Card, Suit, Rank types

  **Acceptance Criteria**:
  - [ ] Card renders with correct rank and suit symbol
  - [ ] Red suits (hearts, diamonds) show red text, black suits show black
  - [ ] Face-down card shows patterned back
  - [ ] HoleCards shows two overlapping cards (face-up or face-down)
  - [ ] Cards are readable at table scale

  **QA Scenarios**:

  ```
  Scenario: Cards render correctly
    Tool: Playwright
    Steps:
      1. Navigate to game where current player has Ace of spades, King of hearts
      2. Assert own cards visible with "A♠" and "K♥"
      3. Assert "A♠" card has black text, "K♥" has red text
      4. Assert opponent cards show face-down (patterned backs)
      5. Screenshot for visual verification
    Expected Result: Cards display correctly with proper suits and colors
    Evidence: .sisyphus/evidence/task-17-card-display.png
  ```

  **Commit**: YES (groups with Wave 4)
  - Message: `feat(ui): playing card components with suits, ranks, and face-down states`
  - Files: `src/components/Card.tsx, src/components/HoleCards.tsx`
  - Pre-commit: `npx tsc --noEmit`

- [ ] 18. Player Action Bar + Raise Slider + Timer

  **What to do**:
  - Create `src/components/ActionBar.tsx` — Player action controls (shown only when it's your turn):
    - Buttons: Fold, Check (when no bet), Call ${amount} (when bet exists), Raise
    - Raise mode: clicking "Raise" reveals amount input with:
      - Slider from minimum raise to all-in
      - Number input for exact amount
      - Quick bet buttons: Min Raise, 1/2 Pot, Pot, All-In
      - "Confirm Raise" and "Cancel" buttons
    - Disable buttons that aren't valid actions (grey out with tooltip)
    - Show call amount on Call button: "Call $20"
    - Show "All In" instead of amount when bet equals remaining chips
  - Create `src/components/ActionTimer.tsx` — Countdown timer:
    - Circular or bar countdown showing remaining seconds
    - Visual urgency: changes color as time runs low (green → yellow → red)
    - Shows for active player only
    - When timer expires, server auto-folds (client just shows visual)
  - Action bar positioned at bottom of screen (fixed position)
  - Hidden when it's not your turn (show "Waiting for {playerName}" message instead)

  **Must NOT do**:
  - Do NOT implement time bank or bonus time
  - Do NOT implement auto-action presets (auto-fold, auto-check)
  - Do NOT implement bet sizing shortcuts beyond the 4 quick buttons

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Interactive UI with buttons, slider, timer animation
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 14-17)
  - **Parallel Group**: Wave 4
  - **Blocks**: Task 20
  - **Blocked By**: Task 2 (needs ActionType, GameState types)

  **References**:

  **Pattern References**:
  - `src/engine/types.ts` (Task 2) — ActionType, PlayerAction for action types
  - `src/engine/betting.ts` (Task 7) — validateAction logic (to know which buttons to enable/disable)

  **WHY Each Reference Matters**:
  - Types define what actions are possible; betting logic informs button enable/disable rules

  **Acceptance Criteria**:
  - [ ] Action bar shows correct buttons based on game state (check vs call)
  - [ ] Call button shows correct amount: "Call $20"
  - [ ] Raise slider ranges from min raise to all-in
  - [ ] Quick bet buttons calculate correct amounts (1/2 pot, pot)
  - [ ] Timer counts down and changes color at 10s and 5s remaining
  - [ ] Action bar hidden when not player's turn

  **QA Scenarios**:

  ```
  Scenario: Action bar with raise slider
    Tool: Playwright
    Steps:
      1. Navigate to game where it's your turn, opponent has bet $20
      2. Assert "Fold" button visible and enabled
      3. Assert "Call $20" button visible
      4. Assert "Raise" button visible
      5. Click "Raise" → assert slider appears with min/max range
      6. Assert "1/2 Pot", "Pot", "All-In" quick buttons visible
      7. Move slider to 100 → assert amount input shows 100
      8. Click "Confirm Raise" → assert action sent
    Expected Result: Full raise flow works with slider and quick buttons
    Evidence: .sisyphus/evidence/task-18-action-bar.png

  Scenario: Timer countdown
    Tool: Playwright
    Steps:
      1. It's your turn with 30s timer
      2. Assert timer shows ~30 seconds
      3. Wait 5 seconds
      4. Assert timer shows ~25 seconds
      5. Assert timer color is green (>10s remaining)
    Expected Result: Timer counts down visually
    Evidence: .sisyphus/evidence/task-18-timer.png
  ```

  **Commit**: YES (groups with Wave 4)
  - Message: `feat(ui): player action bar with fold/check/call/raise, slider, and countdown timer`
  - Files: `src/components/ActionBar.tsx, src/components/ActionTimer.tsx`
  - Pre-commit: `npx tsc --noEmit`

- [ ] 19. Socket.IO Client + React State Management

  **What to do**:
  - Create `src/lib/socket.ts` — Socket.IO client singleton:
    - `connectToGame(gameId: string): Socket` — Connect to server, join game room
    - Auto-reconnection enabled (Socket.IO default)
    - Event listeners registration for all server events
  - Create `src/lib/gameState.ts` — Client-side game state management (React context or zustand):
    - `GameContext` / `useGameState()` — Provides current game state to all components
    - State shape: `{ game: ClientGameState | null, myPlayerId: string | null, isConnected: boolean, error: string | null }`
    - Event handlers that update state:
      - `game-state` → update full game state
      - `hand-result` → show results overlay/animation
      - `player-joined` / `player-left` → update player list
      - `error` → show error notification
    - Action dispatchers:
      - `sendAction(action: PlayerAction)` → emit `player-action` event
      - `joinGame(displayName: string, seatIndex: number)` → emit `join-game`
      - `reconnectGame(token: string)` → emit `reconnect-game`
      - `startGame()` → emit `start-game` (host only)
  - Create `src/lib/useGameSocket.ts` — Custom React hook:
    - Manages socket lifecycle (connect on mount, disconnect on unmount)
    - Handles token storage/retrieval from localStorage
    - Provides `isMyTurn`, `myCards`, `canStartGame` computed values

  **Must NOT do**:
  - Do NOT use Redux (overkill for this)
  - Do NOT cache game state in localStorage (Socket.IO sends fresh state)
  - Do NOT implement optimistic updates — wait for server confirmation

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Complex state management with real-time WebSocket integration
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Task 11 for event contract)
  - **Parallel Group**: Wave 4 (but starts after Socket.IO server)
  - **Blocks**: Tasks 20, 21
  - **Blocked By**: Task 11

  **References**:

  **Pattern References**:
  - `src/server/socketHandlers.ts` (Task 11) — Event names and payload shapes (the contract this client implements)
  - `src/engine/types.ts` (Task 2) — ClientGameState, PlayerAction types

  **External References**:
  - socket.io-client: `import { io } from 'socket.io-client'` — `io("http://localhost:3000", { query: { gameId } })`

  **WHY Each Reference Matters**:
  - Socket handlers define the exact event contract (names + payloads) the client must implement

  **Acceptance Criteria**:
  - [ ] Socket connects when component mounts, disconnects on unmount
  - [ ] Game state updates on `game-state` event from server
  - [ ] `sendAction` emits event and state updates on response
  - [ ] `isMyTurn` correctly computed from game state
  - [ ] Token stored/retrieved from localStorage for reconnection
  - [ ] Error events displayed to user

  **QA Scenarios**:

  ```
  Scenario: Socket connection and state updates
    Tool: Playwright
    Steps:
      1. Navigate to game page, join as player
      2. Assert game state renders (player names, chip counts)
      3. Open browser dev tools console → assert no socket connection errors
      4. Have second player join (via separate Playwright context) → assert first player's UI updates with new player
    Expected Result: Real-time state synchronization between clients
    Failure Indicators: State not updating, socket errors in console
    Evidence: .sisyphus/evidence/task-19-socket-client.png
  ```

  **Commit**: YES (groups with Wave 4)
  - Message: `feat(client): Socket.IO client with React game state management and hooks`
  - Files: `src/lib/socket.ts, src/lib/gameState.ts, src/lib/useGameSocket.ts`
  - Pre-commit: `npx tsc --noEmit`

- [ ] 20. Full Game Flow Wiring + Integration

  **What to do**:
  - Wire all components together in `src/app/game/[id]/page.tsx`:
    - Join flow: load game info → show join form → join via socket → show table
    - Game flow: host clicks "Start Game" → hands auto-play → results shown between hands
    - Components receive state from GameContext/useGameState hook
    - ActionBar sends actions via socket dispatchers
    - Table, seats, cards, pot all update reactively on game-state events
  - Add host controls:
    - "Start Game" button (visible only to first player when ≥2 players present)
    - "Pause" / "Resume" toggle during gameplay
  - Add hand result display:
    - Brief overlay/modal showing: winner name, hand description, amount won
    - Auto-dismiss after 3-5 seconds, then next hand starts
  - Add session ledger view:
    - Accessible via "Ledger" button
    - Shows: player name, total buy-in, current chips, net result
    - Fetches from persistence layer or calculates from game state
  - Handle game-over state: when only 1 player remains or host ends game

  **Must NOT do**:
  - Do NOT add chat UI
  - Do NOT add hand history viewer
  - Do NOT implement complex result animations
  - Do NOT add sound effects

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Complex integration task wiring multiple systems together
  - **Skills**: [`playwright`]
    - `playwright`: For testing the full integrated flow in browser

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on all Wave 3+4 tasks)
  - **Parallel Group**: Wave 5
  - **Blocks**: Tasks 21, 23, 24
  - **Blocked By**: Tasks 14, 15, 16, 17, 18, 19

  **References**:

  **Pattern References**:
  - `src/app/game/[id]/page.tsx` (Task 15) — extend this page with gameplay UI
  - `src/lib/useGameSocket.ts` (Task 19) — hook providing game state and action dispatchers
  - `src/components/PokerTable.tsx` (Task 16) — table layout to render
  - `src/components/ActionBar.tsx` (Task 18) — action controls to wire up
  - `src/db/persistence.ts` (Task 13) — getSessionLedger for ledger view

  **Acceptance Criteria**:
  - [ ] Full flow works: create game → join 2 players → start → play hand → results shown → next hand starts
  - [ ] Host "Start Game" button visible when ≥2 players, hidden otherwise
  - [ ] Hand results shown between hands (winner, hand, amount)
  - [ ] Ledger shows correct buy-in and chip counts
  - [ ] Game state stays in sync between both players throughout

  **QA Scenarios**:

  ```
  Scenario: Complete 2-player game flow
    Tool: Playwright (2 browser contexts)
    Steps:
      1. Context 1: navigate to /, create game with 1/2 blinds, 1000 stack
      2. Context 1 (host): join as "Alice" at seat 0
      3. Copy game URL
      4. Context 2: navigate to game URL, join as "Bob" at seat 1
      5. Context 1: assert "Start Game" button visible, click it
      6. Both contexts: assert cards dealt, blinds posted
      7. Play a hand: active player folds
      8. Assert hand result shown (winner name, amount)
      9. Assert next hand starts automatically after delay
      10. Click "Ledger" → assert buy-in and net results displayed
    Expected Result: Complete game flow from creation to multi-hand play
    Failure Indicators: State desync, actions not registering, results not showing
    Evidence: .sisyphus/evidence/task-20-full-flow.png

  Scenario: Host controls — start requires 2 players
    Tool: Playwright
    Steps:
      1. Create game, join alone
      2. Assert "Start Game" button NOT visible (only 1 player)
      3. Second player joins → assert "Start Game" button appears
    Expected Result: Start button conditional on player count
    Evidence: .sisyphus/evidence/task-20-host-controls.png
  ```

  **Commit**: YES
  - Message: `feat(integration): wire full game flow with host controls, result display, and session ledger`
  - Files: `src/app/game/[id]/page.tsx, src/components/HandResult.tsx, src/components/SessionLedger.tsx`
  - Pre-commit: `npx tsc --noEmit`

- [ ] 21. Reconnection + Edge Case Handling

  **What to do**:
  - Implement client-side reconnection in `src/app/game/[id]/page.tsx` and `src/lib/useGameSocket.ts`:
    - On page load: check localStorage for `poker_token_${gameId}`
    - If token exists: emit `reconnect-game` instead of showing join form
    - On `reconnect-game` success: restore full game state, rejoin table at same seat
    - On `reconnect-game` failure (token expired/invalid): clear token, show join form
    - Socket.IO auto-reconnect: when connection drops and restores, re-emit reconnect-game
  - Handle edge cases:
    - **Browser refresh during hand**: player reconnects and sees current hand state
    - **Multiple tabs**: second tab with same token mirrors the game state (both receive events)
    - **Player busts and rebuys**: show "Rebuy" button when chips = 0, call rebuyPlayer
    - **Everyone folds preflop**: pot awarded to remaining player, brief result shown, next hand
    - **Player leaves mid-hand**: auto-fold their hand, remove from table after hand
    - **Last two players**: when only 2 remain, switch to heads-up rules automatically
  - Add connection status indicator (small dot: green = connected, red = disconnected, yellow = reconnecting)

  **Must NOT do**:
  - Do NOT implement "sit out" toggle (auto-fold on disconnect is sufficient)
  - Do NOT handle server crash recovery (single-process, if server restarts all games are lost)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`playwright`]
    - `playwright`: For testing reconnection flows in browser

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Task 20)
  - **Parallel Group**: Wave 5
  - **Blocks**: Task 24
  - **Blocked By**: Tasks 19, 20

  **References**:

  **Pattern References**:
  - `src/lib/useGameSocket.ts` (Task 19) — extend with reconnection logic
  - `src/server/socketHandlers.ts` (Task 11) — reconnect-game event handler
  - `src/engine/playerManager.ts` (Task 6) — findPlayerByToken, markPlayerReconnected

  **Acceptance Criteria**:
  - [ ] Page refresh during hand → player reconnects to same seat with correct chips and cards
  - [ ] Connection status indicator shows current state (green/red/yellow)
  - [ ] Expired token → join form shown (not stuck on loading)
  - [ ] Player with 0 chips sees "Rebuy" button
  - [ ] Rebuy resets chips to starting stack
  - [ ] Leaving player auto-folded mid-hand

  **QA Scenarios**:

  ```
  Scenario: Player refreshes browser and reconnects
    Tool: Playwright
    Steps:
      1. Join game as "Alice", play until a hand is in progress
      2. Note current chips, cards, and game phase
      3. Refresh the page (page.reload())
      4. Assert: no join form shown (auto-reconnect via token)
      5. Assert: same seat, same chip count, same cards visible
      6. Assert: game phase unchanged
      7. Assert: can continue playing (submit action)
    Expected Result: Seamless reconnection preserving full game state
    Failure Indicators: Shown join form, wrong chips, missing cards
    Evidence: .sisyphus/evidence/task-21-reconnect.png

  Scenario: Player busts and rebuys
    Tool: Playwright
    Steps:
      1. Set up game where a player loses all chips (go all-in and lose)
      2. Assert player's chips = 0
      3. Assert "Rebuy" button visible
      4. Click "Rebuy" → assert chips reset to starting stack (1000)
      5. Assert player can play next hand
    Expected Result: Rebuy restores chips and allows continued play
    Evidence: .sisyphus/evidence/task-21-rebuy.png
  ```

  **Commit**: YES
  - Message: `feat(resilience): player reconnection, rebuy, and edge case handling`
  - Files: `src/lib/useGameSocket.ts, src/app/game/[id]/page.tsx, src/components/ConnectionStatus.tsx`
  - Pre-commit: `npx tsc --noEmit`

- [ ] 22. Vitest Setup + Game Engine Unit Tests

  **What to do**:
  - Set up Vitest:
    - Install vitest if not already: `bun add -D vitest`
    - Create `vitest.config.ts` with path aliases matching tsconfig
    - Add test script to package.json: `"test": "vitest run"`, `"test:watch": "vitest"`
  - Create comprehensive test files for the game engine:
    - `src/engine/__tests__/deck.test.ts`:
      - createDeck returns 52 unique cards
      - shuffleDeck doesn't mutate input, returns different order
      - dealCards splits correctly
    - `src/engine/__tests__/handEvaluator.test.ts`:
      - All 10 hand rankings (one test each with known cards)
      - Best 5 of 7 selection
      - Hand comparison (winner identification)
      - Tie detection (split pot scenario)
    - `src/engine/__tests__/betting.test.ts`:
      - Blind posting (3+ players and heads-up)
      - Action validation (valid/invalid for each action type)
      - Round completion detection
      - Phase advancement (preflop → flop → turn → river)
      - Minimum raise tracking
      - All-in for less than call
    - `src/engine/__tests__/potCalculator.test.ts`:
      - Simple pot (no all-in)
      - Single all-in side pot
      - Multi-way all-in (3+ different amounts)
      - Split pot with tie
      - Odd chip distribution
    - `src/engine/__tests__/gameController.test.ts`:
      - Create game → start hand → play to showdown
      - Everyone folds → last player wins
      - Player view hides cards correctly
      - Dealer button advancement
      - Multi-hand sequence (dealer moves between hands)

  **Must NOT do**:
  - Do NOT test UI components (React component tests add marginal value here)
  - Do NOT test Socket.IO integration (that's Task 23)
  - Do NOT aim for 100% coverage — focus on critical game logic paths

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 20, 21, 23, 24)
  - **Parallel Group**: Wave 5 (can start as soon as engine tasks complete)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 7, 8, 9

  **References**:

  **Pattern References**:
  - `src/engine/deck.ts` (Task 4) — module under test
  - `src/engine/handEvaluator.ts` (Task 5) — module under test
  - `src/engine/betting.ts` (Task 7) — module under test
  - `src/engine/potCalculator.ts` (Task 8) — module under test
  - `src/engine/gameController.ts` (Task 9) — module under test

  **External References**:
  - Vitest docs: https://vitest.dev/guide/ — `describe`, `it`, `expect` syntax

  **Acceptance Criteria**:
  - [ ] `bun test` runs all tests and passes
  - [ ] ≥30 test cases covering critical poker logic
  - [ ] All 10 hand rankings tested
  - [ ] Side pots tested with 2, 3, and 4-player all-in scenarios
  - [ ] Heads-up blind/action rules tested
  - [ ] Full hand lifecycle tested (preflop through showdown)

  **QA Scenarios**:

  ```
  Scenario: All tests pass
    Tool: Bash
    Steps:
      1. Run `bun test` → assert exit code 0
      2. Assert output shows ≥30 tests passing
      3. Assert 0 failures
    Expected Result: All game engine tests pass
    Failure Indicators: Non-zero exit code, test failures
    Evidence: .sisyphus/evidence/task-22-test-results.txt
  ```

  **Commit**: YES
  - Message: `test(engine): comprehensive unit tests for deck, hand eval, betting, pots, and game controller`
  - Files: `vitest.config.ts, src/engine/__tests__/*.test.ts`
  - Pre-commit: `bun test`

- [ ] 23. Socket.IO Integration Tests

  **What to do**:
  - Create `src/server/__tests__/integration.test.ts`:
    - Use socket.io-client to connect programmatic clients to the server
    - Start server on random port for test isolation
    - Test scenarios:
      - **Join flow**: connect client → emit join-game → receive game-state with player listed
      - **Two-player hand**: 2 clients join → host starts → both receive cards → play actions → hand completes
      - **Reconnection**: client disconnects → new client reconnects with token → receives correct state
      - **Invalid action**: client sends action when not their turn → receives error event
      - **Race condition**: two clients send actions simultaneously → only valid one processed
    - Clean up: disconnect all clients and close server after each test
  - Create test helper: `src/server/__tests__/testHelper.ts`:
    - `startTestServer(): { io, httpServer, port }` — spin up server on random port
    - `createTestClient(port: number, gameId: string): Socket` — create connected client
    - `waitForEvent(socket: Socket, event: string): Promise<any>` — promisified event listener

  **Must NOT do**:
  - Do NOT test UI (Playwright handles that in Task 24)
  - Do NOT test database persistence in these tests (mock it or skip)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 22, 24)
  - **Parallel Group**: Wave 5
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 11, 20

  **References**:

  **Pattern References**:
  - `src/server/socketHandlers.ts` (Task 11) — event handlers being tested
  - `src/server/gameStore.ts` (Task 11) — game store used by handlers

  **External References**:
  - socket.io-client testing: `import { io } from 'socket.io-client'; const socket = io("http://localhost:PORT")`

  **Acceptance Criteria**:
  - [ ] All integration tests pass: `bun test src/server`
  - [ ] Join → play → complete hand tested end-to-end
  - [ ] Reconnection tested
  - [ ] Invalid action rejection tested
  - [ ] Tests clean up properly (no hanging connections)

  **QA Scenarios**:

  ```
  Scenario: Integration tests pass
    Tool: Bash
    Steps:
      1. Run `bun test src/server/__tests__/integration.test.ts` → assert exit code 0
      2. Assert ≥5 test cases pass
    Expected Result: All Socket.IO integration tests pass
    Evidence: .sisyphus/evidence/task-23-integration-tests.txt
  ```

  **Commit**: YES
  - Message: `test(server): Socket.IO integration tests for game flow and reconnection`
  - Files: `src/server/__tests__/integration.test.ts, src/server/__tests__/testHelper.ts`
  - Pre-commit: `bun test`

- [ ] 24. Playwright E2E Tests

  **What to do**:
  - Set up Playwright:
    - `bunx playwright install chromium` (chromium only for speed)
    - Create `playwright.config.ts` — baseURL localhost:3000, webServer command to start dev server
  - Create `e2e/game-flow.spec.ts` — Full end-to-end tests:
    - **Test: Create game from landing page**
      1. Navigate to /
      2. Click "Create New Game"
      3. Fill form (1/2 blinds, 1000 stack, 30s time)
      4. Submit → assert redirected to /game/{id}
    - **Test: Two players join and play a hand**
      1. Create game via API
      2. Browser 1: navigate to game URL, join as "Alice" seat 0
      3. Browser 2: navigate to game URL, join as "Bob" seat 1
      4. Browser 1: click "Start Game"
      5. Assert both browsers show: cards dealt, blinds posted
      6. Play actions (fold/call) → assert hand completes
      7. Assert winner shown, chips updated
    - **Test: Player reconnects after refresh**
      1. Join game, play until hand in progress
      2. Refresh page
      3. Assert: same seat, same chips, game continues
  - Use separate browser contexts for multi-player testing

  **Must NOT do**:
  - Do NOT test every poker scenario in E2E (unit tests cover that)
  - Do NOT install all browsers (chromium only)
  - Do NOT add visual regression testing

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`playwright`]
    - `playwright`: Required for browser automation expertise

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 22, 23)
  - **Parallel Group**: Wave 5
  - **Blocks**: F1-F4
  - **Blocked By**: Task 20

  **References**:

  **Pattern References**:
  - `src/app/page.tsx` (Task 14) — landing page to test
  - `src/app/game/[id]/page.tsx` (Task 15, 20) — game page to test
  - `src/app/api/games/route.ts` (Task 12) — API for programmatic game creation

  **External References**:
  - Playwright docs: https://playwright.dev/docs/intro — `test`, `expect`, `page.goto`, `page.click`

  **Acceptance Criteria**:
  - [ ] `bunx playwright test` passes all E2E tests
  - [ ] Game creation flow tested
  - [ ] Two-player gameplay tested (separate browser contexts)
  - [ ] Reconnection tested
  - [ ] Tests run in <60 seconds

  **QA Scenarios**:

  ```
  Scenario: All E2E tests pass
    Tool: Bash
    Steps:
      1. Start dev server
      2. Run `bunx playwright test` → assert exit code 0
      3. Assert all test files pass
    Expected Result: All Playwright E2E tests pass
    Evidence: .sisyphus/evidence/task-24-e2e-results.txt
  ```

  **Commit**: YES
  - Message: `test(e2e): Playwright end-to-end tests for game creation, gameplay, and reconnection`
  - Files: `playwright.config.ts, e2e/game-flow.spec.ts`
  - Pre-commit: `bunx playwright test`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Rejection → fix → re-run.

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `tsc --noEmit` + linter + `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp).
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill)
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (features working together, not isolation). Test edge cases: empty state, invalid input, rapid actions. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination: Task N touching Task M's files. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Wave 1**: `feat(scaffold): project setup with Next.js, Socket.IO, Tailwind, PostgreSQL` — all Wave 1 files
- **Wave 2**: `feat(engine): NL Hold'em game engine with betting, pots, and hand evaluation` — src/engine/*
- **Wave 3**: `feat(server): Socket.IO server layer, REST API, and database persistence` — src/server/*, src/db/*
- **Wave 4**: `feat(ui): poker table frontend with game creation, joining, and gameplay` — src/app/*, src/components/*
- **Wave 5**: `feat(integration): full game flow, reconnection, and test suites` — integration + test files

---

## Success Criteria

### Verification Commands
```bash
# TypeScript compiles cleanly
npx tsc --noEmit  # Expected: no errors

# All unit tests pass
bun test  # Expected: all tests pass

# Server starts successfully
bun run dev  # Expected: server listening on port 3000

# Create a game via API
curl -s -X POST http://localhost:3000/api/games \
  -H "Content-Type: application/json" \
  -d '{"smallBlind":1,"bigBlind":2,"startingStack":1000,"timePerAction":30}' \
  | jq '.gameId'  # Expected: returns game ID string

# Playwright E2E
bunx playwright test  # Expected: all tests pass
```

### Final Checklist
- [x] All "Must Have" present
- [x] All "Must NOT Have" absent
- [x] All Vitest tests pass
- [x] Playwright E2E passes
- [x] Two players can complete a full hand via separate browser tabs
- [x] Side pots calculated correctly
- [x] Player reconnection works after page refresh
- [x] Hand history saved to PostgreSQL
