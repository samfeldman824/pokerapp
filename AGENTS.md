# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-20 17:38 EDT
**Commit:** bf03147
**Branch:** main

## OVERVIEW
Real-time multiplayer Texas Hold'em app built on Next.js 14 App Router, a custom `server.ts` bootstrap, Socket.IO, and PostgreSQL via Drizzle. Most product behavior flows through the engine/server/db pipeline rather than through Next route handlers alone.

## STRUCTURE
```text
./
├── server.ts           # Custom Next + Socket.IO bootstrap; primary runtime entry
├── src/app/            # App Router pages and REST endpoints
├── src/components/     # Reusable game UI pieces
├── src/db/             # Drizzle schema and persistence helpers
├── src/engine/         # Pure game state logic and betting rules
├── src/lib/            # Client socket hook and shared UI utilities
├── src/server/         # Socket event handlers and in-memory game store
├── e2e/                # Playwright end-to-end flows
├── scripts/            # Operational scripts such as migrations
├── .do/app.yaml        # DigitalOcean deploy spec; uses npm commands, not Bun
└── docker-compose.yml  # Local Postgres on port 5433
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Understand runtime startup | `server.ts` | Next request handling and Socket.IO share one HTTP server |
| Trace a player action | `src/server/socketHandlers.ts` | Event entry, locking, persistence, broadcast |
| Change poker rules/state transitions | `src/engine/gameController.ts` | Core mutation engine |
| Change betting helpers or seat math | `src/engine/` | Engine is intentionally separate from transport |
| Adjust create-game HTTP flow | `src/app/api/games/route.ts` | Creates game, host, persistence snapshot |
| Adjust game room UI | `src/app/game/[id]/page.tsx` | Large page coordinating socket state and controls |
| Adjust reusable table widgets | `src/components/` | Seats, cards, chat, history, ledger |
| Change persistence format | `src/db/persistence.ts` | Saves full `GameState` snapshots minus deck |
| Change schema/migrations | `src/db/schema.ts`, `scripts/migrate.ts`, `drizzle.config.ts` | Drizzle setup |
| Change reconnect/join client logic | `src/lib/useGameSocket.ts` | Stores `poker_token_<gameId>` and `poker_player_<gameId>` |
| Add browser-level coverage | `e2e/` | Playwright starts app via `npx tsx server.ts` |

## CODE MAP
| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| `registerSocketHandlers` | function | `src/server/socketHandlers.ts` | high | Wires all realtime events |
| `createGame` | function | `src/engine/gameController.ts` | high | Initializes canonical game state |
| `startHand` | function | `src/engine/gameController.ts` | high | Starts a hand lifecycle |
| `handleAction` | function | `src/engine/gameController.ts` | high | Applies fold/check/call/bet/raise actions |
| `getPlayerView` | function | `src/engine/gameController.ts` | high | Produces filtered client-visible state |
| `gameStore` | singleton | `src/server/gameStore.ts` | medium | In-memory cache + per-game async lock |
| `saveGame` | function | `src/db/persistence.ts` | medium | Persists game snapshot |
| `useGameSocket` | hook | `src/lib/useGameSocket.ts` | medium | Client bridge to Socket.IO lifecycle |

## CONVENTIONS
- Runtime is Bun-flavored, but local dev server starts with `tsx watch server.ts` and Playwright also boots `server.ts` directly.
- Keep engine logic transport-agnostic; server and API layers call into `src/engine` instead of embedding game rules.
- API handlers live under App Router `route.ts` files; socket flows still carry most realtime behavior.
- UI component files are PascalCase; engine/server helper files are camelCase.
- Path alias `@/*` maps to `src/*`.

## ANTI-PATTERNS (THIS PROJECT)
- Do not assume `next dev` is the primary runtime; the custom server path is the real entry point.
- Do not bypass `gameStore.withLock(...)` when mutating shared game state from realtime handlers.
- Do not couple UI directly to DB/server internals; shared state crosses layers through engine types, REST routes, and `useGameSocket`.
- Do not ignore the deployment mismatch in `.do/app.yaml`; local tooling is Bun-heavy, deploy spec is npm-based.

## UNIQUE STYLES
- `src/server/socketHandlers.ts` follows a repeated lock -> load -> engine mutate -> persist -> broadcast flow.
- Persistence stores full game snapshots for fast reload, then supplements with hand/action/result records.
- Engine comments distinguish compact player arrays from sparse seat-indexed structures used by betting helpers.

## COMMANDS
```bash
bun install
docker compose up -d
bun scripts/migrate.ts
bun run dev
bun run type-check
bun run lint
bun run test
```

## NOTES
- Local Postgres defaults to port `5433`, not `5432`.
- There is no CI workflow checked in; verify locally before changing cross-layer behavior.
- `src/app/game/[id]/page.tsx` and `src/server/socketHandlers.ts` are large coordination files; prefer targeted edits over opportunistic refactors.
