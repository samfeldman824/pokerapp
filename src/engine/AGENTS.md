# ENGINE KNOWLEDGE BASE

## OVERVIEW
`src/engine` is the rules core: pure game-state transitions, betting logic, player management, and shared types consumed by app, server, and persistence layers.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Create/reset game state | `src/engine/gameController.ts` | `createGame`, `resetGame` |
| Start and advance hands | `src/engine/gameController.ts` | `startHand`, runout/showdown helpers |
| Apply player actions | `src/engine/gameController.ts` | `handleAction` |
| Shared domain types | `src/engine/types.ts` | Main type hub across layers |
| Player lifecycle helpers | `src/engine/playerManager.ts` | Shared bridge into server/routes |
| Betting calculations | `src/engine/betting.ts` | Large rules helper |
| Test utilities and cases | `src/engine/*.test.ts`, `src/engine/testUtils.ts` | Main unit-test concentration |

## CONVENTIONS
- Keep engine code deterministic and transport-free; inputs/outputs should not depend on sockets, React, or DB access.
- Respect the existing distinction between compact player arrays and sparse seat-indexed forms used by betting helpers.
- When other layers need new behavior, prefer adding an engine function or extending existing types instead of copying logic outward.

## ANTI-PATTERNS
- Do not read from persistence or emit broadcasts here.
- Do not patch over seat-indexing assumptions without tracing betting helpers and tests together.
- Do not refactor large engine files casually during bug fixes; this area is highly coupled to server/runtime behavior.

## NOTES
- `src/engine/gameController.ts` and `src/engine/betting.ts` are both large; make minimal, well-scoped edits.
- Engine tests are the fastest regression check for rule changes before touching Playwright coverage.
