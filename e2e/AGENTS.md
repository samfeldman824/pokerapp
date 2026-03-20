# E2E KNOWLEDGE BASE

## OVERVIEW
`e2e` holds Playwright browser flows for top-level multiplayer behavior; unit and rules tests live elsewhere.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Playwright config | `playwright.config.ts` | Boots app with `npx tsx server.ts` |
| Browser scenarios | `e2e/*.spec.ts` | Centralized end-to-end coverage |

## CONVENTIONS
- E2E coverage is centralized here, not colocated under feature directories.
- Browser tests run against the custom server path, which better matches production behavior than raw `next dev`.
- Keep engine-rule assertions in Vitest when possible; reserve Playwright for cross-layer user flows.

## ANTI-PATTERNS
- Do not add unit-style logic tests here when `src/engine/*.test.ts` can cover them faster.
- Do not assume default Postgres settings; Playwright config uses the local `5433` database URL.

## NOTES
- There is no dedicated integration-test layer between Vitest and Playwright in this repo.
