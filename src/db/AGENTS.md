# DB KNOWLEDGE BASE

## OVERVIEW
`src/db` defines the durable model: Drizzle schema plus helpers that persist and reload poker sessions from PostgreSQL snapshots and hand-level records.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Change schema | `src/db/schema.ts` | Games, players, hands, actions, results |
| Change save/load behavior | `src/db/persistence.ts` | Snapshot + reconstruction logic |
| Change DB client wiring | `src/db/index.ts` | Connection setup |
| Change migration config | `drizzle.config.ts`, `scripts/migrate.ts` | Outside this directory but tightly coupled |

## CONVENTIONS
- Persist the full `GameState` snapshot for fast restore, while keeping hand/action/result tables for history and reporting.
- Schema models session ledger semantics through `chipsBroughtIn` and `chipsCarriedOut` rather than only net deltas.
- Keep DB helpers below engine/server layers; they should store domain state, not invent it.

## ANTI-PATTERNS
- Do not store deck state in persisted snapshots unless the surrounding design intentionally changes.
- Do not change ledger fields without checking API consumers and UI history views.

## NOTES
- Local defaults assume `DATABASE_URL` points at Postgres on port `5433`.
- Persistence is shared by both HTTP routes and socket handlers, so schema changes usually ripple across both.
